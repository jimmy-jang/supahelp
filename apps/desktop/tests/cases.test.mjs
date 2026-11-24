import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/main/features/cases/store.ts';
import {
  CaseService,
  CHANGED_SINCE,
  ticketIn,
  caseEvidence,
} from '../src/main/features/cases/service.ts';
import {
  caseMarkdown,
  toCase,
} from '../src/renderer/features/cases/caseDoc.ts';
import { caseEnvironment, caseOperation } from './support/case-environment.mjs';

const directory = mkdtempSync(path.join(tmpdir(), 'supahelp-cases-'));
after(() => rmSync(directory, { recursive: true, force: true }));
let n = 0;
const open = (file = path.join(directory, `cases-${n++}.db`)) => {
  const events = [],
    state = caseEnvironment();
  let tick = 0;
  const service = new CaseService(
    new CaseStore(file),
    (s) => events.push(s),
    state.environment,
    () => new Date(Date.UTC(2026, 10, 9, 9, 0, tick++)).toISOString(),
  );
  return {
    service,
    events,
    file,
    ...state,
    op: () => caseOperation(state.environment.context()),
  };
};
const chat = (
  id,
  title = 'Charged twice in March',
  text = 'Charged twice, see tickets/48213',
) => ({
  id,
  title,
  messages: [
    { role: 'user', text },
    { role: 'assistant', text: 'Ticket #99999 is unrelated.' },
  ],
});
const finding = (text, pill = 'Guess', detail) => ({
  section: 'findings',
  kind: 'item',
  text,
  pill,
  ...(detail ? { detail } : {}),
});

test('pattern masking needs no model and keeps names', async () => {
  const s = open();
  const op = { ...s.op(), selection: undefined };
  assert.deepEqual(
    await s.service.mask(
      [{ id: 'title', text: 'Alex Example alex@example.test sk-test12345678' }],
      op,
    ),
    [{ id: 'title', text: 'Alex Example [EMAIL] [SECRET]' }],
  );
  s.service.close();
});

test('case title renames are masked, persisted and independent of their source chat', async () => {
  const s = open(),
    source = chat('rename-chat');
  const id = await s.service.create(source, s.op());
  const before = s.service.read(id, s.op());
  const saved = await s.service.rename(
    id,
    '  Alex Example alex@example.test refund  ',
    before.title,
    s.op(),
  );
  assert.equal(saved, 'Alex Example [EMAIL] refund');
  assert.equal(source.title, 'Charged twice in March');
  assert.equal(s.events.at(-1).cases[0].title, saved);
  assert.deepEqual(s.service.read(id, s.op()).entries, before.entries);
  await assert.rejects(
    s.service.rename(id, 'Stale', before.title, s.op()),
    /case-changed/,
  );
  const checked = s.prompts.length;
  for (const title of ['', ' ', 'x'.repeat(121), 'Two\nlines', null])
    await assert.rejects(
      s.service.rename(id, title, saved, s.op()),
      /invalid-title/,
    );
  assert.equal(s.prompts.length, checked);
  s.service.close();
  const reopened = open(s.file);
  await reopened.service.prepare(reopened.op());
  assert.equal(reopened.service.read(id, reopened.op()).title, saved);
  reopened.service.close();
});

test('masked metadata, entries and history survive restart with ownership and numbering intact', async () => {
  const a = open();
  const id = await a.service.create(
    chat('chat-1', 'Alex Example alex@example.test'),
    a.op(),
  );
  await a.service.edit(
    id,
    undefined,
    finding('Alex Example: two invoices', 'Confirmed', 'Stripe in_1'),
    a.op(),
  );
  assert.ok(a.prompts.every((prompt) => !prompt.includes('alex@example.test')));
  a.service.close();
  const b = open(a.file);
  await b.service.prepare(b.op());
  const [c] = b.service.snapshot().cases;
  assert.equal(c.id, id);
  assert.equal(c.title, 'Alex Example [EMAIL]');
  assert.equal(c.number, 1);
  assert.equal(c.ticket, 'ZD #48213');
  assert.equal(c.workspaceId, 'personal');
  assert.equal(c.ownerId, 'local');
  assert.deepEqual(c.chatIds, ['chat-1']);
  assert.equal(c.entries[0].text, 'Alex Example: two invoices');
  assert.equal(c.entries[0].version, 1);
  assert.equal(c.changes[0].version, 1);
  b.service.close();
  for (const file of readdirSync(directory).filter((name) =>
    name.startsWith(path.basename(a.file)),
  )) {
    const bytes = readFileSync(path.join(directory, file));
    assert.equal(bytes.includes(Buffer.from('alex@example.test')), false);
  }
});

