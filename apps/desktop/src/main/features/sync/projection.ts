import { DatabaseSync } from 'node:sqlite';
import type { PlaybookRecord } from '../../../contracts/playbooks';
import type { TeamStore } from '../../platform/team-store';
import {
  caseSearchDocument,
  playbookSearchDocument,
  SearchIndex,
  searchTransaction,
} from '../playbooks/search-index.ts';
import type { CaseRecord } from '../../../contracts/cases';
import type {
  SyncDocument,
  SyncLease,
  SyncOperation,
} from '../../../contracts/sync';

export function projectDocuments(
  docs: SyncDocument[],
  queue: SyncOperation[],
  lease: SyncLease,
  // When each op was queued; must be stable so repeated reads compare equal.
  queuedAt: (op: SyncOperation) => string,
): SyncDocument[] {
  const projected = new Map(docs.map((doc) => [doc.id, doc]));
  for (const op of queue) {
    let doc = projected.get(op.documentId);
    if (op.type === 'create-case' && !doc) {
      const at = queuedAt(op);
      doc = {
        id: op.documentId,
        kind: 'case',
        generation: 1,
        version: 0,
        record: {
          id: op.documentId,
          workspaceId: lease.workspaceId,
          number: 0,
          title: op.title!,
          ownerId: lease.accountId,
          ticket: '',
          status: 'inv',
          customer: { name: '', confirmed: false },
          chatIds: [],
          createdAt: at,
          updatedAt: at,
          entries: [],
          changes: [],
        },
      };
      projected.set(doc.id, doc);
    }
    if (!doc) continue;
    if (op.type === 'delete' || op.type === 'flag') {
      projected.delete(doc.id);
      continue;
    }
    if (doc.kind === 'case') {
      const c = doc.record as CaseRecord;
      if (op.type === 'title' || op.type === 'entry')
        c.updatedAt = queuedAt(op);
      if (op.type === 'title') c.title = op.title!;
      if (op.type === 'entry') {
        c.entries = c.entries.filter((e) => e.id !== op.entryId);
        if (op.value)
          c.entries.push({
            ...op.value,
            id: op.entryId!,
            position: c.entries.length,
            version: op.base + 1,
            authorId: lease.accountId,
            updatedAt: queuedAt(op),
          });
      }
    }
  }
  return [...projected.values()];
}

type Projected = {
  doc?: SyncDocument;
  caseRecord?: CaseRecord;
  book?: PlaybookRecord;
};

export class TeamProjection {
  private readonly store: Pick<TeamStore, 'get' | 'keys' | 'list'>;
  private readonly queue = new Map<string, SyncOperation>();
  private readonly byDocument = new Map<string, Map<string, SyncOperation>>();
  private readonly projected = new Map<string, Projected | undefined>();
  private readonly dirty = new Set<string>();
  private readonly queuedAt = new Map<string, string>();
  private searchDb?: DatabaseSync;
  private index?: SearchIndex;
  private timer?: NodeJS.Immediate;

  constructor(store: Pick<TeamStore, 'get' | 'keys' | 'list'>) {
    this.store = store;
    for (const key of [...store.keys('d/'), ...store.keys('draft/')])
      this.projected.set(key.slice(key.indexOf('/') + 1), undefined);
    for (const op of store.list<SyncOperation>('q/')) this.setOp(op);
  }

  private setOp(op: SyncOperation) {
    this.queue.set(op.id, op);
    let operations = this.byDocument.get(op.documentId);
    if (!operations) {
      operations = new Map();
      this.byDocument.set(op.documentId, operations);
    }
    operations.set(op.id, op);
    if (!this.projected.has(op.documentId))
      this.projected.set(op.documentId, undefined);
  }

  private mark(id: string) {
    this.projected.set(id, undefined);
    if (this.index) this.dirty.add(id);
  }

  operations(id?: string) {
    return [
      ...(id === undefined
        ? this.queue.values()
        : (this.byDocument.get(id)?.values() ?? [])),
    ];
  }

