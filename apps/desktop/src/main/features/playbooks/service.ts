import { documentContent } from './validation.ts';
import { documentId } from '../../../contracts/document-id.ts';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { screenshotIds } from '../../../contracts/playbook-markdown.ts';
import type {
  PlaybookRecord,
  PlaybookSnapshot,
} from '../../../contracts/playbooks';
import type { CaseOperation, CaseService } from '../cases/service';
import { caseSearchText } from './search.ts';
import { lookupCaseNumber, type LookupKind } from './search-index.ts';
import type { PlaybookStore } from './store';

export class PlaybookService {
  private revision = 0;
  readonly cases: CaseService;
  readonly store: PlaybookStore;
  private changed: (snapshot: PlaybookSnapshot) => void;
  screenshotAllowed: (playbookId: string, screenshotId: string) => boolean =
    () => false;
  constructor(
    cases: CaseService,
    store: PlaybookStore,
    changed: (snapshot: PlaybookSnapshot) => void,
  ) {
    this.cases = cases;
    this.store = store;
    this.changed = changed;
  }
  guard(op: CaseOperation) {
    op.signal.throwIfAborted();
    this.cases.assertContext(op.context);
    if (op.context.context.kind === 'team') {
      this.cases.team!.guard(op);
      return;
    }
    op.guard?.();
    if (!this.cases.store.ready) throw Error('case-masking-required');
  }
  list(op: CaseOperation) {
    if (op.context.context.kind === 'team')
      return this.cases.team!.listBooks(op);
    this.guard(op);
    return this.store
      .playbooks()
      .filter((p) => p.workspaceId === 'personal' && p.ownerId === 'local');
  }
  snapshot(op: CaseOperation): PlaybookSnapshot {
    if (op.context.context.kind === 'team')
      return {
        revision: this.revision,
        playbooks: this.list(op),
        resolutions: this.cases.team!.sync.resolutionDrafts(),
        searchRevision: this.cases.team!.sync.searchRevision(),
      };
    return {
      revision: this.revision,
      playbooks: this.list(op),
      resolutions: this.store
        .resolutions()
        .filter((r) =>
          this.cases.snapshot().cases.some((c) => c.id === r.caseId),
        ),
    };
  }
  emit(op: CaseOperation) {
    this.guard(op);
    this.revision++;
    this.changed(this.snapshot(op));
  }
  refreshTeam() {
    if (this.cases.context().context.kind !== 'team') return;
    this.revision++;
    this.changed({
      revision: this.revision,
      playbooks: this.cases.team?.sync.books() ?? [],
      resolutions: this.cases.team?.sync.resolutionDrafts() ?? [],
      searchRevision: this.cases.team?.sync.searchRevision(),
    });
  }
  read(id: string, op: CaseOperation) {
    id = documentId(id);
    this.guard(op);
    if (op.context.context.kind === 'team')
      return this.cases.team!.book(id, op);
    const p = this.store.playbook(id);
    if (!p || p.workspaceId !== 'personal' || p.ownerId !== 'local')
      throw Error('unknown-playbook');
    return p;
  }
  fromCase(caseId: string, op: CaseOperation) {
    return this.list(op).find(
      (p) => (p.sourceCaseId ?? p.draftFrom) === caseId,
    );
  }
  private searchIndex(op: CaseOperation) {
    return op.context.context.kind === 'team'
      ? this.cases.team!.sync.searchIndex()
      : this.cases.store.searchIndex();
  }
  management(op: CaseOperation) {
    this.guard(op);
    const books = this.searchIndex(op).metadata('playbook');
    this.guard(op);
    return books;
  }
  lookup(kind: LookupKind, query: string, op: CaseOperation) {
    this.guard(op);
    if (typeof query !== 'string' || !query.trim() || query.length > 2000)
      throw Error('invalid-entry');
    let matches;
    if (kind === 'case_number' && op.context.context.kind === 'personal') {
      const number = lookupCaseNumber(query);
      const reference =
        number === undefined
          ? undefined
          : this.cases.store.caseReference(number);
      matches = reference ? [reference] : [];
    } else {
      matches = this.searchIndex(op).lookup(kind, query);
    }
    this.guard(op);
    return { matches: matches.slice(0, 10), overflow: matches.length > 10 };
  }
  search(text: unknown, caseId: unknown, op: CaseOperation) {
    this.guard(op);
    if (text !== undefined && (typeof text !== 'string' || text.length > 2000))
      throw Error('invalid-entry');
    const source =
      caseId === undefined
        ? undefined
        : this.cases.read(documentId(caseId), op);
    const query =
      (text as string | undefined) ?? (source ? caseSearchText(source) : '');
    const result = this.searchIndex(op).search(query, {
      excludeCaseId: source?.id,
    });
    this.guard(op);
    return result;
  }
  remove(id: string, version: number, op: CaseOperation) {
    if (op.context.context.kind === 'team')
      return this.cases.team!.removeBook(id, version, op);
    const p = this.read(id, op);
    if (p.version !== version) throw Error('case-changed');
    this.store.removePlaybook(p.id, version);
    this.emit(op);
  }
  async save(
    id: string | undefined,
    version: number,
    input: unknown,
    op: CaseOperation,
    from?: string,
  ) {
    if (op.context.context.kind === 'team')
      return this.cases.team!.saveBook(id, version, input, op);
    this.guard(op);
    if (!Number.isSafeInteger(version) || version < 0)
      throw Error('invalid-entry');
    const before = id ? this.read(id, op) : undefined;
    if ((before?.version ?? 0) !== version) throw Error('case-changed');
    const target = id ?? randomUUID(),
      content = documentContent(input);
    for (const screenshot of screenshotIds(content.markdown))
      if (!this.screenshotAllowed(target, screenshot))
        throw Error('invalid-screenshot');
    const fields = [
      { id: 'title', text: content.title },
      { id: 'markdown', text: content.markdown },
    ];
    const clean = await this.cases.mask(fields, op);
    content.title = clean[0].text;
    content.markdown = clean[1].text;
    if (
      !isDeepStrictEqual(
        screenshotIds(content.markdown),
        screenshotIds(fields[1].text),
      )
    )
      throw Error('case-masking-failed');
    documentContent(content);
    this.guard(op);
    if (!id && from) {
      const existing = this.fromCase(from, op);
      if (existing) return existing;
    }
    const record: PlaybookRecord = {
      ...before,
      id: target,
      workspaceId: 'personal',
      ownerId: 'local',
      version: version + 1,
      draft: content,
      draftFrom: from ?? before?.draftFrom,
      sourceCaseId: before?.sourceCaseId ?? from,
      updatedAt: new Date().toISOString(),
    };
    this.store.savePlaybook(record, version);
    this.emit(op);
    return record;
  }
  publish(id: string, version: number, op: CaseOperation) {
    if (op.context.context.kind === 'team')
      return this.cases.team!.publish(id, version, op);
    const p = this.read(id, op);
    if (p.version !== version) throw Error('case-changed');
    if (!p.draft) throw Error('no-draft');
    for (const screenshot of screenshotIds(p.draft.markdown))
      if (!this.screenshotAllowed(id, screenshot))
        throw Error('invalid-screenshot');
    const at = new Date().toISOString();
    const record = {
      ...p,
      version: version + 1,
      published: p.draft,
      draft: undefined,
      draftFrom: undefined,
      publishedAt: at,
      updatedAt: at,
      history: [
        ...(p.history ?? []),
        ...(p.published ? [{ at: p.publishedAt!, content: p.published }] : []),
      ],
    };
    this.guard(op);
    this.store.transaction(() => {
      this.store.savePlaybook(record, version);
      if (!p.published || !isDeepStrictEqual(p.published, p.draft))
        this.store.countPublication(p.draftFrom, !!p.published);
    });
    this.emit(op);
    return record;
  }
  discard(id: string, version: number, op: CaseOperation) {
    if (op.context.context.kind === 'team')
      return this.cases.team!.discard(id, version, op);
    const p = this.read(id, op);
    if (p.version !== version) throw Error('case-changed');
    if (!p.published) {
      this.store.removeUnpublishedPlaybook(id, version);
      this.emit(op);
      return;
    }
    this.store.savePlaybook(
      { ...p, version: version + 1, draft: undefined, draftFrom: undefined },
      version,
    );
    this.emit(op);
  }
}
