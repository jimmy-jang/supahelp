import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  registerAccountsIpc,
  scopedFeatureIpc,
} from '../../../src/main/features/accounts/ipc.ts';
import { registerChatIpc } from '../../../src/main/features/chat/ipc.ts';
import { ChatService } from '../../../src/main/features/chat/service.ts';

test('account IPC rejects an untrusted frame before sign-in or state changes', async () => {
  const handlers = new Map(),
    frame = {},
    webContents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  let calls = 0;
  registerAccountsIpc(
    { handle: (name, run) => handlers.set(name, run) },
    () => ({ webContents }),
    'file:///app/index.html',
    {
      signIn: async () => {
        calls++;
      },
    },
  );
  const result = await handlers.get('accounts:sign-in')(
    { sender: webContents, senderFrame: {} },
    {},
  );
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

test('team document IPC reaches the main-owned document authorization handler', async () => {
  const handlers = new Map(),
    frame = {},
    webContents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  const ipc = scopedFeatureIpc(
    { handle: (name, run) => handlers.set(name, run) },
    () => ({ webContents }),
    'file:///app/index.html',
    {
      assertCurrentContext() {},
      generation: () => 1,
      snapshot: () => ({ context: { context: { kind: 'team' } } }),
    },
    async () => 'claude',
    new Set(),
  );
  for (const name of ['cases:edit', 'cases:cancelEdit']) {
    let reached = false;
    ipc.handle(name, () => {
      reached = true;
      return { ok: true, value: undefined };
    });
    assert.equal(
      (
        await handlers.get(name)(
          { sender: webContents, senderFrame: frame },
          {},
        )
      ).ok,
      true,
    );
    assert.equal(reached, true);
  }
});
test('team IPC permits connector settings, chat and approvals on connections the account owns', async () => {
  const handlers = new Map(),
    frame = {},
    webContents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  let connectorCalls = 0;
  const context = { generation: 1, context: { kind: 'team' } };
  const service = {
    generation: () => 1,
    snapshot: () => ({ context }),
    assertCurrentContext(stamp) {
      if (stamp !== context) throw Error('stale');
    },
    canUse: async (cap) => cap === 'model:claude',
    canManageConnection: async (cap) =>
      cap === 'linear' || cap === 'catalog:custom-api-0000abcd',
    authenticationGeneration: () => 1,
  };
  const ipc = scopedFeatureIpc(
    { handle: (name, run) => handlers.set(name, run) },
    () => ({ webContents }),
    'file:///app/index.html',
    service,
    () => Promise.resolve('claude'),
    new Set(),
  );
  let settle;
  const chats = new ChatService(
    {
      open: () => ({
        async *reply() {
          yield { type: 'text', text: 'Fixture response' };
        },
        close() {},
      }),
    },
    ({ chats }) => {
      if (chats[0]?.status === 'idle') settle?.();
    },
  );
  registerChatIpc({
    ipcMain: ipc,
    getWindow: () => ({ webContents }),
    location: 'file:///app/index.html',
    chats,
    resources: { resolve: () => [], consume() {} },
  });
  ipc.handle('linear:disconnect', () => {
    connectorCalls++;
    return { ok: true };
  });
  ipc.handle('connections:decide', () => {
    connectorCalls++;
    return { ok: true };
  });
  ipc.handle('linear:decide', () => {
    connectorCalls++;
    return { ok: true };
  });
  const event = { sender: webContents, senderFrame: frame };
  assert.equal(
    (await handlers.get('linear:disconnect')(event, { context })).ok,
    true,
  );
  assert.equal((await handlers.get('linear:decide')(event, {})).ok, true);
  assert.equal(connectorCalls, 2);
  // Approvals work in Team on connections this account owns; any other stays blocked.
  assert.equal(
    (
      await handlers.get('connections:decide')(event, {
        id: 'custom-api-0000abcd',
      })
    ).ok,
    true,
  );
  assert.equal(
    (await handlers.get('connections:decide')(event, { id: 'github-issues' }))
      .ok,
    false,
  );
  assert.equal(connectorCalls, 3);
  assert.equal(
    (await handlers.get('chat:send')(event, { context: {}, input: {} })).ok,
    false,
  );
  const send = (input) => handlers.get('chat:send')(event, { context, input });
  assert.deepEqual(
    await send({
      text: 'Unavailable model',
      options: { selection: { provider: 'chatgpt', model: 'fixture' } },
    }),
    {
      ok: false,
      error: 'Connect this model provider for the current account.',
    },
  );
  assert.equal(chats.snapshot().chats.length, 0);
  let replyFinished = new Promise((resolve) => (settle = resolve));
  const first = await send({
    text: 'Start a personal chat from the team home',
  });
  assert.equal(first.ok, true, first.error);
  await replyFinished;
  replyFinished = new Promise((resolve) => (settle = resolve));
  const followUp = await send({
    text: 'Continue the chat',
    chatId: first.value,
  });
  assert.deepEqual(followUp, first);
  await replyFinished;
  const [chat] = chats.snapshot().chats;
  assert.deepEqual(
    chat.messages.map(({ text }) => text),
    [
      'Start a personal chat from the team home',
      'Fixture response',
      'Continue the chat',
      'Fixture response',
    ],
  );
  await chats.close();
});

test('invalid connection input cannot revoke a working local ownership grant', async () => {
  const handlers = new Map(),
    frame = {},
    webContents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  let blocked = 0,
    called = 0;
  const ipc = scopedFeatureIpc(
    { handle: (name, run) => handlers.set(name, run) },
    () => ({ webContents }),
    'file:///app/index.html',
    {
      assertCurrentContext() {},
      generation: () => 1,
      snapshot: () => ({ context: { context: { kind: 'personal' } } }),
      beginConnection: async () => {
        blocked++;
        return 'nonce';
      },
      finishConnection() {},
    },
    async () => 'claude',
    new Set(),
  );
  ipc.handle('linear:connect', async () => {
    called++;
    return { ok: false, error: 'Invalid access' };
  });
  assert.equal(
    (
      await handlers.get('linear:connect')(
        { sender: webContents, senderFrame: frame },
        { input: 'invalid' },
      )
    ).ok,
    false,
  );
  assert.equal(blocked, 0);
  assert.equal(called, 0);
  ipc.handle('models:api-key', async () => {
    called++;
    return { ok: true };
  });
  for (const input of [
    null,
    { provider: 'claude', key: 'short' },
    { provider: '__proto__', key: 'synthetic-key-for-testing' },
    { provider: 'claude', key: 'synthetic-key-for-testing', extra: true },
  ]) {
    const result = await handlers.get('models:api-key')(
      { sender: webContents, senderFrame: frame },
      { input },
    );
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.error, /synthetic-key/);
  }
  assert.equal(blocked, 0);
  assert.equal(called, 0);
});

test('team model setup and management work and an open browser attempt survives a workspace switch', async () => {
  const handlers = new Map(),
    frame = {},
    webContents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  const event = { sender: webContents, senderFrame: frame };
  let context = { generation: 1, context: { kind: 'team' } };
  const started = Promise.withResolvers(),
    browser = Promise.withResolvers();
  const finished = [];
  const ipc = scopedFeatureIpc(
    { handle: (name, run) => handlers.set(name, run) },
    () => ({ webContents }),
    'file:///app/index.html',
    {
      assertCurrentContext(stamp) {
        if (stamp !== context) throw Error('case-context');
      },
      generation: () => context.generation,
      snapshot: () => ({ context }),
      beginConnection: async (cap) => {
        assert.equal(cap, 'model:chatgpt');
        return 'nonce';
      },
      finishConnection: (...args) => finished.push(args),
      canManageConnection: async (cap, pending) =>
        cap === 'model:chatgpt' && pending,
    },
    async () => 'chatgpt',
    new Set(),
  );
  registerChatIpc({
    ipcMain: ipc,
    getWindow: () => ({ webContents }),
    location: 'file:///app/index.html',
    chats: { refreshTools() {} },
    models: {
      async connect(provider) {
        assert.equal(provider, 'chatgpt');
        started.resolve();
        await browser.promise;
      },
      disconnect(provider) {
        assert.equal(provider, 'chatgpt');
      },
      select(selection) {
        assert.deepEqual(selection, { provider: 'chatgpt', model: 'fixture' });
      },
    },
  });
  const invoke = (channel, input, stamp = context) =>
    handlers.get(channel)(event, { context: stamp, input });
  assert.equal(
    (await invoke('models:select', { provider: 'chatgpt', model: 'fixture' }))
      .ok,
    true,
  );
  const old = context;
  const signingIn = invoke('models:connect', 'chatgpt');
  await Promise.race([started.promise, signingIn]);
  assert.equal(finished.length, 0);
  context = { generation: 2, context: { kind: 'personal' } };
  browser.resolve();
  assert.equal((await signingIn).ok, false);
  assert.deepEqual(finished, [['model:chatgpt', 'nonce', true]]);
  assert.equal((await invoke('models:disconnect', 'chatgpt', old)).ok, false);
  context = { generation: 3, context: { kind: 'team' } };
  assert.equal((await invoke('models:disconnect', 'chatgpt')).ok, true);
});

test('document reads wait for context cleanup instead of racing the workspace transition', async () => {
  const { AccountService } =
    await import('../../../src/main/features/accounts/service.ts');
  let release;
  const service = new AccountService({
    access: { allows: async () => false },
    changed: () => {},
    invalidate: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const changing = service.select({ kind: 'personal' });
  const handlers = new Map(),
    frame = {},
    webContents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  const ipc = scopedFeatureIpc(
    { handle: (name, run) => handlers.set(name, run) },
    () => ({ webContents }),
    'file:///app/index.html',
    service,
    async () => 'claude',
    new Set(),
  );
  let reached = false;
  ipc.handle('cases:list', () => {
    service.assertCurrentContext(service.snapshot().context);
    reached = true;
    return { ok: true, value: { revision: 1, cases: [] } };
  });
  const read = handlers.get('cases:list')(
    { sender: webContents, senderFrame: frame },
    {},
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reached, false);
  release();
  await changing;
  assert.equal((await read).ok, true);
  assert.equal(reached, true);
});

test('stale chat envelopes and account billing requests never reach feature code', async () => {
  const { AccountService } =
    await import('../../../src/main/features/accounts/service.ts');
  const service = new AccountService({
    access: { allows: async () => false },
    changed() {},
    invalidate: async () => {},
  });
  const old = service.snapshot().context;
  await service.select({ kind: 'personal' });
  const frame = {},
    webContents = { mainFrame: frame, getURL: () => 'file:///app/index.html' },
    handlers = new Map();
  const raw = { handle: (name, run) => handlers.set(name, run) };
  const ipc = scopedFeatureIpc(
    raw,
    () => ({ webContents }),
    'file:///app/index.html',
    service,
    async () => 'claude',
    new Set(),
  );
  let calls = 0;
  ipc.handle('chat:list', () => {
    calls++;
    return { ok: true, value: { revision: 1, chats: [] } };
  });
  registerAccountsIpc(
    raw,
    () => ({ webContents }),
    'file:///app/index.html',
    service,
  );
  const event = { sender: webContents, senderFrame: frame };
  const result = await handlers.get('chat:list')(event, {
    context: old,
    input: undefined,
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
  const billing = await handlers.get('accounts:billing-view')(event, {
    context: old,
    input: { organizationId: 'a' },
  });
  assert.equal(billing.ok, false);
});
