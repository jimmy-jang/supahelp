import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CaseService } from '../../../src/main/features/cases/service.ts';
import { caseAgent } from '../../../src/main/features/cases/agent.ts';
import { ResolveService } from '../../../src/main/features/cases/resolve.ts';
import { PlaybookService } from '../../../src/main/features/playbooks/service.ts';
import { playbookAgent } from '../../../src/main/features/playbooks/agent.ts';
import { TeamDocuments } from '../../../src/main/features/sync/documents.ts';
import { caseOperation } from '../../support/case-environment.mjs';

test('team chat can create and edit shared cases and Playbooks', async () => {
  const context = {
    generation: 1,
    accountId: 'member',
    context: { kind: 'team', workspaceId: 'workspace' },
  };
  const cases = new CaseService({}, () => {}, {
    context: () => context,
    assertContext: (stamp) => assert.deepEqual(stamp, context),
    mask: async (fields) => fields,
  });
  const records = [],
    books = [],
    drafts = [],
    queued = [];
  const sync = {
    guard: () => ({ workspaceId: 'workspace', accountId: 'member' }),
    sync: async () => {},
    prepareRead: async () => {},
    cases: () => records,
    assertContext() {},
    caseRecord: (id) => records.find((record) => record.id === id),
    book: (id) => books.find((record) => record.id === id),
    books: () => books,
    documents: () => [],
    document: () => ({ version: 2, generation: 1 }),
    resolutionDrafts: () => drafts,
    saveResolutionDraft: (draft) => drafts.push(draft),
    queue(type, id, fields) {
      queued.push(type);
      if (type === 'create-case')
        records.push({
          id,
          number: 1,
          title: fields.title,
          status: 'inv',
          workspaceId: 'workspace',
          ownerId: 'member',
          syncState: 'Synced',
          entries: [],
          changes: [],
          updatedAt: '2026-11-18',
        });
      return { id: `change-${queued.length}` };
    },
    saveDraft(record) {
      const at = books.findIndex((b) => b.id === record.id);
      if (at >= 0) books[at] = record;
      else books.push(record);
    },
  };
  cases.team = new TeamDocuments(sync, cases);
  const links = new Map();
  cases.teamChats = {
    get: (chatId) => links.get(chatId),
    link: (chatId, caseId) => links.set(chatId, caseId),
    chats: (caseId) =>
      [...links].filter(([, c]) => c === caseId).map(([id]) => id),
  };
  const op = caseOperation(context);

  const kase = caseAgent(cases, 'chat-1', op);
  assert.ok(kase, 'case tools are offered in team chat');
  const created = await kase.call('create_case', { title: 'Refund stuck' });
  assert.equal(created.isError, undefined, created.content[0].text);
  assert.equal(cases.caseForChat('chat-1'), records[0].id);
  const entry = await kase.call('add_entry', {
    section: 'summary',
    kind: 'text',
    text: 'Refund never arrives',
  });
  assert.equal(entry.isError, undefined, entry.content[0].text);
  assert.deepEqual(queued, ['create-case', 'entry']);

  const service = new PlaybookService(cases, cases.store.books, () => {});
  const offers = [];
  const agent = playbookAgent(service, [], op, {
    focus: () => undefined,
    caseId: () => cases.caseForChat('chat-1'),
    userText: () => 'Create a Playbook for refunds',
    offer: (action) => offers.push(action.kind),
  });
  assert.ok(agent.tools.some((t) => t.name === 'save_playbook_draft'));
  const saved = await agent.call('save_playbook_draft', {
    title: 'Refunds',
    markdown: 'Check the Stripe refund status.',
  });
  assert.equal(saved.isError, undefined, saved.content[0].text);
  assert.equal(books[0].workspaceId, 'workspace');
  assert.deepEqual(offers, ['saved']);

  const resolve = new ResolveService(cases, service, () => false);
  let review;
  const resolution = caseAgent(cases, 'chat-1', op, {
    resolve,
    offer: (draft) => {
      review = draft;
    },
  });
  assert.equal((await resolution.call('read_case', {})).isError, undefined);
  const draft = await resolution.call('save_resolution_draft', {
    text: 'Retry guard tested by alex@example.test',
    version: 0,
  });
  assert.equal(draft.isError, undefined, draft.content[0].text);
  assert.equal(drafts[0].id, review.id);
  assert.match(drafts[0].text, /\[EMAIL\]/);
  assert.equal(records[0].status, 'inv');
});
