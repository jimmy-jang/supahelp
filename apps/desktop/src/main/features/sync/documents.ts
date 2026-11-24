import { documentContent } from '../playbooks/validation.ts';
import { randomUUID } from 'node:crypto';
import type { EntryValue } from '../../../contracts/cases';
import { screenshotIds } from '../../../contracts/playbook-markdown.ts';
import type { PlaybookRecord } from '../../../contracts/playbooks';
import { checkedTitle } from '../../../contracts/titles.ts';
import type { CaseOperation, CaseService } from '../cases/service';
import { checkedCaseEntry } from '../cases/service.ts';

import type { SyncService } from './service';

// Reuse the existing masking boundary and public document services for all callers.
export class TeamDocuments {
  readonly sync: SyncService;
  private cases: CaseService;
  constructor(sync: SyncService, cases: CaseService) {
    this.sync = sync;
    this.cases = cases;
  }
  guard(op: CaseOperation, write = false) {
    op.signal.throwIfAborted();
    this.cases.assertContext(op.context);
    this.sync.assertContext(op.context);
    op.guard?.();
    op.signal.throwIfAborted();
    return this.sync.guard(write);
  }
  read(id: string, op: CaseOperation) {
    this.guard(op);
    const c = this.sync.caseRecord(id);
    if (!c) throw Error('unknown-case');
    return c;
  }
  create(title: string, op: CaseOperation) {
    this.guard(op, true);
    const id = randomUUID();
    this.sync.queue('create-case', id, { title: checkedTitle(title) });
    return id;
  }
  remove(id: string, op: CaseOperation) {
    const lease = this.guard(op, true);
    this.read(id, op);
    if (lease.role !== 'admin') throw Error('remove-admin-only');
    this.sync.queue('delete', id);
  }
  async rename(
    id: string,
    title: unknown,
    expected: unknown,
    op: CaseOperation,
  ) {
    const c = this.read(id, op);
    if (c.title !== expected) throw Error('case-changed');
    const [clean] = await this.cases.mask(
      [{ id: 'title', text: checkedTitle(title) }],
      op,
    );
    this.guard(op, true);
    this.sync.queue('title', id, { title: checkedTitle(clean.text) });
    return clean.text;
  }
  async edit(
    id: string,
    entryId: string | undefined,
    input: unknown,
    op: CaseOperation,
    expected?: number,
  ) {
    const c = this.read(id, op),
      before = c.entries.find((e) => e.id === entryId);
    if (entryId && !before) throw Error('unknown-entry');
    if (
      before?.systemOwned ||
      before?.section === 'resolution' ||
      (before?.section === 'actions' && before.pill !== 'Proposed')
    )
      throw Error('reserved-field');
    if (expected !== undefined && before?.version !== expected)
      throw Error('case-changed');
    let value = input === undefined ? undefined : checkedCaseEntry(input);
    if (value?.section === 'resolution') throw Error('reserved-field');
    if (value) {
      const fields = ['text', 'label', 'detail'].filter(
        (k) => value![k as keyof EntryValue] !== undefined,
      );
      const clean = await this.cases.mask(
        fields.map((k) => ({
          id: k,
          text: String(value![k as keyof EntryValue]),
        })),
        op,
      );
      value = checkedCaseEntry({
        ...value,
        ...Object.fromEntries(clean.map((f) => [f.id, f.text])),
      });
    }
    this.guard(op, true);
    // As for personal cases, only a change to this entry raced the masking
    // check; other entries may be added meanwhile (parallel tool calls).
    const after = this.read(id, op).entries.find((e) => e.id === entryId);
    if (after?.version !== before?.version) throw Error('case-changed');
    const target = entryId ?? randomUUID();
    const queued = this.sync.queue('entry', id, {
      entryId: target,
      base: before?.version ?? 0,
      value,
      onBehalfOf: !op.humanEditRequestId,
    });
    const update = {
      caseId: id,
      entryId: target,
      changeId: queued.id,
      section: (value ?? before!).section,
      text: `Queued · ${(value ?? before!).text.slice(0, 140)}`,
      version: (before?.version ?? 0) + 1,
    };
    op.committed?.(update);
    return update;
  }
  undo(id: string, changeId: string, op: CaseOperation) {
    const c = this.read(id, op),
      change = c.changes.find((h) => h.id === changeId);
    if (
      !change ||
      change.version !== c.entries.find((e) => e.id === change.entryId)?.version
    )
      return { error: 'Changed since. Edit it instead.' };
    this.guard(op, true);
    this.sync.queue('undo', id, {
      entryId: change.entryId,
      changeId,
      base: change.version,
    });
    return { ok: true as const };
  }
  listBooks(op: CaseOperation) {
    this.guard(op);
    return this.sync.books();
  }
  book(id: string, op: CaseOperation) {
    this.guard(op);
    const p = this.sync.book(id);
    if (!p) throw Error('unknown-playbook');
    return p;
  }
  async saveBook(
    id: string | undefined,
    version: number,
    input: unknown,
    op: CaseOperation,
  ) {
    const lease = this.guard(op, true),
      before = id ? this.book(id, op) : undefined;
    if ((before?.version ?? 0) !== version) throw Error('case-changed');
    const content = documentContent(input),
      clean = await this.cases.mask(
        [
          { id: 'title', text: content.title },
          { id: 'markdown', text: content.markdown },
        ],
        op,
      );
    this.guard(op, true);
    if (id && this.book(id, op).version !== version)
      throw Error('case-changed');
    if (
      JSON.stringify(screenshotIds(clean[1].text)) !==
      JSON.stringify(screenshotIds(content.markdown))
    )
      throw Error('case-masking-failed');
    const record: PlaybookRecord = {
      ...before,
      id: id ?? randomUUID(),
      workspaceId: lease.workspaceId,
      ownerId: before?.ownerId ?? lease.accountId,
      version: version + 1,
      draftBaseVersion:
        this.sync.documents().find((d) => d.id === id)?.version ?? 0,
      draft: documentContent({ title: clean[0].text, markdown: clean[1].text }),
      updatedAt: new Date().toISOString(),
    };
    this.sync.saveDraft(record);
    return record;
  }
  publish(id: string, version: number, op: CaseOperation) {
    const p = this.book(id, op);
    if (p.version !== version || !p.draft) throw Error('case-changed');
    const base = p.draftBaseVersion ?? 0;
    this.sync.queue('publish', id, { base, content: p.draft });
    return p;
  }
  discard(id: string, version: number, op: CaseOperation) {
    const p = this.book(id, op);
    if (p.version !== version) throw Error('case-changed');
    this.sync.discardDraft(id);
  }
  removeBook(id: string, version: number, op: CaseOperation) {
    const p = this.book(id, op),
      lease = this.guard(op, true);
    if (lease.role !== 'admin') throw Error('remove-admin-only');
    if (p.version !== version) throw Error('case-changed');
    this.sync.queue('delete', id);
  }
}
