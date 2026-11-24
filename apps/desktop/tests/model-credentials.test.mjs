import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  ModelCredentials,
  isApiKey,
} from '../src/main/platform/model-credentials.ts';
import { ChatModels } from '../src/main/features/chat/models.ts';

test('encrypted credentials survive restart, isolate people and erase keys on replacement/disconnect', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'model-credentials-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cipherKey = randomBytes(32);
  let available = true,
    owner = 'person-a';
  const encryption = {
    isEncryptionAvailable: () => available,
    encryptString(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', cipherKey, iv);
      const data = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decryptString(bytes) {
      const cipher = createDecipheriv(
        'aes-256-gcm',
        cipherKey,
        bytes.subarray(0, 12),
      );
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString();
    },
  };
  const store = () => new ModelCredentials(home, encryption, () => owner);
  const key = 'synthetic-private-key-for-testing';
  await store().set('claude', 'api-key', key);
  assert.deepEqual(await store().get('claude'), { mode: 'api-key', key });
  const file = join(home, 'claude.enc');
  assert.equal((await readFile(file)).includes(Buffer.from(key)), false);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  owner = 'person-b';
  assert.deepEqual(await store().get('claude'), { mode: 'disconnected' });
  owner = 'person-a';
  available = false;
  await assert.rejects(() => store().get('claude'), /Secure credential/);
  await assert.rejects(
    () => store().set('claude', 'api-key', key),
    /Secure credential/,
  );
  available = true;
  for (const mode of ['subscription', 'disconnected']) {
    await store().set('claude', mode);
    assert.deepEqual(await store().get('claude'), { mode });
    assert.equal(
      encryption.decryptString(await readFile(file)).includes(key),
      false,
    );
  }
  for (const bad of [
    '',
    'short',
    'secret with spaces'.repeat(3),
    'a'.repeat(4097),
    'a'.repeat(30) + '\n',
  ])
    assert.equal(isApiKey(bad), false);
});

test('an account change during a save cannot make the key usable by the next account', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'model-key-race-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  let owner = 'a';
  const credentials = new ModelCredentials(
    home,
    {
      isEncryptionAvailable: () => true,
      encryptString: (text) => {
        owner = 'b';
        return Buffer.from(text);
      },
      decryptString: (bytes) => bytes.toString(),
    },
    () => owner,
  );
  await assert.rejects(
    () =>
      credentials.set('chatgpt', 'api-key', 'synthetic-private-key-for-test'),
    /account-access/,
  );
  assert.deepEqual(await credentials.get('chatgpt'), { mode: 'disconnected' });
});

test('account changes during provider teardown prevent installing a key; concurrent changes are rejected', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'model-key-transition-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  let generation = 1,
    release,
    saved = false;
  const models = new ChatModels(
    join(home, 'models.json'),
    {},
    {
      disconnect: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    undefined,
    undefined,
    undefined,
    { generation: () => generation },
    undefined,
    undefined,
    {
      set: async () => {
        saved = true;
      },
    },
  );
  const pending = models.setApiKey('chatgpt', 'synthetic-private-key-for-test');
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => models.setApiKey('chatgpt', 'another-private-key-for-test'),
    /model-busy/,
  );
  generation++;
  release();
  await assert.rejects(() => pending, /account-access/);
  assert.equal(saved, false);
});
