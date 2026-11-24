import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatService } from '../src/main/features/chat/service.ts';
import { ChatStore } from '../src/main/platform/chat-store.ts';

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (bytes) => bytes.toString(),
};
async function settled(service, id) {
  for (let i = 0; i < 100; i++) {
    if (service.snapshot().chats.find((c) => c.id === id)?.status === 'idle')
      return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('Reply did not settle');
}

test('chat history, titles and deletions survive window close and storage reopen', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const prompts = [];
  const provider = {
    open: () => ({
      async *reply(text) {
        prompts.push(text);
        yield { type: 'text', text: 'Saved reply' };
      },
      close() {},
    }),
  };
  let store = await ChatStore.open(directory, 'local-chats', encryption);
  let chats = new ChatService(provider, () => {}, store);
  const id = chats.send({ text: 'Keep my conversation' });
  await settled(chats, id);
  chats.rename(id, 'Saved title', 'Keep my conversation');
  chats.setPlaybooks(id, ['published-playbook']);
  const removed = chats.createLocalChat('Remove me');
  chats.remove(removed);
  const before = chats.snapshot().chats;
  await chats.close();
  assert.deepEqual(
    chats.snapshot().chats,
    before,
    'closing the window must keep history',
  );
  store.close();
  store = await ChatStore.open(directory, 'local-chats', encryption);
  t.after(() => store.close());
  chats = new ChatService(provider, () => {}, store);
  assert.deepEqual(chats.snapshot().chats, before);
  chats.send({ chatId: id, text: 'Continue after restart' });
  await settled(chats, id);
  assert.match(prompts.at(-1), /Keep my conversation/);
  assert.match(prompts.at(-1), /Saved reply/);
  assert.equal(chats.snapshot().chats[0].messages.length, 4);
  await chats.close();
});

for (const [storeName, moduleName] of [
  ['ChatStore', 'chat-store'],
  ['TeamStore', 'team-store'],
])
  test(`an abruptly terminated ${storeName} process retains partial chat text and restarts idle`, async (t) => {
    const { spawn } = await import('node:child_process');
    const directory = await mkdtemp(join(tmpdir(), 'chat-crash-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const program = `
    import {ChatService} from ${JSON.stringify(new URL('../src/main/features/chat/service.ts', import.meta.url).href)};
    import {${storeName}} from ${JSON.stringify(new URL(`../src/main/platform/${moduleName}.ts`, import.meta.url).href)};
    const store = await ${storeName}.open(process.argv[1], 'local-chats', {
      isEncryptionAvailable:()=>true, encryptString:v=>Buffer.from(v), decryptString:b=>b.toString()
    });
    const service = new ChatService({open:()=>({
      async *reply() { yield {type:'text',text:'Partial reply'}; await new Promise(()=>{}); }, close(){}
    })}, snapshot=>{
      if(snapshot.chats[0]?.messages[1]?.text === 'Partial reply') console.log('saved');
    }, store);
    service.send({text:'Survive a crash'});
    setInterval(()=>{},1000);
  `;
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', program, directory],
      {
        env: { ...process.env, SUPAHELP_DISABLE_SUBSCRIPTIONS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    t.after(() => child.kill('SIGKILL'));
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('error', reject);
      child.once('exit', () => reject(Error('Process exited before saving')));
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;
    const store = await ChatStore.open(directory, 'local-chats', encryption);
    t.after(() => store.close());
    const chats = new ChatService(
      { open: () => assert.fail('must not resume a provider on startup') },
      () => {},
      store,
    );
    const chat = chats.snapshot().chats[0];
    assert.equal(chat.messages[0].text, 'Survive a crash');
    assert.equal(chat.messages[1].text, 'Partial reply');
    assert.equal(chat.status, 'idle');
    assert.equal(chat.step, undefined);
    assert.match(chat.notice, /interrupted/);
    await chats.close();
  });

test('storage errors keep visible history and report failure instead of crashing a reply', async () => {
  const store = {
    list: () => [],
    put: () => {
      throw Error('disk full');
    },
    remove: () => {
      throw Error('disk full');
    },
  };
  const chats = new ChatService(
    {
      open: () => ({
        async *reply() {
          yield { type: 'text', text: 'Still visible' };
        },
        close() {},
      }),
    },
    () => {},
    store,
  );
  const id = chats.send({ text: 'Keep this' });
  await settled(chats, id);
  assert.match(chats.snapshot().chats[0].error, /history could not be saved/);
  assert.throws(() => chats.remove(id), /chat-storage/);
  assert.equal(chats.snapshot().chats[0].messages[1].text, 'Still visible');
  await chats.close();
});