test('concurrent case creation still gives one case per chat and unique case numbers', async () => {
  const a = open();
  const [id, again] = await Promise.all([
    a.service.create(chat('a'), a.op()),
    a.service.create(chat('a'), a.op()),
  ]);
  assert.equal(id, again);
  await a.service.create(chat('b'), a.op());
  assert.deepEqual(
    a.service
      .snapshot()
      .cases.map((c) => c.number)
      .sort(),
    [1, 2],
  );
  assert.equal(a.events.filter((event) => event.cases.length === 1).length, 1);
  a.service.close();
});

test('human writes are masked, versioned and undoable without being attributed to the AI', async () => {
  const a = open(),
    id = await a.service.create(chat('human'), a.op());
  const op = () => ({ ...a.op(), humanEditRequestId: randomUUID() });
  const first = await a.service.edit(
    id,
    undefined,
    finding('Alex Example checked'),
    op(),
  );
  let record = a.service.read(id, a.op());
  assert.equal(record.entries[0].text, 'Alex Example checked');
  assert.equal(record.entries[0].onBehalfOf, undefined);
  assert.equal(record.changes[0].onBehalfOf, undefined);
  assert.equal(record.changes[0].by, 'local');
  const updated = await a.service.edit(
    id,
    first.entryId,
    finding('Human correction'),
    op(),
    1,
  );
  assert.deepEqual(a.service.undo(id, first.changeId, a.op()), {
    error: CHANGED_SINCE,
  });
  const removed = await a.service.edit(
    id,
    first.entryId,
    undefined,
    op(),
    updated.version,
  );
  assert.equal(a.service.read(id, a.op()).entries.length, 0);
  assert.deepEqual(a.service.undo(id, removed.changeId, a.op()), { ok: true });
  record = a.service.read(id, a.op());
  assert.equal(record.entries[0].text, 'Human correction');
  assert.equal(record.changes.length, 3);
  a.service.close();
});

test('a repeated human add UUID cannot duplicate or overwrite an entry in any case', async () => {
  const a = open(),
    id = await a.service.create(chat('one'), a.op());
  const other = await a.service.create(chat('two'), a.op());
  const requestId = randomUUID(),
    op = { ...a.op(), humanEditRequestId: requestId };
  const added = await a.service.edit(id, undefined, finding('Original'), op);
  assert.equal(added.entryId, requestId);
  await assert.rejects(
    a.service.edit(id, undefined, finding('Duplicate'), op),
    /case-changed/,
  );
  await assert.rejects(
    a.service.edit(other, undefined, finding('Cross-case'), op),
    /case-changed/,
  );
  assert.equal(a.service.read(id, a.op()).entries[0].text, 'Original');
  assert.equal(a.service.read(other, a.op()).entries.length, 0);
  a.service.close();
});

test('human entry edits preserve the Resolution workflow and require a current version', async () => {
  const a = open(),
    id = await a.service.create(chat('protected'), a.op());
  const op = { ...a.op(), humanEditRequestId: randomUUID() };
  const added = await a.service.edit(
    id,
    undefined,
    finding('Original'),
    a.op(),
  );
  for (const version of [undefined, 0, -1, 1.5, NaN])
    await assert.rejects(
      a.service.edit(id, added.entryId, finding('Wrong version'), op, version),
      /invalid-entry|case-changed/,
    );
  await assert.rejects(
    a.service.edit(
      id,
      undefined,
      {
        section: 'resolution',
        kind: 'row',
        label: 'What fixed it',
        text: 'Skip confirmation',
      },
      op,
    ),
    /reserved-field/,
  );
  const resolutionId = randomUUID();
  a.service.store.writeEntry({
    caseId: id,
    entryId: resolutionId,
    value: {
      section: 'resolution',
      kind: 'row',
      label: 'What fixed it',
      text: 'Existing resolution',
    },
    position: 0,
    version: 1,
    expectedVersion: 0,
    by: 'local',
    at: new Date().toISOString(),
  });
  await assert.rejects(
    a.service.edit(id, resolutionId, undefined, op, 1),
    /reserved-field/,
  );
  a.service.close();
});

