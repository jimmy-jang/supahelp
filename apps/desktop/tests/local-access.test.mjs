import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalAccess } from '../src/main/platform/local-access.ts';

test('local grants require explicit connection for a signed-in account and reject superseded connection completion', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'supahelp-access-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  };
  const access = new LocalAccess(join(dir, 'access.enc'), encryption);
  assert.equal(await access.allows('linear', null), true);
  assert.equal(await access.allows('linear', 'account-a'), false);
  const first = await access.block('linear');
  assert.equal(await access.allows('linear', null), false);
  const second = await access.block('linear');
  await access.bindAfterConnection('linear', 'account-a', first);
  assert.equal(await access.allows('linear', 'account-a'), false);
  await access.bindAfterConnection('linear', 'account-b', second);
  assert.equal(await access.allows('linear', 'account-b'), true);
  assert.equal(await access.allows('linear', 'account-a'), false);
  assert.equal(await access.allows('linear', null), false);
});
