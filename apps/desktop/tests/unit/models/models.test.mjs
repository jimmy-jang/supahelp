import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ChatModels } from '../../../src/main/features/chat/models.ts';
import {
  isModelSelection,
  isProvider,
} from '../../../src/main/platform/model-settings.ts';
import { ChatService } from '../../../src/main/features/chat/service.ts';

test('validates provider and model selections at the IPC boundary', () => {
  for (const input of [
    null,
    'claude',
    {},
    { provider: 'other', model: 'default' },
    { provider: 'claude', model: '../unknown' },
    { provider: 'chatgpt', model: 'a\nb' },
    { provider: 'chatgpt', model: 'x'.repeat(121) },
  ])
    assert.equal(isModelSelection(input), false);
  assert.equal(isProvider('__proto__'), false);
  assert.equal(
    isModelSelection({ provider: 'chatgpt', model: 'gpt-test' }),
    true,
  );
});

test('persists the default and pins provider and model per chat', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'supahelp-models-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const opened = [];
  const session = (provider, model) => ({
    provider,
    async *reply() {
      yield { type: 'model', model };
      yield { type: 'text', text: 'hello' };
    },
    close() {},
  });
  const claude = {
    async status() {
      return { state: 'ready', message: 'Connected', model: 'haiku' };
    },
    open(model) {
      opened.push(['claude', model]);
      return session('claude', model);
    },
    async models() {
      return ['sonnet', 'opus', 'haiku'].map((value) => ({
        value,
        displayName: value,
        supportedEffortLevels: ['low', 'medium', 'high'],
      }));
    },
    async configure() {},
  };
  const codex = {
    async status() {
      return { id: 'chatgpt', state: 'ready', message: 'Connected' };
    },
    async models() {
      return [{ model: 'gpt-test', displayName: 'GPT Test' }];
    },
    open(model) {
      opened.push(['chatgpt', model]);
      return session('chatgpt', model);
    },
    close() {},
    useExecutable() {},
  };
  const file = join(home, 'models.json');
  const models = new ChatModels(file, claude, codex);
  assert.deepEqual((await models.settings()).selected, {
    provider: 'claude',
    model: 'haiku',
  });
  await models.select({ provider: 'claude', model: 'opus' });
  const chat = models.open();
  for await (const _ of chat.reply('hello', new AbortController().signal)) {
  }
  await models.select({ provider: 'chatgpt', model: 'gpt-test' });
  for await (const _ of chat.reply('follow up', new AbortController().signal)) {
  }
  const next = models.open();
  for await (const _ of next.reply('new', new AbortController().signal)) {
  }
  assert.deepEqual(opened, [
    ['claude', 'opus'],
    ['chatgpt', 'gpt-test'],
  ]);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).selected, {
    provider: 'chatgpt',
    model: 'gpt-test',
  });
  assert.deepEqual(
    (await new ChatModels(file, claude, codex).settings()).selected,
    { provider: 'chatgpt', model: 'gpt-test' },
  );
  await assert.rejects(
    () => models.select({ provider: 'chatgpt', model: 'not-in-catalog' }),
    /invalid-model/,
  );
  chat.close();
  await assert.rejects(async () => {
    for await (const _ of chat.reply('closed', new AbortController().signal)) {
    }
  }, /chat-closed/);
});

