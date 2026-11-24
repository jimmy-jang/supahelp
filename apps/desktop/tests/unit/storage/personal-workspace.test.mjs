import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../../../src/main/features/cases/store.ts';
import { ChatStore } from '../../../src/main/platform/chat-store.ts';
import { ChatService } from '../../../src/main/features/chat/service.ts';
import { ChatResources } from '../../../src/main/platform/chat-resources.ts';
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (v) => Buffer.from(v),
  decryptString: (b) => b.toString(),
};
test('stable case and chat services switch storage and restore only the selected workspace', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'personal-isolation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = new CaseStore(join(root, 'a.db'));
  t.after(() => cases.close());
  const a = await ChatStore.open(
    join(root, 'a-chats'),
    'local-chats',
    encryption,
  );
  const b = await ChatStore.open(
    join(root, 'b-chats'),
    'local-chats',
    encryption,
  );
  t.after(() => {
    a.close();
    b.close();
  });
  const chats = new ChatService(
    {
      open() {
        assert.fail('no provider needed');
      },
    },
    () => {},
    a,
  );
  const id = chats.createLocalChat('A private chat');
  await cases.recover(encryption, () => {});
  const book = {
    id: randomUUID(),
    version: 1,
    workspaceId: 'personal',
    ownerId: 'local',
    title: 'A book',
  };
  cases.books.savePlaybook(book, 0);
  await cases.activate(join(root, 'b.db'));
  await cases.recover(encryption, () => {});
  await chats.activate(b);
  assert.deepEqual(chats.snapshot().chats, []);
  assert.deepEqual(cases.books.playbooks(), []);
  chats.createLocalChat('B private chat');
  await cases.activate(join(root, 'a.db'));
  await cases.recover(encryption, () => {});
  await chats.activate(a);
  assert.equal(chats.snapshot().chats[0].id, id);
  assert.equal(chats.snapshot().chats.length, 1);
  assert.equal(cases.books.playbooks()[0].id, book.id);
  await chats.close();
});
test('project selections do not cross workspace activation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'personal-projects-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, 'project');
  await mkdir(folder);
  const resources = new ChatResources(join(root, 'a.json'));
  await resources.connect(folder);
  resources.activate(join(root, 'b.json'));
  assert.deepEqual(await resources.list(), []);
  resources.activate(join(root, 'a.json'));
  assert.equal((await resources.list())[0].path, await realpath(folder));
});
test('personal directories reject untrusted account paths', async () => {
  const { personalDirectory } =
    await import('../../../src/main/platform/personal-workspace.ts');
  assert.equal(personalDirectory('/profile', null), '/profile/personal/guest');
  const id = randomUUID();
  assert.equal(
    personalDirectory('/profile', id),
    `/profile/personal/accounts/${id}`,
  );
  for (const bad of ['../a', '', 'guest', 'a/b'])
    assert.throws(() => personalDirectory('/profile', bad));
});

test('switching during a reply saves partial text only to the old chat store', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'personal-stream-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = await ChatStore.open(join(root, 'a'), 'local-chats', encryption),
    b = await ChatStore.open(join(root, 'b'), 'local-chats', encryption);
  t.after(() => {
    a.close();
    b.close();
  });
  const entered = Promise.withResolvers();
  const chats = new ChatService(
    {
      open: () => ({
        async *reply(_text, signal) {
          yield { type: 'text', text: 'A partial reply' };
          entered.resolve();
          await new Promise((r) =>
            signal.addEventListener('abort', r, { once: true }),
          );
        },
        close() {},
      }),
    },
    () => {},
    a,
  );
  chats.send({ text: 'A only' });
  await entered.promise;
  await chats.activate(b);
  assert.deepEqual(chats.snapshot().chats, []);
  assert.deepEqual(b.list('chat/'), []);
  const saved = a.list('chat/')[0].chat;
  assert.equal(saved.messages[1].text, 'A partial reply');
  await chats.close();
});

test('returning to A after a partially failed B activation reloads A rather than retaining B data', async (t) => {
  const { PersonalWorkspace, personalDirectory } =
    await import('../../../src/main/platform/personal-workspace.ts');
  const root = await mkdtemp(join(tmpdir(), 'personal-failed-switch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = randomUUID(),
    b = randomUUID(),
    directory = personalDirectory(root, a);
  await mkdir(directory, { recursive: true });
  const store = await ChatStore.open(
    join(directory, 'chats'),
    'local-chats',
    encryption,
  );
  const chats = new ChatService(
      {
        open() {
          assert.fail();
        },
      },
      () => {},
      store,
    ),
    cases = new CaseStore(join(directory, 'cases.db'));
  const activate = cases.activate.bind(cases);
  let fail = false;
  const workspace = new PersonalWorkspace({
    root,
    encryption,
    chats,
    chatStore: store,
    cases: {
      cancelPending() {},
      async activate(file) {
        if (fail) throw Error('disk failure');
        await activate(file);
      },
    },
    models: { resetWorkspace() {}, attachPlaybooks() {} },
    resources: new ChatResources(join(directory, 'projects.json')),
    screenshots: { async activate() {} },
  });
  t.after(() => {
    cases.close();
    workspace.close();
  });
  await workspace.activate(a);
  chats.createLocalChat('Only A');
  fail = true;
  await assert.rejects(workspace.activate(b), /disk/);
  fail = false;
  await workspace.activate(a);
  assert.equal(chats.snapshot().chats.length, 1);
  assert.equal(chats.snapshot().chats[0].title, 'Only A');
  await chats.close();
});

test('confirmed screenshots and collection stay inside the active personal directory', async (t) => {
  const { PlaybookScreenshots } =
    await import('../../../src/main/platform/playbook-screenshots.ts');
  const { writeFile, access } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'personal-images-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const a = join(root, 'a'),
    b = join(root, 'b');
  await mkdir(a);
  await mkdir(b);
  await writeFile(join(a, 'book_image.png'), 'a');
  await writeFile(join(b, 'other_image.png'), 'b');
  const images = new PlaybookScreenshots(a, {
    decode() {
      assert.fail();
    },
    encode() {
      assert.fail();
    },
  });
  await images.prepare();
  assert.equal(images.allowed('book', 'image'), true);
  await images.activate(b);
  assert.equal(images.allowed('book', 'image'), false);
  await images.collect(new Set());
  await access(join(a, 'book_image.png'));
  await images.activate(a);
  assert.equal(images.allowed('book', 'image'), true);
});
