import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatStore } from '../../../src/main/platform/chat-store.ts';
import { TeamStore } from '../../../src/main/platform/team-store.ts';

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (bytes) => bytes.toString(),
};
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'chat-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('personal chats use chats.db and never write transcript plaintext', async (t) => {
  const root = await directory(t);
  let store = await ChatStore.open(root, 'local-chats', encryption);
  store.put('chat/one', { text: 'PRIVATE_CHAT_MARKER' });
  store.close();
  const files = await readdir(root);
  assert.ok(files.includes('chats.db'));
  assert.ok(!files.some((name) => name.startsWith('team.db')));
  for (const file of files)
    assert.ok(
      !(await readFile(join(root, file))).includes(
        Buffer.from('PRIVATE_CHAT_MARKER'),
      ),
    );
  store = await ChatStore.open(root, 'local-chats', encryption);
  assert.equal(store.get('chat/one').text, 'PRIVATE_CHAT_MARKER');
  store.close();
});

test('legacy personal chats migrate with the original encryption key and survive another reopen', async (t) => {
  const root = await directory(t);
  const legacy = await TeamStore.open(root, 'local-chats', encryption);
  legacy.put('chat/one', {
    version: 1,
    chat: {
      id: 'one',
      title: 'Saved title',
      messages: [{ role: 'user', text: 'Kept history' }],
    },
  });
  const before = legacy.list('chat/');
  legacy.close();
  const key = await readFile(join(root, 'key.enc'));
  for (let i = 0; i < 2; i++) {
    const store = await ChatStore.open(root, 'local-chats', encryption);
    assert.deepEqual(store.list('chat/'), before);
    store.close();
  }
  assert.deepEqual(await readFile(join(root, 'key.enc')), key);
  assert.ok(!(await readdir(root)).some((name) => name.startsWith('team.db')));
});

test('missing legacy keys block migration without replacing or removing the database', async (t) => {
  const root = await directory(t);
  const legacy = await TeamStore.open(root, 'local-chats', encryption);
  legacy.put('chat/one', { text: 'Keep' });
  legacy.close();
  await rm(join(root, 'key.enc'));
  const before = await readFile(join(root, 'team.db'));
  await assert.rejects(
    ChatStore.open(root, 'local-chats', encryption),
    /chat-storage/,
  );
  assert.deepEqual(await readFile(join(root, 'team.db')), before);
  assert.deepEqual(await readdir(root), ['team.db']);
});

test('conflicting legacy and current chat databases fail without overwriting either', async (t) => {
  const root = await directory(t);
  const legacy = await TeamStore.open(root, 'local-chats', encryption);
  legacy.put('chat/old', { text: 'Legacy history' });
  legacy.close();
  // An interrupted/manual restore can leave both names; never silently pick one.
  const { copyFile } = await import('node:fs/promises');
  await copyFile(join(root, 'team.db'), join(root, 'chats.db'));
  const before = await Promise.all(
    ['team.db', 'chats.db'].map((name) => readFile(join(root, name))),
  );
  await assert.rejects(
    ChatStore.open(root, 'local-chats', encryption),
    /chat-storage/,
  );
  const after = await Promise.all(
    ['team.db', 'chats.db'].map((name) => readFile(join(root, name))),
  );
  assert.deepEqual(after, before);
});
