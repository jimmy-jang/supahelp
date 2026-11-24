import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NotificationDelivery } from '../src/main/features/notifications/service.ts';
import { parseAppLink } from '../src/main/features/accounts/links.ts';
const id = 'abcdefab-1234-4234-8234-abcdefabcdef';
test('case links accept only opaque IDs on exact owned routes', () => {
  assert.deepEqual(parseAppLink(`https://supahelp.app/case/${id}`), {
    kind: 'case',
    id,
  });
  assert.deepEqual(parseAppLink(`supahelp://case/${id}`), { kind: 'case', id });
  assert.deepEqual(parseAppLink(`https://www.supahelp.app/case/${id}`), {
    kind: 'case',
    id,
  });
  for (const value of [
    `https://evil.test/case/${id}`,
    `https://supahelp.app/case/${id}?token=x`,
    `supahelp://case/412`,
    `https://supahelp.app/case/${id}#x`,
    `supahelp://case/${id}/x`,
  ])
    assert.equal(parseAppLink(value), undefined);
});
test('notification delivery respects settings and never repeats on replay or restart', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'collab-notify-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (v) => Buffer.from(v),
    decryptString: (b) => b.toString(),
  };
  let shown = [];
  const make = () =>
    new NotificationDelivery(join(dir, 'notifications.enc'), encryption, (e) =>
      shown.push(e.id),
    );
  let n = make();
  const prefs = {
    approval: true,
    failure: true,
    question: true,
    'brought-in': true,
    'handed-off': true,
  };
  const e = {
    id: 'old',
    documentId: id,
    category: 'question',
    read: false,
    at: new Date().toISOString(),
  };
  await n.deliver('account/workspace', [e], prefs);
  assert.deepEqual(shown, []);
  await n.settings({ enabled: true, hideDetails: true });
  await n.deliver('account/workspace', [{ ...e, id: 'new' }, e], prefs);
  assert.deepEqual(shown, ['new']);
  n = make();
  await n.deliver('account/workspace', [{ ...e, id: 'new' }, e], prefs);
  assert.deepEqual(shown, ['new']);
  await n.deliver('account/workspace', [{ ...e, id: 'disabled' }], {
    ...prefs,
    question: false,
  });
  assert.deepEqual(shown, ['new']);
});
test('case-specific cancellation blocks an old approval while preserving other receipts', async () => {
  const { ConnectionActions } =
    await import('../src/main/features/connections/actions.ts');
  const records = [],
    a = new ConnectionActions(
      'Tracker',
      () => records,
      async () => {},
      () => {},
    );
  let executed = 0,
    ready;
  const wait = new Promise((r) => (ready = r));
  const run = a
    .run(
      'chat',
      { name: 'change', inputSchema: { type: 'object' } },
      {},
      () => {},
      async () => {
        executed++;
        return { content: [] };
      },
      undefined,
      undefined,
      undefined,
      { caseId: id, resolutionId: 'resolution' },
      () => ready(),
    )
    .catch((e) => e);
  await wait;
  await a.cancelCase(id);
  await run;
  assert.equal(records[0].status, 'cancelled');
  assert.equal(executed, 0);
  await assert.rejects(a.decide(records[0].id, 'approve'), /no longer pending/);
});
test('collaboration history cannot shift Undo onto a different entry', async () => {
  const { toCase } = await import('../src/renderer/features/cases/caseDoc.ts');
  const r = {
    id,
    workspaceId: 'team',
    number: 1,
    title: 'Case',
    status: 'inv',
    ownerId: id,
    ticket: '',
    customer: { name: '', confirmed: false },
    chatIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    entries: [],
    collaborationChanges: [
      { id: 'handoff', by: id, at: new Date().toISOString(), type: 'handoff' },
    ],
    changes: [
      {
        id: 'edit',
        entryId: 'entry',
        at: new Date().toISOString(),
        by: id,
        after: { section: 'summary', kind: 'text', text: 'Saved' },
      },
    ],
  };
  const logs = toCase(r).doc.log;
  assert.equal(logs[0].changeId, undefined);
  assert.equal(logs[1].changeId, 'edit');
});
test('local receipt notifications drop cancelled approvals and keep account boundaries', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'collab-local-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const enc = {
      isEncryptionAvailable: () => true,
      encryptString: (v) => Buffer.from(v),
      decryptString: (b) => b.toString(),
    },
    shown = [];
  const n = new NotificationDelivery(join(dir, 'n.enc'), enc, (e) =>
    shown.push(e.id),
  );
  await n.settings({ enabled: true, hideDetails: true });
  await n.local('account/personal');
  const action = {
    id: 'receipt',
    principal: 'account',
    source: { caseId: id, resolutionId: 'r' },
    status: 'pending',
  };
  await n.observe('account/personal', [action]);
  assert.equal(shown.length, 1);
  assert.equal((await n.local('account/personal')).events.length, 1);
  await n.observe('account/personal', [{ ...action, status: 'cancelled' }]);
  assert.equal((await n.local('account/personal')).events.length, 0);
  await n.observe('other/personal', [{ ...action, status: 'unknown' }]);
  assert.equal((await n.local('other/personal')).events.length, 0);
});
