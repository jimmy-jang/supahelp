import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyncService } from '../../../src/main/features/sync/service.ts';

const day = 86_400_000;
const now = 1_800_000_000_000;
const lease = {
  accountId: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  workspaceId: '33333333-3333-3333-3333-333333333333',
  role: 'member',
  owner: false,
  enrollment: 'a'.repeat(64),
  epoch: '44444444-4444-4444-4444-444444444444',
  serverTime: now,
  expiresAt: now + 10 * day,
  graceEnd: now + 40 * day,
};

function setup(state) {
  let releasePage;
  const pageGate = new Promise((resolve) => (releasePage = resolve));
  const service = new SyncService({
    directory: 'unused',
    encryption: {},
    changed() {},
    now: () => now,
    transport: {
      authorize: async () => lease,
      page: async () => {
        await pageGate;
        return {
          lease,
          sequence: 0,
          after: 0,
          done: true,
          documents: [],
          deleted: [],
          quarantined: [],
        };
      },
    },
  });
  const rows = new Map([
    ['clock', { lease, local: now, observed: now }],
    ['cursor', { after: 0, epoch: lease.epoch, enrollment: lease.enrollment }],
  ]);
  service.store = {
    get: (k) => structuredClone(rows.get(k)),
    put: (k, v) => rows.set(k, v),
    remove: (k) => rows.delete(k),
    removePrefix() {},
    list: () => [],
    transaction: (run) => run(),
  };
  service.context = {
    accountId: lease.accountId,
    context: {
      kind: 'team',
      organizationId: lease.organizationId,
      workspaceId: lease.workspaceId,
    },
  };
  service.status = { state, pending: 0 };
  return { service, releasePage };
}

test('a save during a routine poll of a synced cache is not locked', async () => {
  const { service, releasePage } = setup('synced');
  const running = service.sync();
  await new Promise((r) => setImmediate(r));
  assert.equal(service.guard(true).workspaceId, lease.workspaceId);
  releasePage();
  await running;
});

test('a reconnect still gates the cache until invalidations commit', async () => {
  const { service, releasePage } = setup('offline');
  const running = service.sync();
  await new Promise((r) => setImmediate(r));
  assert.throws(() => service.guard(true), /^Error: sync-locked$/);
  releasePage();
  await running;
  assert.equal(service.guard(true).workspaceId, lease.workspaceId);
});

test('reads of a synced cache do not wait for the network', async () => {
  const { service, releasePage } = setup('synced');
  let done = false;
  await service.prepareRead().then(() => (done = true));
  assert.equal(done, true);
  releasePage();
  await service.pending;
});

test('reads after a reconnect wait for the sync to commit', async () => {
  const { service, releasePage } = setup('offline');
  let done = false;
  const reading = service.prepareRead().then(() => (done = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false);
  releasePage();
  await reading;
  assert.equal(service.guard(true).workspaceId, lease.workspaceId);
});

test('a save does not lock reads while it uploads', async () => {
  const { service, releasePage } = setup('synced');
  service.queue('title', '55555555-5555-5555-5555-555555555555', {
    title: 'New',
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(service.status.state, 'synced');
  assert.equal(service.guard(true).workspaceId, lease.workspaceId);
  let done = false;
  await service.prepareRead().then(() => (done = true));
  assert.equal(done, true);
  releasePage();
  await service.pending;
});
