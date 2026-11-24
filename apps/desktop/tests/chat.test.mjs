import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ChatService,
  publicChatError,
} from '../src/main/features/chat/service.ts';

function setup(reply) {
  const events = [];
  const provider = { open: () => ({ reply, close() {} }) };
  const service = new ChatService(provider, (state) => events.push(state));
  return { service, events };
}

test('renames the chat without changing its messages or opening another session', async () => {
  const { service, events } = setup(async function* () {
    yield { type: 'text', text: 'Hello' };
  });
  const id = service.send({ text: 'Original title' });
  await settled(service, id);
  const before = service.snapshot().chats[0];
  assert.equal(
    service.rename(id, '  Better title  ', before.title),
    'Better title',
  );
  assert.equal(events.at(-1).chats[0].title, 'Better title');
  assert.deepEqual(service.snapshot().chats[0].messages, before.messages);
  assert.throws(
    () => service.rename(id, 'Stale edit', before.title),
    /title-changed/,
  );
  for (const title of [
    '',
    '  ',
    'x'.repeat(121),
    'Two\nlines',
    'Null\0byte',
    42,
  ])
    assert.throws(
      () => service.rename(id, title, 'Better title'),
      /invalid-title/,
    );
  assert.throws(
    () => service.rename('missing', 'Title', 'Original'),
    /unknown-chat/,
  );
  await service.close();
});

test('removing an idle chat closes its session and leaves other chats available', async () => {
  let closed = 0;
  const service = new ChatService(
    {
      open: () => ({
        async *reply() {
          yield { type: 'text', text: 'Reply' };
        },
        close() {
          closed++;
        },
      }),
    },
    () => {},
  );
  const id = service.send({ text: 'Remove this chat' });
  const other = service.createLocalChat();
  assert.throws(() => service.remove(id), /remove-running/);
  await settled(service, id);
  service.remove(id);
  assert.equal(closed, 1);
  assert.deepEqual(
    service.snapshot().chats.map((c) => c.id),
    [other],
  );
  await service.close();
});