  changed(changes: ReadonlyMap<string, unknown>) {
    for (const [key, value] of changes) {
      const id = key.slice(key.indexOf('/') + 1);
      if (!key.startsWith('q/')) {
        this.mark(id);
        continue;
      }
      const before = this.queue.get(id);
      if (
        before &&
        (!value || before.documentId !== (value as SyncOperation).documentId)
      ) {
        this.queue.delete(id);
        const group = this.byDocument.get(before.documentId)!;
        group.delete(id);
        if (!group.size) this.byDocument.delete(before.documentId);
        this.queuedAt.delete(id);
        this.mark(before.documentId);
      }
      if (value) {
        const op = value as SyncOperation;
        this.setOp(op);
        this.mark(op.documentId);
      }
    }
  }

  read(id: string, lease: SyncLease): Projected {
    const cached = this.projected.get(id);
    if (cached) return cached;
    const raw = this.store.get<SyncDocument>(`d/${id}`);
    const queue = this.operations(id);
    const draft = this.store.get<PlaybookRecord>(`draft/${id}`);
    if (!raw && !draft && !queue.length) {
      this.projected.delete(id);
      return {};
    }
    const [doc] = projectDocuments(raw ? [raw] : [], queue, lease, (op) => {
      let time = this.queuedAt.get(op.id);
      if (!time) this.queuedAt.set(op.id, (time = new Date().toISOString()));
      return time;
    });
    const result: Projected = { doc };
    if (doc?.kind === 'case') {
      result.caseRecord = {
        ...(doc.record as CaseRecord),
        securityGeneration: doc.generation,
        syncState: queue.length ? 'Waiting to sync' : 'Synced',
      };
    }
    if (doc?.kind === 'playbook') {
      result.book = {
        ...(doc.record as PlaybookRecord),
        securityGeneration: doc.generation,
      };
      if (draft) {
        result.book.draft = draft.draft;
        result.book.draftBaseVersion = draft.draftBaseVersion;
        result.book.version = draft.version;
      }
    } else if (
      !raw &&
      draft &&
      !queue.some((op) => op.type === 'flag' || op.type === 'delete')
    ) {
      result.book = draft;
    }
    this.projected.set(id, result);
    return result;
  }

  all(lease: SyncLease) {
    return Array.from(this.projected.keys(), (id) => this.read(id, lease));
  }

  private batch(lease: SyncLease) {
    if (!this.dirty.size) return;
    const batch = Array.from(this.dirty.values().take(64));
    searchTransaction(this.searchDb!, () => {
      for (const id of batch) {
        const { caseRecord, book } = this.read(id, lease);
        if (caseRecord) this.index!.upsert(caseSearchDocument(caseRecord));
        else this.index!.remove('case', id);
        if (book) this.index!.upsert(playbookSearchDocument(book));
        else this.index!.remove('playbook', id);
      }
    });
    for (const id of batch) this.dirty.delete(id);
  }

  private continueBuild(guard: () => SyncLease) {
    this.timer ??= setImmediate(() => {
      this.timer = undefined;
      try {
        this.batch(guard());
        if (this.dirty.size) this.continueBuild(guard);
      } catch {
        // The next authorized search retries the dirty batch.
      }
    });
  }

  searchIndex(lease: SyncLease, guard = () => lease) {
    if (!this.index) {
      this.searchDb = new DatabaseSync(':memory:');
      try {
        this.searchDb.exec('PRAGMA temp_store=MEMORY');
        this.index = new SearchIndex(this.searchDb);
        for (const id of this.projected.keys()) this.dirty.add(id);
      } catch (error) {
        this.searchDb.close();
        this.searchDb = undefined;
        throw new Error('search-unavailable', { cause: error });
      }
    }
    if (this.timer && this.dirty.size) throw Error('search-preparing');
    try {
      this.batch(lease);
    } catch (error) {
      throw new Error('search-unavailable', { cause: error });
    }
    if (this.dirty.size) {
      this.continueBuild(guard);
      throw Error('search-preparing');
    }
    return this.index;
  }

  close() {
    if (this.timer) clearImmediate(this.timer);
    this.timer = undefined;
    this.searchDb?.close();
    this.searchDb = undefined;
    this.index = undefined;
    this.projected.clear();
    this.dirty.clear();
    this.byDocument.clear();
    this.queue.clear();
    this.queuedAt.clear();
  }
}
