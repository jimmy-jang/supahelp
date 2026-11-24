import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CaseService } from '../../../src/main/features/cases/service.ts';
import { CaseStore } from '../../../src/main/features/cases/store.ts';
import {
  caseEnvironment,
  caseOperation,
  encryption,
} from '../../support/case-environment.mjs';

// The same chat-link operations must behave the same in both workspace kinds.
async function personal() {
  const { environment } = caseEnvironment();
  const cases = new CaseService(
    new CaseStore(':memory:'),
    () => {},
    environment,
  );
  const op = () => caseOperation(environment.context());
  const ids = [];
  for (const id of ['seed-1', 'seed-2'])
    ids.push(await cases.create({ id, title: id, messages: [] }, op()));
  // Free the seed chats so the cases start unattached, like team cases.
  for (const [i, id] of ids.entries())
    cases.unlinkChat(id, `seed-${i + 1}`, op());
  return { cases, op, ids };
}

function team() {
  const context = {
    generation: 1,
    accountId: 'account',
    context: { kind: 'team', organizationId: 'org', workspaceId: 'workspace' },
  };
  const cases = new CaseService(new CaseStore(':memory:'), () => {}, {
    context: () => context,
    assertContext: () => {},
    encryption,
    mask: () => assert.fail('linking must not mask'),
  });
  const records = ['team-1', 'team-2'].map((id) => ({ id, chatIds: [] }));
  cases.team = {
    read: (id) => {
      const c = records.find((r) => r.id === id);
      if (!c) throw Error('unknown-case');
      return c;
    },
    sync: { cases: () => records, guard() {} },
  };
  const links = new Map();
  cases.teamChats = {
    get: (chatId) => links.get(chatId),
    link: (chatId, caseId) =>
      caseId ? links.set(chatId, caseId) : links.delete(chatId),
    chats: (caseId) =>
      [...links].filter(([, c]) => c === caseId).map(([id]) => id),
  };
  return { cases, op: () => caseOperation(context), ids: ['team-1', 'team-2'] };
}

for (const [kind, setup] of [
  ['personal', personal],
  ['team', team],
])
  test(`${kind}: attach, reject a second case, detach`, async () => {
    const { cases, op, ids } = await setup();
    const [a, b] = ids;
    cases.linkChat(a, 'chat', op());
    cases.linkChat(a, 'chat', op()); // idempotent
    assert.equal(cases.caseForChat('chat'), a);
    assert.deepEqual(cases.read(a, op()).chatIds, ['chat']);
    assert.deepEqual(cases.snapshot().cases.find((c) => c.id === a).chatIds, [
      'chat',
    ]);
    assert.throws(() => cases.linkChat(b, 'chat', op()), /chat-has-case/);
    cases.unlinkChat(a, 'chat', op());
    assert.equal(cases.caseForChat('chat'), undefined);
    assert.deepEqual(cases.read(a, op()).chatIds, []);
    assert.throws(() => cases.unlinkChat(a, 'chat', op()), /invalid-entry/);
    cases.close();
  });