async function settled(service, id) {
  for (let i = 0; i < 100; i++) {
    if (
      service.snapshot().chats.find((chat) => chat.id === id)?.status === 'idle'
    )
      return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw Error('Reply did not settle');
}

test('unknown provider error names always produce a plain public error string', () => {
  for (const message of ['toString', 'constructor', '__proto__']) {
    assert.equal(typeof publicChatError(Error(message)), 'string');
  }
});

test('rejects empty, oversized, command and fixture submissions before opening Claude', () => {
  let opened = 0;
  const service = new ChatService(
    {
      open() {
        opened++;
        throw Error('unexpected');
      },
    },
    () => {},
  );
  for (const text of ['', '   ', 'x'.repeat(12001), '/logout']) {
    assert.throws(
      () => service.send({ text }),
      (error) => /message|commands/i.test(publicChatError(error)),
    );
  }
  assert.throws(
    () => service.send({ chatId: 'fixture-chat', text: 'hello' }),
    /chat/i,
  );
  assert.equal(opened, 0);
  assert.equal(service.snapshot().chats.length, 0);
});

test('streams real text into one assistant message and retains context through the same session', async () => {
  let calls = 0;
  const { service } = setup(async function* () {
    calls++;
    yield { type: 'model', model: 'test-model' };
    yield { type: 'text', text: 'Hello ' };
    yield { type: 'text', text: 'there' };
  });
  const id = service.send({ text: 'hello' });
  await settled(service, id);
  let chat = service.snapshot().chats[0];
  assert.equal(chat.status, 'idle');
  assert.equal(chat.model, 'test-model');
  assert.deepEqual(chat.messages, [
    { role: 'user', text: 'hello' },
    { role: 'assistant', text: 'Hello there' },
  ]);
  service.send({ chatId: id, text: 'again' });
  await settled(service, id);
  chat = service.snapshot().chats[0];
  assert.equal(calls, 2);
  assert.equal(chat.messages.length, 4);
  await service.close();
});

test('blocks a duplicate send while the first turn is running', async () => {
  const gate = Promise.withResolvers();
  const { service } = setup(async function* () {
    await gate.promise;
    yield { type: 'text', text: 'ok' };
  });
  const id = service.send({ text: 'hello' });
  assert.throws(
    () => service.send({ chatId: id, text: 'duplicate' }),
    /reply/i,
  );
  assert.equal(service.snapshot().chats[0].messages.length, 2);
  gate.resolve();
  await settled(service, id);
  await service.close();
});

test('Stop preserves partial text and ignores late output from the cancelled turn', async () => {
  const partial = Promise.withResolvers();
  const gate = Promise.withResolvers();
  const { service } = setup(async function* () {
    yield { type: 'text', text: 'partial' };
    partial.resolve();
    await gate.promise;
    yield { type: 'text', text: ' late' };
  });
  const id = service.send({ text: 'hello' });
  await partial.promise;
  service.stop(id);
  gate.resolve();
  await settled(service, id);
  const chat = service.snapshot().chats[0];
  assert.equal(chat.status, 'idle');
  assert.equal(chat.messages[1].text, 'partial');
  assert.equal(chat.notice, 'Reply stopped.');
  await service.close();
});

test('provider errors preserve input and partial text without exposing raw diagnostics', async () => {
  const { service } = setup(async function* () {
    yield { type: 'text', text: 'partial' };
    throw Error('Authorization: Bearer fake-secret');
  });
  const id = service.send({ text: 'keep my input' });
  await settled(service, id);
  const chat = service.snapshot().chats[0];
  assert.equal(chat.messages[0].text, 'keep my input');
  assert.equal(chat.messages[1].text, 'partial');
  assert.match(chat.error, /Claude|reply/i);
  assert.doesNotMatch(JSON.stringify(service.snapshot()), /fake-secret/);
  await service.close();
});

test('a closing window cannot erase a new window’s chat while the old turn settles', async () => {
  const gate = Promise.withResolvers();
  let turn = 0;
  const { service } = setup(async function* () {
    if (turn++ === 0) await gate.promise;
    yield { type: 'text', text: 'new reply' };
  });
  const oldId = service.send({ text: 'old window' });
  const closing = service.close();
  const id = service.send({ text: 'new window' });
  gate.resolve();
  await closing;
  await settled(service, id);
  assert.equal(service.snapshot().chats.length, 2);
  assert.equal(service.snapshot().chats[1].id, oldId);
  assert.equal(service.snapshot().chats[1].status, 'idle');
  assert.equal(service.snapshot().chats[0].id, id);
  assert.equal(service.snapshot().chats[0].messages[1].text, 'new reply');
  await service.close();
});

test('an oversized reply closes its provider session instead of leaving generation running', async () => {
  let closed = false;
  const service = new ChatService(
    {
      open: () => ({
        async *reply() {
          yield { type: 'text', text: 'x'.repeat(128001) };
        },
        close() {
          closed = true;
        },
      }),
    },
    () => {},
  );
  const id = service.send({ text: 'hello' });
  await settled(service, id);
  assert.equal(closed, true);
  assert.ok(service.snapshot().chats[0].error);
  assert.equal(service.snapshot().chats[0].messages[1].text, '');
  await service.close();
});

test('changing per-chat options reopens the provider with transcript context', async () => {
  const opened = [];
  const inputs = [];
  const service = new ChatService(
    {
      open(options) {
        opened.push(options);
        return {
          async *reply(text, _signal, files) {
            inputs.push({ text, files });
            yield { type: 'text', text: 'Kept reply' };
          },
          close() {},
        };
      },
    },
    () => {},
  );
  const first = {
    selection: { provider: 'claude', model: 'sonnet' },
    confirmation: 'ask',
  };
  const id = service.send({ text: 'Original context', options: first });
  await settled(service, id);
  const next = {
    selection: { provider: 'chatgpt', model: 'gpt-test' },
    effort: 'high',
    confirmation: 'skip',
  };
  const files = [
    {
      id: 'picked',
      name: 'context.txt',
      mime: 'text/plain',
      size: 4,
      data: 'dGVzdA==',
    },
  ];
  service.send({ chatId: id, text: 'Continue', options: next }, files);
  await settled(service, id);
  assert.deepEqual(opened, [first, next]);
  assert.match(inputs[1].text, /Original context/);
  assert.match(inputs[1].text, /Kept reply/);
  assert.deepEqual(inputs[1].files, files);
  assert.deepEqual(service.snapshot().chats[0].options, next);
  assert.equal(service.snapshot().chats[0].messages.length, 4);
  await service.close();
});

test('rejects malformed permissions and model options before opening a provider', () => {
  const { service } = setup(async function* () {});
  for (const options of [
    null,
    { confirmation: 'bypass' },
    { effort: 'infinite' },
    { selection: { provider: 'other', model: 'test' } },
  ]) {
    assert.throws(
      () => service.send({ text: 'hello', options }),
      /invalid-options/,
    );
  }
  assert.equal(service.snapshot().chats.length, 0);
});

test('preserves prompt formatting in the chat and provider request', async () => {
  let prompt;
  const { service } = setup(async function* (text) {
    prompt = text;
    yield { type: 'text', text: 'Reviewed' };
  });
  const text =
    '  Reproduce the export\n\n1. Open the saved view\n   - Check Date\n';
  const id = service.send({ text });
  await settled(service, id);
  assert.equal(prompt, text);
  assert.equal(service.snapshot().chats[0].messages[0].text, text);
  await service.close();
});

test('a picked file can be sent without a text caption', async () => {
  let prompt;
  const { service } = setup(async function* (text) {
    prompt = text;
    yield { type: 'text', text: 'Reviewed' };
  });
  const id = service.send({ text: '' }, [
    {
      id: 'picked',
      name: 'notes.txt',
      size: 4,
      mime: 'text/plain',
      data: 'dGVzdA==',
    },
  ]);
  await settled(service, id);
  assert.match(prompt, /attached files/);
  assert.equal(service.snapshot().chats[0].title, 'notes.txt');
  await service.close();
});

test('shows the tool a reply is calling until text arrives, then clears it', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { service, events } = setup(async function* () {
    yield { type: 'step', server: 'zendesk', tool: 'get_ticket' };
    await gate;
    yield { type: 'text', text: 'Found it.' };
  });
  const id = service.send({ text: 'Check ticket 42' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(service.snapshot().chats[0].step, {
    server: 'zendesk',
    tool: 'get_ticket',
  });
  release();
  await settled(service, id);
  assert.equal(service.snapshot().chats[0].step, undefined);
  assert.ok(
    events.every(
      (state) => state.chats[0].status !== 'idle' || !state.chats[0].step,
    ),
  );
  await service.close();
});