test('personal snapshots retain only the local owner while inaccessible records remain stored', async () => {
  const a = open();
  const personal = await a.service.create(chat('personal'), a.op()),
    team = await a.service.create(chat('team'), a.op()),
    other = await a.service.create(chat('other'), a.op());
  a.service.close();
  const db = new DatabaseSync(a.file);
  db.exec("INSERT INTO workspaces VALUES ('team', 'org', 'Team', 'team')");
  db.prepare('UPDATE cases SET workspace_id = ? WHERE id = ?').run(
    'team',
    team,
  );
  db.prepare('UPDATE cases SET owner_id = ? WHERE id = ?').run('other', other);
  db.close();
  const b = open(a.file);
  await b.service.prepare(b.op());
  assert.deepEqual(
    b.service.snapshot().cases.map((record) => record.id),
    [personal],
  );
  for (const id of [team, other])
    assert.throws(() => b.service.read(id, b.op()), /unknown-case/);
  b.service.close();
  const retained = new DatabaseSync(a.file);
  assert.equal(
    retained.prepare('SELECT COUNT(*) AS count FROM cases').get().count,
    3,
  );
  retained.close();
});

test('ticket extraction uses user text; findings require usable masked evidence', async () => {
  assert.equal(ticketIn('nothing'), '');
  const a = open(),
    id = await a.service.create(
      chat('c', 'Case', 'Customer reports two charges'),
      a.op(),
    );
  assert.equal(a.service.snapshot().cases[0].ticket, '');
  for (const detail of [
    undefined,
    'not evidence',
    'https://acme.zendesk.com/search?email=alex@example.test',
  ])
    await a.service.edit(
      id,
      undefined,
      finding('Double click ' + String(detail), 'Confirmed', detail),
      a.op(),
    );
  assert.ok(
    a.service
      .snapshot()
      .cases[0].entries.every(
        (entry) => entry.pill === 'Guess' && !entry.detail,
      ),
  );
  for (const value of [
    'Stripe in_1',
    'Linear ENG-1',
    'ZD #123',
    'https://acme.zendesk.com/agent/tickets/123',
    'https://dashboard.stripe.com/test/invoices/in_1',
    'https://linear.app/acme/issue/ENG-1',
  ])
    assert.equal(caseEvidence(value), value);
  for (const value of [
    'https://evil.test/object/123',
    'https://acme.zendesk.com/agent/tickets/123#private',
    'https://user:secret@acme.zendesk.com/agent/tickets/123',
  ])
    assert.equal(caseEvidence(value), undefined);
  a.service.close();
});

test('Undo uses the committed version, handles deletion and refuses repeated or edit-away-and-back Undo', async () => {
  const a = open(),
    id = await a.service.create(chat('d'), a.op());
  const added = await a.service.edit(id, undefined, finding('First'), a.op());
  const other = await a.service.edit(id, undefined, finding('Other'), a.op());
  const edited = await a.service.edit(
    id,
    added.entryId,
    finding('Second'),
    a.op(),
  );
  assert.deepEqual(a.service.undo(id, added.changeId, a.op()), {
    error: CHANGED_SINCE,
  });
  assert.deepEqual(a.service.undo(id, edited.changeId, a.op()), { ok: true });
  assert.throws(
    () => a.service.undo(id, edited.changeId, a.op()),
    /already-undone/,
  );
  assert.deepEqual(a.service.undo(id, added.changeId, a.op()), {
    error: CHANGED_SINCE,
  });
  const removed = await a.service.edit(id, other.entryId, undefined, a.op());
  assert.equal(a.service.snapshot().cases[0].entries.length, 1);
  assert.deepEqual(a.service.undo(id, removed.changeId, a.op()), { ok: true });
  assert.equal(a.service.snapshot().cases[0].entries.length, 2);
  const third = await a.service.edit(id, undefined, finding('Third'), a.op());
  assert.deepEqual(a.service.undo(id, third.changeId, a.op()), { ok: true });
  a.service.close();
});

