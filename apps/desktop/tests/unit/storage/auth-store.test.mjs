import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AuthStore } from '../../../src/main/platform/auth-store.ts';

const key = randomBytes(32);
export const encryption = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, nonce);
    const bytes = Buffer.concat([cipher.update(value), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), bytes]);
  },
  decryptString(bytes) {
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      cipher.update(bytes.subarray(28)),
      cipher.final(),
    ]).toString();
  },
};
const session = {
  accessToken: 'access-secret',
  refreshToken: 'refresh-secret',
  subject: 'user_a',
  sessionId: 'session_a',
  expiresAt: Date.now() + 60_000,
};
test('auth store protects credentials and serializes save followed by clear', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'supahelp-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'auth.enc'),
    store = new AuthStore(file, encryption);
  assert.equal(await store.load(), undefined);
  await store.save(session);
  assert.doesNotMatch(
    (await readFile(file)).toString(),
    /access-secret|refresh-secret/,
  );
  assert.deepEqual(await new AuthStore(file, encryption).load(), session);
  await Promise.all([store.save(session), store.clear()]);
  assert.equal(await store.load(), undefined);
  await writeFile(file, 'corrupt');
  await assert.rejects(store.load());
});
test('auth store refuses unavailable encryption rather than saving plaintext', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'supahelp-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new AuthStore(join(dir, 'auth.enc'), {
    ...encryption,
    isEncryptionAvailable: () => false,
  });
  await assert.rejects(store.save(session), /Secure/);
});
