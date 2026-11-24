import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountView, ContextStamp } from '../../../contracts/accounts';
import type { CaseRecord } from '../../../contracts/cases';
import type {
  PlaybookRecord,
  ResolutionDraft,
} from '../../../contracts/playbooks';
import type {
  SyncDocument,
  SyncLease,
  SyncOperation,
  SyncPage,
  SyncReceipt,
  SyncStatus,
} from '../../../contracts/sync';
import type { Encryption } from '../../platform/auth-store';
import { TeamStore } from '../../platform/team-store.ts';
import { projectDocuments } from './projection.ts';

export type SyncTransport = {
  allNotifications?(signal: AbortSignal): Promise<{
    events: import('../../../contracts/sync').CaseNotification[];
    preferences: import('../../../contracts/sync').NotificationPreferences;
  }>;
  getPreferences?(
    signal: AbortSignal,
  ): Promise<import('../../../contracts/sync').NotificationPreferences>;
  collaboration?(
    workspace: string,
    signal: AbortSignal,
  ): Promise<import('../../../contracts/sync').CollaborationSnapshot>;
  lookup?(
    id: string,
    signal: AbortSignal,
  ): Promise<{ workspaceId: string; caseId: string }>;
  preferences?(
    value: import('../../../contracts/sync').NotificationPreferences,
    signal: AbortSignal,
  ): Promise<import('../../../contracts/sync').NotificationPreferences>;
  readEvent?(
    workspace: string,
    id: string,
    signal: AbortSignal,
  ): Promise<unknown>;
  holdAnswer?(
    workspace: string,
    input: import('../../../contracts/sync').AnswerCandidate,
    signal: AbortSignal,
  ): Promise<unknown>;
  cancelAnswer?(
    workspace: string,
    id: string,
    signal: AbortSignal,
  ): Promise<unknown>;
  checkAnswer?(
    workspace: string,
    id: string,
    text: string,
    signal: AbortSignal,
  ): Promise<unknown>;
  privacy?(
    workspace: string,
    id: string,
    signal: AbortSignal,
  ): Promise<{
    kind: 'case' | 'playbook';
    version: number;
    generation: number;
  }>;
  authorize(workspace: string, signal: AbortSignal): Promise<SyncLease>;
  page(
    workspace: string,
    after: number,
    sequence: number | undefined,
    signal: AbortSignal,
  ): Promise<SyncPage>;
  operation(
    workspace: string,
    op: SyncOperation,
    signal: AbortSignal,
  ): Promise<SyncReceipt>;
  upload(
    workspace: string,
    document: string,
    id: string,
    bytes: Buffer,
    signal: AbortSignal,
  ): Promise<void>;
  download(
    workspace: string,
    document: string,
    id: string,
    signal: AbortSignal,
  ): Promise<Buffer>;
};
type Clock = { local: number; lease: SyncLease; observed: number };
const day = 86400000;
export class SyncService {
  private store?: TeamStore;
  private context?: ContextStamp;
  private pending?: Promise<void>;
  private controller = new AbortController();
  private status: SyncStatus = { state: 'disabled', pending: 0 };
  private running = false;
  private invalidationsPending = false;
  private cacheGeneration = 0;
  private sweeping = false;
  private clockNow: () => number;
  private boot?: Clock;
  private monotonic = performance.now();
  constructor(options: {
    directory: string;
    encryption: Encryption;
    transport?: SyncTransport;
    changed: () => void;
    invalidated?: () => void;
    now?: () => number;
  }) {
    this.options = options;
    this.clockNow = options.now ?? Date.now;
  }
  private options: {
    directory: string;
    encryption: Encryption;
    transport?: SyncTransport;
    changed: () => void;
    invalidated?: () => void;
    now?: () => number;
  };
  snapshot(): SyncStatus {
    let review: SyncStatus['review'] = [];
    try {
      this.guard();
      review = this.store!.list<SyncOperation>('review/').map((op) => ({
        id: op.id,
        documentId: op.documentId,
        title: op.title,
        value: op.value,
        content: op.content,
      }));
    } catch {
      /* Locked caches disclose no candidates. */
    }
    return {
      review,
      ...this.status,
      pending: this.store?.list('q/').length ?? 0,
      hidden:
        this.store?.get<Clock>('clock')?.lease.role === 'admin'
          ? (this.store?.get<string[]>('quarantine') ?? [])
          : [],
    };
  }
  private notify() {
    this.options.changed();
  }
  async reconcile(
    account: AccountView | null,
    signedOut = false,
    guard = () => {},
  ) {
    guard();
    if (signedOut && this.context?.accountId) {
      const id = this.context.accountId;
      await this.deactivate();
      guard();
      await rm(join(this.options.directory, id), {
        recursive: true,
        force: true,
      });
      return;
    }
    if (!account) return;
    const root = join(this.options.directory, account.account.id);
    for (const name of await readdir(root).catch(() => [] as string[])) {
      guard();
      if (!account.workspaces.some((w) => w.id === name)) {
        if (
          this.context?.context.kind === 'team' &&
          this.context.context.workspaceId === name
        )
          await this.revoke();
        guard();
        await rm(join(root, name), { recursive: true, force: true });
      }
    }
  }
  async activate(context: ContextStamp) {
    if (
      this.context &&
      (this.store || !this.options.transport) &&
      JSON.stringify(this.context) === JSON.stringify(context)
    )
      return;
    const previous = this.context?.accountId;
    await this.deactivate();
    if (previous && previous !== context.accountId)
      await rm(join(this.options.directory, previous), {
        recursive: true,
        force: true,
      });
    this.context = structuredClone(context);
    if (context.context.kind !== 'team' || !context.accountId) return;
    if (!this.options.transport) {
      this.status = { state: 'disabled', pending: 0 };
      this.notify();
      return;
    }
    this.store = await TeamStore.open(
      join(
        this.options.directory,
        context.accountId,
        context.context.workspaceId,
      ),
      `${context.accountId}/${context.context.workspaceId}`,
      this.options.encryption,
    );
    this.boot = this.store.get<Clock>('clock');
    this.monotonic = performance.now();
    this.status = { state: 'checking', pending: 0 };
    try {
      this.checkLease();
    } catch {
      /* Reauthorization can reopen a locked or new cache. */
    }
    await this.sync();
  }
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const account of await readdir(this.options.directory).catch(
        () => [] as string[],
      )) {
        if (!/^[a-f0-9-]{36}$/.test(account)) continue;
        for (const workspace of await readdir(
          join(this.options.directory, account),
        )) {
          if (
            !/^[a-f0-9-]{36}$/.test(workspace) ||
            (this.context?.accountId === account &&
              this.context.context.kind === 'team' &&
              this.context.context.workspaceId === workspace)
          )
            continue;
          let store: TeamStore | undefined;
          try {
            store = await TeamStore.open(
              join(this.options.directory, account, workspace),
              `${account}/${workspace}`,
              this.options.encryption,
            );
            const clock = store.get<Clock>('clock');
            if (clock && this.clockNow() - clock.local >= 30 * day) {
              await store.destroy();
              store = undefined;
            }
          } catch {
            /* Corrupt/locked caches remain inaccessible; never fall back to plaintext. */
          } finally {
            store?.close();
          }
        }
      }
    } finally {
      this.sweeping = false;
    }
  }
  private validateLease(lease: SyncLease) {
    const context = this.context;
    if (
      !lease ||
      !context ||
      context.context.kind !== 'team' ||
      lease.accountId !== context.accountId ||
      lease.workspaceId !== context.context.workspaceId ||
      lease.organizationId !== context.context.organizationId ||
      !['admin', 'member', 'viewer'].includes(lease.role) ||
      typeof lease.owner !== 'boolean' ||
      !/^[a-f0-9]{64}$/.test(lease.enrollment) ||
      !/^[a-f0-9-]{36}$/.test(lease.epoch) ||
      ![lease.serverTime, lease.expiresAt, lease.graceEnd].every(
        Number.isSafeInteger,
      ) ||
      lease.graceEnd !== lease.expiresAt + 30 * day
    )
      throw Error('sync-locked');
  }
  private checkLease(write = false) {
    if (!this.store || this.store.get<boolean>('revoked'))
      throw Error('sync-locked');
    const clock = this.store.get<Clock>('clock'),
      now = this.clockNow();
    if (
      !clock ||
      !Number.isSafeInteger(clock.local) ||
      !Number.isSafeInteger(clock.observed)
    )
      throw Error('sync-locked');
    this.validateLease(clock.lease);
    const elapsed = Math.max(
      now - clock.local,
      this.boot
        ? performance.now() -
            this.monotonic +
            this.boot.observed -
            this.boot.local
        : 0,
    );
    if (
      now < clock.observed ||
      now < clock.local ||
      !Number.isFinite(elapsed)
    ) {
      this.status.state = 'locked';
      throw Error('sync-locked');
    }
    const server = clock.lease.serverTime + elapsed;
    if (elapsed >= 30 * day) {
      void this.revoke();
      throw Error('sync-expired');
    }
    if (elapsed >= 14 * day || server >= clock.lease.graceEnd) {
      this.status.state = 'locked';
      if (elapsed >= 23 * day)
        this.status.warning =
          'Team cache will be removed after 30 days without authorization.';
      throw Error('sync-locked');
    }
    this.store.put('clock', { ...clock, observed: now });
    if (
      write &&
      (server >= clock.lease.expiresAt || clock.lease.role === 'viewer')
    )
      throw Error('sync-read-only');
    return clock.lease;
  }
  checkExpiry() {
    try {
      this.checkLease();
    } catch {
      this.notify();
    }
  }
  guard(write = false) {
    if (['locked', 'revoked'].includes(this.status.state))
      throw Error('sync-locked');
    if (write && this.status.state === 'read-only')
      throw Error('sync-read-only');
    if (this.invalidationsPending) throw Error('sync-locked');
    return this.checkLease(write);
  }
  exportGuard() {
    const lease = this.guard();
    const clock = this.store!.get<Clock>('clock')!;
    if (
      lease.serverTime + Math.max(0, this.clockNow() - clock.local) >=
        lease.expiresAt &&
      !lease.owner
    )
      throw Error('sync-read-only');
  }
  // ponytail: in-memory, one entry per op queued this run; queued items
  // re-stamp once after a restart. Persist on the op if that matters.
  private queuedAt = new Map<string, string>();
  private projection() {
    try {
      const lease = this.guard();
      const queue = this.store!.list<SyncOperation>('q/');
      return {
        documents: projectDocuments(
          this.store!.list<SyncDocument>('d/'),
          queue,
          lease,
          (op) => {
            let at = this.queuedAt.get(op.id);
            if (!at) this.queuedAt.set(op.id, (at = new Date().toISOString()));
            return at;
          },
        ),
        pending: new Set(queue.map((op) => op.documentId)),
      };
    } catch {
      return { documents: [], pending: new Set<string>() };
    }
  }
  documents(): SyncDocument[] {
    return this.projection().documents;
  }
  cases(): CaseRecord[] {
    const { documents, pending } = this.projection();
    return documents
      .filter((d) => d.kind === 'case')
      .map((d) => ({
        ...structuredClone(d.record as CaseRecord),
        securityGeneration: d.generation,
        syncState: pending.has(d.id)
          ? ('Waiting to sync' as const)
          : ('Synced' as const),
      }));
  }
  books(): PlaybookRecord[] {
    try {
      this.guard();
    } catch {
      return [];
    }
    const list: PlaybookRecord[] = this.documents()
      .filter((d) => d.kind === 'playbook')
      .map((d) => ({
        ...structuredClone(d.record as PlaybookRecord),
        securityGeneration: d.generation,
      }));
    for (const draft of this.store!.list<PlaybookRecord>('draft/')) {
      const index = list.findIndex((p) => p.id === draft.id);
      if (index < 0) list.push(draft);
      else
        list[index] = {
          ...list[index],
          draft: draft.draft,
          draftBaseVersion: draft.draftBaseVersion,
          version: draft.version,
        };
    }
    return list;
  }
  document(id: string) {
    this.guard();
    const doc = this.store!.get<SyncDocument>(`d/${id}`);
    if (!doc) throw Error('sync-deleted');
    return doc;
  }
  resolutionDrafts() {
    try {
      const { accountId, workspaceId } = this.guard();
      const cases = this.cases();
      return this.store!.list<ResolutionDraft>('resolution/').filter(
        (draft) =>
          draft.team?.accountId === accountId &&
          draft.team.workspaceId === workspaceId &&
          cases.some(
            (c) =>
              c.id === draft.caseId &&
              c.ownerId === accountId &&
              c.status !== 'done' &&
              c.securityGeneration === draft.team?.generation,
          ),
      );
    } catch {
      return [];
    }
  }
  saveResolutionDraft(draft: ResolutionDraft) {
    this.guard(true);
    this.store!.put(`resolution/${draft.caseId}`, draft);
  }
  async applyResolution(
    caseId: string,
    fields: Pick<
      SyncOperation,
      'id' | 'type' | 'base' | 'generation' | 'value' | 'resolved'
    >,
    check: () => void,
  ) {
    const store = this.store;
    try {
      await this.online(async (transport, workspace, signal) => {
        check();
        const { enrollment, epoch } = this.guard(true);
        return transport.operation(
          workspace,
          { ...fields, documentId: caseId, enrollment, epoch },
          signal,
        );
      });
    } catch (error) {
      if (
        ['case-changed', 'forbidden'].includes(
          (error as { code?: string }).code ?? '',
        )
      )
        await this.sync();
      throw error;
    }
    if (!store || this.store !== store) throw Error('case-context');
    if (fields.type === 'confirm-resolution') {
      const key = `resolution/${caseId}`;
      if (store.get<ResolutionDraft>(key)?.team?.confirmationId === fields.id)
        store.remove(key);
    }
    await this.sync();
  }
  queue(
    type: SyncOperation['type'],
    documentId: string,
    fields: Partial<SyncOperation> = {},
  ) {
    const lease = this.guard(type !== 'flag'),
      doc = this.store!.get<SyncDocument>(`d/${documentId}`);
    const op: SyncOperation = {
      ...fields,
      id: randomUUID(),
      type,
      documentId,
      enrollment: lease.enrollment,
      epoch: lease.epoch,
      generation: fields.generation ?? doc?.generation ?? 1,
      base: fields.base ?? doc?.version ?? 0,
    };
    this.store!.put(`q/${op.id}`, op);
    // The pending count shows the queued save. Marking the cache 'offline'
    // here would make the next sync lock reads as if it were a reconnect.
    this.notify();
    void this.sync();
    return op;
  }
  saveDraft(record: PlaybookRecord) {
    this.guard(true);
    this.store!.put(`draft/${record.id}`, record);
    this.notify();
  }
  discardDraft(id: string) {
    this.guard(true);
    this.store!.remove(`draft/${id}`);
    this.notify();
  }
  async saveImage(book: string, id: string, bytes: Buffer) {
    this.guard(true);
    if (bytes.length > 2 * 1024 * 1024) throw Error('sync-image-limit');
    this.store!.put(`a/${book}/${id}`, bytes.toString('base64'));
    this.notify();
  }
  imageAllowed(book: string, id: string) {
    try {
      this.guard();
      return (
        !!this.store!.get(`a/${book}/${id}`) ||
        this.books().some(
          (p) =>
            p.id === book &&
            JSON.stringify([p.published, ...(p.history ?? [])]).includes(
              `playbook-image:${id}`,
            ),
        )
      );
    } catch {
      return false;
    }
  }
  async image(book: string, id: string) {
    this.guard();
    const local = this.store!.get<string>(`a/${book}/${id}`);
    if (local) return Buffer.from(local, 'base64');
    const context = this.context,
      generation = this.cacheGeneration,
      controller = this.controller;
    const data = await this.options.transport!.download(
      this.workspace(),
      book,
      id,
      controller.signal,
    );
    if (
      this.context !== context ||
      controller.signal.aborted ||
      generation !== this.cacheGeneration
    )
      throw Error('case-context');
    this.guard();
    this.store!.put(`a/${book}/${id}`, data.toString('base64'));
    return data;
  }
  private workspace() {
    if (this.context?.context.kind !== 'team') throw Error('case-context');
    return this.context.context.workspaceId;
  }
  // A synced cache serves reads now and refreshes behind them; the 60s poll
  // already reads this cache, so waiting on the network only adds latency.
  // Reconnects, lease changes and pending invalidations still wait.
  async prepareRead() {
    if (
      ['synced', 'read-only'].includes(this.status.state) &&
      !this.invalidationsPending &&
      this.store?.get('clock')
    ) {
      void this.sync().catch(() => {});
      return;
    }
    await this.sync();
  }
  async sync() {
    if (this.pending) return this.pending;
    if (!this.store || !this.options.transport) return;
    const controller = this.controller,
      store = this.store,
      workspace = this.workspace(),
      context = this.context;
    const valid = () => {
      controller.signal.throwIfAborted();
      if (this.store !== store || this.context !== context)
        throw Error('case-context');
    };
    const run = async () => {
      this.running = true;
      try {
        const old = store.get<Clock>('clock');
        const steady =
          !!old && ['synced', 'read-only'].includes(this.status.state);
        const lease = await this.options.transport!.authorize(
          workspace,
          controller.signal,
        );
        valid();
        this.validateLease(lease);
        if (
          lease.accountId !== context!.accountId ||
          lease.workspaceId !== workspace
        )
          throw Error('sync-locked');
        const changed =
          !!old &&
          (!!store.get<boolean>('revoked') ||
            old.lease.enrollment !== lease.enrollment ||
            old.lease.epoch !== lease.epoch ||
            this.clockNow() - old.local >= 30 * day);
        // Reconnects and lease changes gate the cache until invalidations commit.
        // A routine poll on a synced cache must not, or any save racing it fails as locked.
        if (!steady || changed) this.invalidationsPending = true;
        if (changed) {
          this.cacheGeneration++;
          await store.rotate(this.options.encryption);
          valid();
          this.options.invalidated?.();
        }
        // Pin a stable high watermark; incremental pages and cursor commit atomically.
        const cursor = store.get<{
          after: number;
          epoch: string;
          enrollment: string;
        }>('cursor');
        const full =
          !cursor ||
          cursor.epoch !== lease.epoch ||
          cursor.enrollment !== lease.enrollment;
        let after = full ? 0 : cursor.after,
          sequence: number | undefined,
          docs: SyncDocument[] = [],
          hidden: string[] = [],
          quarantined: string[] = [];
        for (let pages = 0; pages < 1000; pages++) {
          const page = await this.options.transport!.page(
            workspace,
            after,
            sequence,
            controller.signal,
          );
          valid();
          this.validateLease(page.lease);
          if (
            !Number.isSafeInteger(page.sequence) ||
            !Number.isSafeInteger(page.after) ||
            page.after < after ||
            page.after > page.sequence ||
            typeof page.done !== 'boolean' ||
            !Array.isArray(page.documents) ||
            page.documents.length > 100 ||
            !Array.isArray(page.deleted) ||
            !Array.isArray(page.quarantined) ||
            page.documents.some(
              (d) =>
                !d ||
                !/^[a-f0-9-]{36}$/.test(d.id) ||
                !['case', 'playbook'].includes(d.kind) ||
                !Number.isSafeInteger(d.version) ||
                !Number.isSafeInteger(d.generation) ||
                d.record?.workspaceId !== workspace ||
                d.record.id !== d.id,
            )
          )
            throw Error('sync-locked');
          if (
            page.lease.enrollment !== lease.enrollment ||
            page.lease.epoch !== lease.epoch
          )
            throw Error('bootstrap-required');
          sequence = page.sequence;
          docs.push(...page.documents);
          hidden.push(...page.deleted, ...page.quarantined);
          quarantined.push(...page.quarantined);
          if (page.done) break;
          if (page.after <= after || pages === 999) throw Error('sync-locked');
          after = page.after;
        }
        store.transaction(() => {
          const present = new Set(docs.map((d) => d.id));
          for (const previous of store.list<SyncDocument>('d/'))
            if (full && !present.has(previous.id)) {
              store.remove(`d/${previous.id}`);
              store.remove(`draft/${previous.id}`);
              store.remove(`resolution/${previous.id}`);
              store.removePrefix(`a/${previous.id}/`);
              for (const rejected of store.list<SyncOperation>('review/'))
                if (rejected.documentId === previous.id)
                  store.remove(`review/${rejected.id}`);
            }
          for (const d of docs) {
            const before = store.get<SyncDocument>(`d/${d.id}`);
            if (
              d.kind === 'case' &&
              ((d.record as CaseRecord).ownerId !== lease.accountId ||
                (d.record as CaseRecord).status === 'done')
            )
              store.remove(`resolution/${d.id}`);
            if (before && before.generation !== d.generation) {
              this.cacheGeneration++;
              store.remove(`draft/${d.id}`);
              store.remove(`resolution/${d.id}`);
              store.removePrefix(`a/${d.id}/`);
              for (const op of store.list<SyncOperation>('q/'))
                if (op.documentId === d.id && op.generation !== d.generation)
                  store.remove(`q/${op.id}`);
              for (const op of store.list<SyncOperation>('review/'))
                if (op.documentId === d.id) store.remove(`review/${op.id}`);
              this.options.invalidated?.();
            }
            store.put(`d/${d.id}`, d);
          }
          for (const id of hidden) {
            store.remove(`d/${id}`);
            store.remove(`draft/${id}`);
            store.remove(`resolution/${id}`);
            store.removePrefix(`a/${id}/`);
            for (const rejected of store.list<SyncOperation>('review/'))
              if (rejected.documentId === id)
                store.remove(`review/${rejected.id}`);
          }
          for (const op of store.list<SyncOperation>('q/'))
            if (
              hidden.includes(op.documentId) &&
              !(op.type === 'remediate' && quarantined.includes(op.documentId))
            )
              store.remove(`q/${op.id}`);
          store.put(
            'quarantine',
            [
              ...new Set([
                ...(full ? [] : (store.get<string[]>('quarantine') ?? [])),
                ...quarantined,
              ]),
            ].filter((id) => !docs.some((d) => d.id === id)),
          );
          store.put('cursor', {
            after: sequence ?? 0,
            epoch: lease.epoch,
            enrollment: lease.enrollment,
          });
          store.put('clock', {
            lease,
            local: this.clockNow(),
            observed: this.clockNow(),
          });
        });
        this.invalidationsPending = false;
        if (hidden.length) {
          this.cacheGeneration++;
          this.options.invalidated?.();
        }
        this.boot = store.get('clock');
        this.monotonic = performance.now();
        if (lease.serverTime >= lease.expiresAt) {
          this.status.state = 'read-only';
          this.notify();
        }
        let wrote = false,
          quotaHit = false;
        for (const op of store.list<SyncOperation>('q/')) {
          if (lease.serverTime >= lease.expiresAt && op.type !== 'flag')
            continue;
          valid();
          try {
            if (op.type === 'publish' && op.content) {
              for (const match of op.content.markdown.matchAll(
                /playbook-image:([a-zA-Z0-9-]+)/g,
              )) {
                const value = store.get<string>(
                  `a/${op.documentId}/${match[1]}`,
                );
                if (value)
                  await this.options.transport!.upload(
                    workspace,
                    op.documentId,
                    match[1],
                    Buffer.from(value, 'base64'),
                    controller.signal,
                  );
                valid();
              }
            }
            await this.options.transport!.operation(
              workspace,
              op,
              controller.signal,
            );
            valid();
            store.remove(`q/${op.id}`);
            if (
              op.type === 'publish' &&
              JSON.stringify(
                store.get<PlaybookRecord>(`draft/${op.documentId}`)?.draft,
              ) === JSON.stringify(op.content)
            )
              store.remove(`draft/${op.documentId}`);
            wrote = true;
          } catch (error) {
            const code = (error as { code?: string }).code;
            if (code === 'sync-limit') {
              quotaHit = true;
              this.status.warning =
                'A document or pilot storage limit was reached. Pending work stays encrypted on this computer; deletions can still sync.';
              continue;
            }
            if (
              [
                'sync-deleted',
                'sync-remediated',
                'case-changed',
                'operation-conflict',
                'bootstrap-required',
                'invalid-input',
                'invalid-screenshot',
              ].includes(code ?? '')
            ) {
              // Preserve only safe Playbook drafts for explicit review; never replay a rejected mutation.
              if (
                [
                  'case-changed',
                  'operation-conflict',
                  'invalid-input',
                  'invalid-screenshot',
                ].includes(code ?? '')
              )
                store.put(`review/${op.id}`, op);
              store.remove(`q/${op.id}`);
              if (code === 'sync-deleted' || code === 'sync-remediated') {
                this.cacheGeneration++;
                store.remove(`d/${op.documentId}`);
                store.remove(`draft/${op.documentId}`);
                store.remove(`resolution/${op.documentId}`);
                store.removePrefix(`a/${op.documentId}/`);
                this.options.invalidated?.();
                wrote = true;
              }
              this.status.warning =
                'A shared change needs review. Refresh the document and try again.';
              continue;
            }
            throw error;
          }
        }
        this.status.state = quotaHit
          ? 'error'
          : lease.serverTime >= lease.expiresAt
            ? 'read-only'
            : 'synced';
        if (
          !quotaHit &&
          !store.list('q/').length &&
          !store.list('review/').length
        )
          this.status.warning = undefined;
        this.notify();
        return wrote;
      } catch (error) {
        if (controller.signal.aborted) return;
        const code = (error as { code?: string }).code;
        if (code === 'account-session-revoked') {
          const principal = this.context?.accountId;
          await this.revoke();
          if (principal)
            await rm(join(this.options.directory, principal), {
              recursive: true,
              force: true,
            });
          return;
        }
        if (code === 'sync-revoked') {
          await this.revoke();
          return;
        }
        if (
          code === 'sync-locked' ||
          (error as { status?: number }).status === 401
        ) {
          this.status.state = 'locked';
          this.options.invalidated?.();
        } else if (code === 'sync-read-only') this.status.state = 'read-only';
        else {
          try {
            this.guard();
            this.status.state = 'offline';
          } catch {
            this.status.state = 'locked';
          }
        }
        this.notify();
      } finally {
        this.running = false;
      }
    };
    this.pending = run().then(async (wrote) => {
      this.pending = undefined;
      if (wrote) await this.sync();
    });
    return this.pending;
  }
  async collaboration(): Promise<
    import('../../../contracts/sync').CollaborationSnapshot
  > {
    const value = await this.online((t, w, s) => {
      if (!t.collaboration) throw Error('sync-disabled');
      return t.collaboration(w, s);
    });
    if (this.options.transport?.allNotifications) {
      const global = await this.online((t, _w, s) => t.allNotifications!(s));
      return { ...value, ...global };
    }
    return value;
  }
  async online<T>(
    work: (
      transport: SyncTransport,
      workspace: string,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> {
    // Reads must wait for the transaction that applies revocations and privacy changes.
    if (this.pending) await this.pending;
    this.guard();
    const context = this.context,
      store = this.store,
      controller = this.controller,
      w = this.workspace();
    const valid = () => {
      if (
        context !== this.context ||
        store !== this.store ||
        controller.signal.aborted
      )
        throw Error('case-context');
      this.guard();
    };
    try {
      const lease = await this.options.transport!.authorize(
        w,
        controller.signal,
      );
      if (this.pending) await this.pending;
      valid();
      const old = this.guard();
      if (lease.enrollment !== old.enrollment || lease.epoch !== old.epoch) {
        await this.sync();
        throw Error('case-context');
      }
      const result = await work(this.options.transport!, w, controller.signal);
      if (this.pending) await this.pending;
      valid();
      return result;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'sync-revoked' || code === 'account-session-revoked')
        await this.revoke();
      throw error;
    }
  }
  async collaborate(input: {
    id: string;
    caseId: string;
    type: 'bring-in' | 'handoff' | 'assign-question';
    recipientId?: string;
    ownerRevision?: number;
    entryId?: string;
    base?: number;
  }) {
    await this.sync();
    this.guard(true);
    const c = this.cases().find((c) => c.id === input.caseId);
    if (!c) throw Error('unknown-case');
    if (
      input.type !== 'assign-question' &&
      c.ownerId !== this.guard().accountId
    )
      throw Error('reserved-field');
    const lease = this.guard();
    const op: SyncOperation = {
      id: input.id,
      documentId: input.caseId,
      type: input.type,
      recipientId: input.recipientId,
      ownerRevision: input.ownerRevision,
      entryId: input.entryId,
      base: input.base ?? 0,
      enrollment: lease.enrollment,
      epoch: lease.epoch,
      generation: c.securityGeneration ?? 1,
    };
    const key = `command/${input.id}`,
      old = this.store!.get<SyncOperation>(key);
    if (old && JSON.stringify(old) !== JSON.stringify(op))
      throw Error('case-changed');
    this.store!.put(key, op);
    await this.online((t, w, s) => t.operation(w, op, s));
    this.store!.remove(key);
    await this.sync();
    return this.collaboration();
  }
  async privacy(id: string) {
    this.guard();
    return this.options.transport!.privacy!(
      this.workspace(),
      id,
      this.controller.signal,
    );
  }
  async revoke() {
    this.cacheGeneration++;
    this.controller.abort();
    this.controller = new AbortController();
    const store = this.store;
    this.store = undefined;
    this.status = { state: 'revoked', pending: 0 };
    try {
      store?.put('revoked', true);
    } catch {
      this.status.warning =
        'Local cache removal needs another attempt. Team access remains blocked.';
    }
    this.options.invalidated?.();
    this.notify();
    if (store)
      try {
        await store.destroy();
      } catch {
        this.status.warning =
          'Local cache removal needs another attempt. Team access remains blocked.';
        this.notify();
      }
  }
  async deactivate() {
    this.cacheGeneration++;
    this.controller.abort();
    const pending = this.pending;
    if (pending && this.running) await pending;
    this.pending = undefined;
    this.controller = new AbortController();
    this.store?.close();
    this.store = undefined;
    this.context = undefined;
    this.status = { state: 'disabled', pending: 0 };
    this.boot = undefined;
    this.invalidationsPending = false;
  }
}