test('disconnecting stops only the chosen provider and preserves every transcript', async () => {
  const closed = [];
  let current = 'claude';
  const chats = new ChatService(
    {
      open() {
        const provider = current;
        return {
          provider,
          async *reply() {
            yield { type: 'text', text: 'kept' };
          },
          close() {
            closed.push(provider);
          },
        };
      },
    },
    () => {},
  );
  const first = chats.send({ text: 'Claude history' });
  current = 'chatgpt';
  chats.send({ text: 'ChatGPT history' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  chats.disconnect('claude');
  assert.deepEqual(closed, ['claude']);
  assert.equal(chats.snapshot().chats.length, 2);
  assert.equal(
    chats.snapshot().chats.find((chat) => chat.id === first).messages[1].text,
    'kept',
  );
  await chats.close();
});

test('a per-chat GPT selection overrides the saved Claude default', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'supahelp-selection-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const opened = [];
  const models = new ChatModels(
    join(home, 'models.json'),
    {
      async status() {
        return { state: 'ready', model: 'sonnet' };
      },
      async models() {
        return [{ value: 'sonnet', displayName: 'Sonnet' }];
      },
      open() {
        throw Error('Claude must not be opened for a GPT selection');
      },
    },
    {
      async status() {
        return { id: 'chatgpt', state: 'ready' };
      },
      async models() {
        return [
          {
            model: 'gpt-6.1-terra',
            displayName: 'GPT-6.1 Terra',
            supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
          },
        ];
      },
      open(model, options) {
        opened.push({ model, options });
        return {
          provider: 'chatgpt',
          async *reply() {
            yield { type: 'text', text: 'GPT response' };
          },
          close() {},
        };
      },
    },
  );
  await models.select({ provider: 'claude', model: 'sonnet' });
  const options = {
    selection: { provider: 'chatgpt', model: 'gpt-6.1-terra' },
    effort: 'high',
  };
  const session = models.open(options);
  for await (const _ of session.reply('hello', new AbortController().signal)) {
  }
  assert.equal(session.provider, 'chatgpt');
  assert.deepEqual(opened, [{ model: 'gpt-6.1-terra', options }]);
  session.close();
});

test('account generation invalidates an established model session before its next reply', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'model-account-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  let generation = 1,
    replies = 0,
    allowed = true;
  const provider = {
    status: async () => ({
      state: 'ready',
      model: 'sonnet',
      message: 'Controlled',
    }),
    models: async () => [],
    open: () => ({
      async *reply() {
        replies++;
        yield { type: 'text', text: 'ok' };
      },
      close() {},
    }),
  };
  const models = new ChatModels(
    join(home, 'models.json'),
    provider,
    { status: async () => ({ state: 'missing', id: 'chatgpt' }) },
    undefined,
    undefined,
    undefined,
    { generation: () => generation, canUse: async () => allowed },
  );
  const session = models.open();
  for await (const _ of session.reply('one', new AbortController().signal)) {
  }
  generation++;
  await assert.rejects(async () => {
    for await (const _ of session.reply('two', new AbortController().signal)) {
    }
  }, /chat-closed/);
  allowed = false;
  await assert.rejects(async () => {
    for await (const _ of models
      .open()
      .reply('three', new AbortController().signal)) {
    }
  }, /account-access/);
  assert.equal(replies, 1);
  session.close();
});

test('falls back to a model the current account may use', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'supahelp-models-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = join(home, 'models.json');
  const claude = {
    status: async () => ({ state: 'ready', message: 'Connected', model: 'x' }),
    models: async () => [{ value: 'sonnet', displayName: 'Sonnet' }],
    configure: async () => {},
  };
  const codex = {
    status: async () => ({ id: 'chatgpt', state: 'ready' }),
    models: async () => [{ model: 'gpt-test', displayName: 'GPT Test' }],
    useExecutable() {},
  };
  await new ChatModels(file, claude, codex).select({
    provider: 'claude',
    model: 'sonnet',
  });
  const scoped = (allowed) =>
    new ChatModels(file, claude, codex, undefined, undefined, undefined, {
      generation: () => 1,
      canUse: async (capability) => allowed.includes(capability),
    }).settings();
  // The saved Claude choice belongs to another account: masking must not use it.
  assert.deepEqual((await scoped(['model:chatgpt'])).selected, {
    provider: 'chatgpt',
    model: 'gpt-test',
  });
  assert.deepEqual((await scoped(['model:claude', 'model:chatgpt'])).selected, {
    provider: 'claude',
    model: 'sonnet',
  });
});
