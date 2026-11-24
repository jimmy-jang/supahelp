import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AccountCache } from '../src/main/platform/account-cache.ts';
import { AccountService } from '../src/main/features/accounts/service.ts';
import { AccountApiError } from '../src/main/integrations/account-api.ts';
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (v) => Buffer.from(v),
  decryptString: (b) => b.toString(),
};
test('offline restart restores only the OS-protected account projection matching the retained auth subject', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'account-offline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = new AccountCache(join(root, 'view.enc'), encryption),
    view = {
      account: { id: randomUUID(), email: 'owner@example.test', name: 'Owner' },
      organizations: [],
      workspaces: [],
    };
  const auth = {
    cachedSubject: async () => 'user_retained',
    close: async () => {},
    signOut: async () => {},
  };
  const opts = {
    auth,
    cache,
    access: { allows: async () => false },
    changed: () => {},
    invalidate: async () => {},
    api: { view: async () => view },
  };
  let accounts = new AccountService(opts);
  await accounts.refresh();
  assert.equal(accounts.principal(), view.account.id);
  await accounts.close();
  accounts = new AccountService({
    ...opts,
    api: {
      view: async () => {
        throw new AccountApiError(503);
      },
    },
  });
  await accounts.refresh();
  assert.equal(accounts.principal(), view.account.id);
  assert.equal(accounts.snapshot().status, 'unavailable');
  await accounts.close();
  accounts = new AccountService({
    ...opts,
    auth: { ...auth, cachedSubject: async () => 'user_other' },
    api: {
      view: async () => {
        throw new AccountApiError(503);
      },
    },
  });
  await accounts.refresh();
  assert.equal(accounts.principal(), null);
  await accounts.close();
  accounts = new AccountService({
    ...opts,
    api: {
      view: async () => {
        throw new AccountApiError(401, 'unauthenticated');
      },
    },
  });
  await accounts.refresh();
  assert.equal(accounts.principal(), null);
  assert.equal(await cache.load(), undefined);
  await accounts.close();
});

test('clearing while a projection is encrypting cannot resurrect the old account cache', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'account-cache-order-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const gate = Promise.withResolvers(),
    entered = Promise.withResolvers();
  const cache = new AccountCache(join(root, 'view.enc'), {
    ...encryption,
    encryptString: async (v) => {
      entered.resolve();
      await gate.promise;
      return Buffer.from(v);
    },
  });
  const saving = cache.save({
    subject: 'user_a',
    at: Date.now(),
    view: { account: { id: randomUUID() }, organizations: [], workspaces: [] },
  });
  await entered.promise;
  const clearing = cache.clear();
  gate.resolve();
  await Promise.all([saving, clearing]);
  assert.equal(await cache.load(), undefined);
});
