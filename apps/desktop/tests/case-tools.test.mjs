import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CaseStore } from '../src/main/features/cases/store.ts';
import { CaseService } from '../src/main/features/cases/service.ts';
import { caseAgent } from '../src/main/features/cases/agent.ts';
import { connectedInstructions } from '../src/main/integrations/connector-agent.ts';
import { caseEnvironment, caseOperation } from './support/case-environment.mjs';

const finding = (text = 'Two invoices') => ({
  section: 'findings',
  kind: 'item',
  text,
  pill: 'Confirmed',
  detail: 'Stripe in_1',
});
async function setup(t) {
  const home = await mkdtemp(join(tmpdir(), 'supahelp-case-tools-')),
    state = caseEnvironment();
  const cases = new CaseService(
    new CaseStore(join(home, 'cases.db')),
    () => {},
    state.environment,
  );
  const op = () => caseOperation(state.environment.context());
  const a = await cases.create(
    { id: 'chat-a', title: 'A', messages: [] },
    op(),
  );
  const b = await cases.create(
    { id: 'chat-b', title: 'B', messages: [] },
    op(),
  );
  const updates = [],
    controller = new AbortController();
  const agent = caseAgent(cases, 'chat-a', {
    ...op(),
    signal: controller.signal,
    committed: (update) => updates.push(update),
  });
  t.after(async () => {
    cases.close();
    await rm(home, { recursive: true, force: true });
  });
  return { ...state, cases, op, a, b, agent, controller, updates };
}
const data = (result) => JSON.parse(result.content[0].text);

test('case tools target only the main-owned attachment and return committed IDs and versions', async (t) => {
  const s = await setup(t);
  assert.ok(caseAgent(s.cases, 'no-case', s.op()));
  assert.deepEqual(
    s.agent.tools.map((tool) => tool.name),
    [
      'search_references',
      'create_case',
      'list_case_people',
      'assign_person',
      'read_case',
      'add_entry',
      'update_entry',
      'remove_entry',
    ],
  );
  const added = data(
    await s.agent.call('add_entry', finding('Alex Example found two invoices')),
  );
  assert.equal(added.caseId, s.a);
  assert.equal(added.version, 1);
  assert.equal(s.updates.length, 1);
  assert.equal(s.updates[0].changeId, added.changeId);
  const read = data(await s.agent.call('read_case', {}));
  assert.equal(read.entries[0].text, 'Alex Example found two invoices');
  const updated = data(
    await s.agent.call('update_entry', {
      entryId: added.entryId,
      version: 1,
      value: finding('Updated'),
    }),
  );
  assert.equal(updated.version, 2);
  assert.equal(
    (await s.agent.call('remove_entry', { entryId: added.entryId, version: 1 }))
      .isError,
    true,
  );
  const removed = data(
    await s.agent.call('remove_entry', { entryId: added.entryId, version: 2 }),
  );
  assert.equal(removed.version, 3);
  assert.equal(s.updates.length, 3);
  assert.deepEqual(s.cases.read(s.b, s.op()).entries, []);
  assert.deepEqual(s.cases.read(s.a, s.op()).entries, []);
});

test('arbitrary targets, actor metadata, system authority and malformed operation keys are rejected', async (t) => {
  const s = await setup(t);
  const other = await s.cases.edit(s.b, undefined, finding(), s.op());
  for (const [name, args] of [
    ['read_case', { caseId: s.b }],
    ['add_entry', { ...finding(), caseId: s.b }],
    ['add_entry', { ...finding(), workspaceId: 'team' }],
    ['add_entry', { ...finding(), by: 'other' }],
    ['add_entry', { ...finding(), customerConfirmed: true }],
    [
      'add_entry',
      {
        section: 'resolution',
        kind: 'row',
        label: 'What fixed it',
        text: 'Draft only',
      },
    ],
    [
      'add_entry',
      { section: 'actions', kind: 'item', text: 'Refunded', pill: 'Verified' },
    ],
    ['remove_entry', { entryId: other.entryId, version: 1 }],
    [
      'update_entry',
      { entryId: other.entryId, version: 1, value: finding(), caseId: s.b },
    ],
    ['remove_entry', { entryId: other.entryId, version: 0 }],
    ['other_tool', {}],
  ])
    assert.equal((await s.agent.call(name, args)).isError, true);
  assert.equal(s.updates.length, 0);
  assert.deepEqual(s.cases.read(s.a, s.op()).entries, []);
  assert.equal(s.cases.read(s.b, s.op()).entries.length, 1);
});

