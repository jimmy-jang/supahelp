import { documentId } from '../../../contracts/document-id.ts';
import { randomUUID } from 'node:crypto';
import type { ResolutionDraft } from '../../../contracts/playbooks';
import type { CaseRecord } from '../../../contracts/cases';
import type { PlaybookService } from '../playbooks/service';

import type { CaseOperation, CaseService } from './service';

export class ResolveService {
  private cases: CaseService;
  private books: PlaybookService;
  private blocked: (caseId: string) => boolean;
  constructor(
    cases: CaseService,
    books: PlaybookService,
    blocked: (caseId: string) => boolean,
  ) {
    this.cases = cases;
    this.books = books;
    this.blocked = blocked;
  }
  canResolve(record: CaseRecord, op: CaseOperation) {
    return (
      record.workspaceId === 'personal' ||
      record.ownerId === op.context.accountId
    );
  }
  source(record: CaseRecord) {
    const { chatIds: _chatIds, ...content } = record;
    return JSON.stringify(content);
  }
  latest(caseId: string, op: CaseOperation) {
    return this.books
      .snapshot(op)
      .resolutions.find((draft) => draft.caseId === caseId && !draft.committed);
  }
  read(id: string, op: CaseOperation) {
    this.books.guard(op);
    const r = this.books
      .snapshot(op)
      .resolutions.find((r) => r.id === documentId(id));
    if (!r) throw Error('no-draft');
    this.cases.read(r.caseId, op);
    return r;
  }
  review(caseId: string, version: number, op: CaseOperation) {
    const c = this.cases.read(caseId, op);
    if (!this.canResolve(c, op)) throw Error('resolve-owner');
    if (c.status === 'done') throw Error('case-resolved');
    const draft = this.latest(caseId, op);
    if (!draft) throw Error('no-draft');
    if (draft.version !== version || draft.source !== this.source(c))
      throw Error('case-changed');
    return draft;
  }
  async save(
    caseId: string,
    requestId: string,
    text: string,
    playbookId: string | undefined,
    op: CaseOperation,
    expectedVersion = 0,
    replaceStale = false,
  ) {
    documentId(requestId);
    if (typeof text !== 'string' || !text.trim() || text.length > 4000)
      throw Error('invalid-entry');
    this.books.guard(op);
    const c = this.cases.read(caseId, op);
    if (!this.canResolve(c, op)) throw Error('resolve-owner');
    if (c.status === 'done') throw Error('case-resolved');
    const source = this.source(c);
    const sync =
      op.context.context.kind === 'team' ? this.cases.team!.sync : undefined;
    if (sync && playbookId) throw Error('sync-unavailable-operation');
    if (sync && c.syncState !== 'Synced') throw Error('resolve-sync');
    const document = sync?.document(caseId);
    if (playbookId && !this.books.read(playbookId, op).published)
      throw Error('unknown-playbook');
    const existing = this.latest(caseId, op);
    if (
      !sync &&
      !existing &&
      this.books.store.resolutions().some((r) => r.id === requestId)
    )
      throw Error('case-changed');
    if (
      existing &&
      (existing.id !== requestId || existing.version !== expectedVersion)
    )
      throw Error('case-changed');
    if (existing && existing.source !== source && !replaceStale)
      throw Error('case-changed');
    if (!existing && expectedVersion !== 0) throw Error('case-changed');
    const [clean] = await this.cases.mask([{ id: 'resolution', text }], op);
    if (
      this.source(this.cases.read(caseId, op)) !== source ||
      sync?.document(caseId).version !== document?.version ||
      JSON.stringify(this.latest(caseId, op)) !== JSON.stringify(existing)
    )
      throw Error('case-changed');
    const r: ResolutionDraft = {
      id: requestId,
      caseId,
      source,
      version: expectedVersion + 1,
      text: clean.text,
      playbookId,
      ...(document && {
        team: {
          workspaceId: c.workspaceId,
          accountId: c.ownerId,
          base: document.version,
          generation: document.generation,
          confirmationId: randomUUID(),
        },
      }),
    };
    if (sync) sync.saveResolutionDraft(r);
    else this.books.store.saveResolution(r);
    this.books.emit(op);
    return r;
  }
  confirm(id: string, version: number, op: CaseOperation) {
    const r = this.read(id, op);
    if (r.version !== version) throw Error('case-changed');
    if (r.committed) return r;
    const check = () => {
      if (this.review(r.caseId, r.version, op).id !== r.id)
        throw Error('case-changed');
      if (this.blocked(r.caseId)) throw Error('resolve-actions');
      if (r.playbookId && !this.books.read(r.playbookId, op).published)
        throw Error('unknown-playbook');
    };
    check();
    if (r.team) {
      const { base, generation, confirmationId } = r.team;
      return this.cases
        .team!.sync.applyResolution(
          r.caseId,
          {
            type: 'confirm-resolution',
            id: confirmationId,
            base,
            generation,
            value: {
              section: 'resolution',
              kind: 'row',
              label: 'What fixed it',
              text: r.text,
            },
          },
          check,
        )
        .then(() => {
          op.committed?.({
            caseId: r.caseId,
            entryId: confirmationId,
            changeId: confirmationId,
            section: 'resolution',
            text: `Resolved · ${r.text.slice(0, 140)}`,
          });
          return { ...r, committed: true };
        });
    }
    const at = new Date().toISOString(),
      entryId = randomUUID(),
      changeId = randomUUID();
    this.cases.store.transaction(() => {
      this.cases.store.writeEntry({
        caseId: r.caseId,
        entryId,
        value: {
          section: 'resolution',
          kind: 'row',
          label: 'What fixed it',
          text: r.text,
        },
        position: this.cases.store.nextPosition(r.caseId, 'resolution'),
        version: 1,
        expectedVersion: 0,
        by: 'local',
        at,
        change: { id: changeId },
      });
      this.cases.store.setResolved(r.caseId, true, at);
      r.committed = true;
      this.books.store.saveResolution(r);
    });
    op.committed?.({
      caseId: r.caseId,
      entryId,
      changeId,
      section: 'resolution',
      text: `Resolved · ${r.text.slice(0, 140)}`,
    });
    this.cases.emit();
    this.books.emit(op);
    return r;
  }
  reopen(caseId: string, op: CaseOperation) {
    const check = () => {
      const c = this.cases.read(caseId, op);
      if (!this.canResolve(c, op)) throw Error('resolve-owner');
      if (c.status !== 'done') throw Error('case-changed');
      if (this.blocked(caseId)) throw Error('resolve-actions');
      if (op.context.context.kind === 'team' && c.syncState !== 'Synced')
        throw Error('resolve-sync');
    };
    check();
    if (op.context.context.kind === 'team') {
      const sync = this.cases.team!.sync;
      const doc = sync.document(caseId);
      return sync.applyResolution(
        caseId,
        {
          type: 'resolve',
          id: randomUUID(),
          base: doc.version,
          generation: doc.generation,
          resolved: false,
        },
        check,
      );
    }
    this.cases.store.setResolved(caseId, false, new Date().toISOString());
    this.cases.emit();
  }
}
