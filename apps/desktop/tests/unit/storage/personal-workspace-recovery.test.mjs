import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChatStore } from '../../../src/main/platform/chat-store.ts';
import { CaseStore } from '../../../src/main/features/cases/store.ts';
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (v) => Buffer.from(v),
  decryptString: (b) => b.toString(),
};
test('legacy recovery preserves originals and assigns the bundle only to the confirmed account', async (t) => {
  const { PersonalRecovery } =
    await import('../../../src/main/platform/personal-workspace-recovery.ts');
  const root = await mkdtemp(join(tmpdir(), 'personal-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const chats = await ChatStore.open(
    join(root, 'chats'),
    'local-chats',
    encryption,
  );
  chats.put('chat/private', {
    version: 1,
    chat: { id: 'private', messages: [], status: 'idle' },
  });
  chats.close();
  const cases = new CaseStore(join(root, 'cases.db'));
  await cases.recover(encryption, () => {});
  const caseId = randomUUID(),
    bookId = randomUUID();
  cases.insertCase({
    id: caseId,
    workspaceId: 'personal',
    ownerId: 'local',
    chatId: 'private',
    title: 'Saved case',
    ticket: '#123',
    at: new Date().toISOString(),
  });
  cases.books.savePlaybook(
    {
      id: bookId,
      version: 1,
      workspaceId: 'personal',
      ownerId: 'local',
      title: 'Saved book',
    },
    0,
  );
  cases.close();
  const recovery = new PersonalRecovery(root, encryption),
    id = randomUUID();
  assert.equal(await recovery.available(), true);
  await recovery.restore(
    id,
    () => {},
    async () => {},
  );
  const restored = await ChatStore.open(
    join(root, 'personal', 'accounts', id, 'chats'),
    'local-chats',
    encryption,
  );
  assert.equal(restored.list('chat/')[0].chat.id, 'private');
  restored.close();
  const documents = new CaseStore(
    join(root, 'personal', 'accounts', id, 'cases.db'),
  );
  await documents.recover(encryption, () => {});
  assert.equal(documents.cases()[0].id, caseId);
  assert.equal(documents.cases()[0].chatIds[0], 'private');
  assert.equal(documents.books.playbooks()[0].id, bookId);
  documents.close();
  await access(join(root, 'chats', 'chats.db'));
  assert.equal(await recovery.available(), false);
  await assert.rejects(
    recovery.restore(
      randomUUID(),
      () => {},
      async () => {},
    ),
  );
});
test('legacy recovery refuses a populated destination and preserves missing-key ciphertext', async (t) => {
  const { PersonalRecovery } =
    await import('../../../src/main/platform/personal-workspace-recovery.ts');
  const root = await mkdtemp(join(tmpdir(), 'personal-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = await ChatStore.open(
    join(root, 'chats'),
    'local-chats',
    encryption,
  );
  legacy.put('chat/a', { a: 1 });
  legacy.close();
  await rm(join(root, 'chats', 'key.enc'));
  const recovery = new PersonalRecovery(root, encryption);
  await assert.rejects(
    recovery.restore(
      randomUUID(),
      () => {},
      async () => {},
    ),
  );
  await access(join(root, 'chats', 'chats.db'));
});

test('a crash after publishing recovery resumes the same assignment without exposing it to another account', async (t) => {
  const { PersonalRecovery } =
    await import('../../../src/main/platform/personal-workspace-recovery.ts');
  const root = await mkdtemp(join(tmpdir(), 'personal-recovery-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = new CaseStore(join(root, 'cases.db'));
  cases.close();
  const recovery = new PersonalRecovery(root, encryption),
    id = randomUUID();
  const save = recovery.assignment.save.bind(recovery.assignment);
  t.mock.method(recovery.assignment, 'save', async (value) => {
    if (value.done) throw Error('crash before completion');
    await save(value);
  });
  await assert.rejects(
    recovery.restore(
      id,
      () => {},
      async () => {},
    ),
    /crash/,
  );
  const resumed = new PersonalRecovery(root, encryption);
  await assert.rejects(
    resumed.restore(
      randomUUID(),
      () => {},
      async () => {},
    ),
  );
  await resumed.resume(id);
  assert.equal((await resumed.assignment.load()).done, true);
  await access(join(root, 'cases.db'));
});
test('recovery cannot replace a destination that already has personal chats', async (t) => {
  const { PersonalRecovery } =
    await import('../../../src/main/platform/personal-workspace-recovery.ts');
  const root = await mkdtemp(join(tmpdir(), 'personal-recovery-conflict-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = new CaseStore(join(root, 'cases.db'));
  cases.close();
  const id = randomUUID();
  const chats = await ChatStore.open(
    join(root, 'personal', 'accounts', id, 'chats'),
    'local-chats',
    encryption,
  );
  chats.put('chat/b', { id: 'keep-me' });
  chats.close();
  await assert.rejects(
    new PersonalRecovery(root, encryption).restore(
      id,
      () => {},
      async () => {},
    ),
    /empty/,
  );
  const retained = await ChatStore.open(
    join(root, 'personal', 'accounts', id, 'chats'),
    'local-chats',
    encryption,
  );
  assert.equal(retained.list('chat/')[0].id, 'keep-me');
  retained.close();
});