test('canceled and old-context capabilities cannot read or commit, while personal ownership survives sign-in', async (t) => {
  const s = await setup(t);
  s.controller.abort();
  assert.equal((await s.agent.call('read_case', {})).isError, true);
  assert.equal((await s.agent.call('add_entry', finding())).isError, true);
  const old = caseAgent(s.cases, 'chat-a', s.op());
  s.switchContext({
    generation: 2,
    accountId: 'account-b',
    context: { kind: 'personal' },
  });
  assert.equal((await old.call('read_case', {})).isError, true);
  assert.equal((await old.call('add_entry', finding())).isError, true);
  const current = caseAgent(s.cases, 'chat-a', s.op());
  assert.equal((await current.call('read_case', {})).isError, undefined);
  assert.equal(s.cases.read(s.a, s.op()).ownerId, 'local');
});

test('AI can add the current person as a contributor, retaining ownership and isolating the case', async (t) => {
  const s = await setup(t);
  assert.deepEqual(data(await s.agent.call('list_case_people', {})), {
    people: [{ id: 'local', name: 'You', role: 'on this computer' }],
    currentPersonId: 'local',
  });
  const args = { action: 'bring-in', recipientId: 'local', ownerRevision: 0 };
  assert.equal(
    (await s.agent.call('assign_person', { ...args, caseId: s.b })).isError,
    true,
  );
  assert.equal(
    (await s.agent.call('assign_person', { ...args, recipientId: 'stranger' }))
      .isError,
    true,
  );
  assert.equal(
    (await s.agent.call('assign_person', { ...args, ownerRevision: 1 }))
      .isError,
    true,
  );
  assert.equal((await s.agent.call('assign_person', args)).isError, undefined);
  await s.agent.call('assign_person', args);
  const saved = data(await s.agent.call('read_case', {}));
  assert.equal(saved.ownerId, 'local');
  assert.deepEqual(saved.contributorIds, ['local']);
  assert.deepEqual(s.cases.read(s.b, s.op()).contributorIds, []);
  s.controller.abort();
  assert.equal((await s.agent.call('assign_person', args)).isError, true);
});

test('chat can create one masked case, retry creation and edit it in the same turn', async (t) => {
  const s = await setup(t);
  const agent = caseAgent(s.cases, 'new-chat', s.op());
  assert.equal((await agent.call('read_case', {})).isError, true);
  assert.equal((await agent.call('create_case', { title: ' ' })).isError, true);
  assert.equal(
    (await agent.call('create_case', { title: 'A', caseId: s.a })).isError,
    true,
  );
  const created = data(
    await agent.call('create_case', { title: 'Alex Example invoice retries' }),
  );
  assert.equal(created.title, 'Alex Example invoice retries');
  assert.deepEqual(
    data(await agent.call('create_case', { title: 'Retry' })),
    created,
  );
  await agent.call('add_entry', finding('Possible retry issue'));
  assert.equal(data(await agent.call('read_case', {})).entries.length, 1);
  assert.equal(s.cases.snapshot().cases.length, 3);
});

test('case creation cancellation leaves no case', async (t) => {
  const s = await setup(t);
  const controller = new AbortController();
  const agent = caseAgent(s.cases, 'new-chat', {
    ...s.op(),
    signal: controller.signal,
  });
  controller.abort();
  assert.equal(
    (await agent.call('create_case', { title: 'Invoices' })).isError,
    true,
  );
  assert.equal(s.cases.caseForChat('new-chat'), undefined);
});

test('case instructions match connected creation capability', () => {
  const connected = connectedInstructions(['supahelp-case']);
  assert.match(connected, /When asked to create a case, call create_case/);
  assert.doesNotMatch(connected, /You cannot create a case/);
  assert.doesNotMatch(
    connectedInstructions([]),
    /When asked to create a case, call create_case/,
  );
});

test('instructions send attached-Playbook questions to read_playbook, not read_case', () => {
  const text = connectedInstructions(['supahelp-case', 'supahelp-playbooks']);
  assert.match(text, /When read_playbook is available, a Playbook is attached/);
  assert.match(text, /When a case is attached, use read_case/);
});