test('reserved metadata, verified action claims and system-owned entries cannot be changed', async () => {
  const a = open(),
    id = await a.service.create(chat('e'), a.op());
  for (const input of [
    { ...finding('x'), ownerId: 'other' },
    { section: 'actions', kind: 'item', text: 'Refund', pill: 'Verified' },
    { ...finding('x'), customerConfirmed: true },
    { section: 'summary', kind: 'text', text: 'Summary', pill: 'Alex Example' },
    { section: 'findings', kind: 'text', text: 'x' },
  ])
    await assert.rejects(
      a.service.edit(id, undefined, input, a.op()),
      /invalid-entry|reserved-field/,
    );
  const added = await a.service.edit(
    id,
    undefined,
    finding('Protected'),
    a.op(),
  );
  const db = new DatabaseSync(a.file);
  db.prepare('UPDATE entries SET system_owned = 1 WHERE id = ?').run(
    added.entryId,
  );
  db.close();
  await assert.rejects(
    a.service.edit(id, added.entryId, undefined, a.op()),
    /reserved-field/,
  );
  assert.throws(
    () => a.service.undo(id, added.changeId, a.op()),
    /reserved-field/,
  );
  a.service.close();
});

test('Markdown conversion reads masked stored data and never restores raw text through Undo', async () => {
  const a = open(),
    id = await a.service.create(chat('h'), a.op());
  const first = await a.service.edit(
    id,
    undefined,
    finding('Alex Example at 12 Example Road'),
    a.op(),
  );
  const second = await a.service.edit(
    id,
    first.entryId,
    finding('Updated alex@example.test'),
    a.op(),
  );
  assert.deepEqual(a.service.undo(id, second.changeId, a.op()), { ok: true });
  const kase = toCase(a.service.snapshot().cases[0], () => '9:41');
  const md = caseMarkdown(kase, {
    status: 'Investigating',
    person: () => 'You',
  });
  assert.ok(md.includes('Alex Example at 12 Example Road'));
  assert.ok(!md.includes('alex@example.test'));
  a.service.close();
});

test('personal contributors persist across restart, stay local and appear in the case document', async () => {
  const s = open();
  const id = await s.service.create(chat('contributors'), s.op());
  await s.service.assign(id, 'bring-in', 'local', 0, s.op());
  await s.service.assign(id, 'bring-in', 'local', 0, s.op());
  await assert.rejects(
    s.service.assign(id, 'handoff', 'someone', 0, s.op()),
    /case-assignment-denied/,
  );
  s.service.close();
  const reopened = open(s.file);
  await reopened.service.prepare(reopened.op());
  const saved = reopened.service.read(id, reopened.op());
  assert.equal(saved.ownerId, 'local');
  assert.deepEqual(saved.contributorIds, ['local']);
  assert.deepEqual(toCase(saved).doc.contributorIds, ['local']);
  reopened.service.close();
});

test('team assignment verifies owner, eligible recipients and confirmed server state', async () => {
  const s = open();
  const context = {
    ...s.environment.context(),
    context: { kind: 'team', workspaceId: 'workspace' },
  };
  s.environment.context = () => context;
  s.environment.assertContext = (stamp) => assert.deepEqual(stamp, context);
  let record = {
    id: 'case',
    ownerId: context.accountId,
    ownerRevision: 3,
    contributorIds: [],
  };
  const queued = [];
  s.service.team = {
    read: () => record,
    guard: () => ({ accountId: context.accountId }),
    sync: {
      guard: () => {},
      collaboration: async () => ({
        members: [
          { id: 'recipient', name: 'Recipient', role: 'member' },
          { id: 'viewer', role: 'viewer' },
        ],
      }),
      collaborate: async ({
        id: _id,
        caseId,
        type,
        recipientId,
        ownerRevision,
      }) => {
        queued.push({
          action: type,
          id: caseId,
          value: { recipientId, ownerRevision },
        });
        record = { ...record, contributorIds: ['recipient'] };
      },
    },
  };
  const op = () => ({ ...s.op(), context });
  await assert.rejects(
    s.service.assign('case', 'bring-in', 'recipient', 2, op()),
    /case-changed/,
  );
  await assert.rejects(
    s.service.assign('case', 'bring-in', 'viewer', 3, op()),
    /case-assignment-denied/,
  );
  const result = await s.service.assign(
    'case',
    'bring-in',
    'recipient',
    3,
    op(),
  );
  assert.deepEqual(result.contributorIds, ['recipient']);
  assert.deepEqual(queued[0], {
    action: 'bring-in',
    id: 'case',
    value: { recipientId: 'recipient', ownerRevision: 3 },
  });
  await assert.rejects(
    s.service.assign('case', 'handoff', 'recipient', 3, op()),
    /case-assignment-unconfirmed/,
  );
  record = { ...record, ownerId: 'other' };
  await assert.rejects(
    s.service.assign('case', 'bring-in', 'recipient', 3, op()),
    /case-assignment-denied/,
  );
  s.service.close();
});
