import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LinearConnector } from '../src/main/features/linear/service.ts';
import { registerLinearIpc } from '../src/main/features/linear/ipc.ts';

const tools = [
  {
    name: 'get_issue',
    description: 'Read an issue',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_issue',
    annotations: { readOnlyHint: false },
    description: 'Create an issue',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
      additionalProperties: false,
    },
  },
];

function setup() {
  let saved;
  const calls = [];
  let issue = { id: 'issue-1', title: 'Existing issue' };
  const store = {
    async load() {
      return saved;
    },
    async save(value) {
      saved = structuredClone(value);
    },
  };
  const remote = {
    async connect() {},
    async listTools() {
      return tools;
    },
    async callTool(name, args) {
      calls.push({ name, args });
      if (name === 'create_issue') issue = { id: 'issue-1', title: args.title };
      return { content: [{ type: 'text', text: JSON.stringify(issue) }] };
    },
    async close() {},
  };
  const connector = new LinearConnector(
    store,
    async () => {},
    () => {},
    () => remote,
  );
  return { connector, calls, store, remote };
}

test('connector IPC rejects other frames and invalid access or approval requests', async () => {
  const { connector } = setup();
  const handlers = new Map();
  const frame = {};
  const contents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  const event = { sender: contents, senderFrame: frame };
  registerLinearIpc(
    { handle: (name, handler) => handlers.set(name, handler) },
    () => ({ webContents: contents }),
    'file:///app/index.html',
    connector,
    { refreshTools() {} },
  );
  assert.equal(
    (
      await handlers.get('linear:connect')(
        { ...event, senderFrame: {} },
        'write',
      )
    ).ok,
    false,
  );
  assert.equal(
    (await handlers.get('linear:connect')(event, 'admin')).ok,
    false,
  );
  assert.equal(
    (
      await handlers.get('linear:decide')(event, {
        id: {},
        decision: 'approve',
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await handlers.get('linear:decide')(event, {
        id: 'missing',
        decision: 'approve',
      })
    ).ok,
    false,
  );
  assert.equal(
    (await handlers.get('linear:status')(event)).value.state,
    'disconnected',
  );
  await connector.close();
});

test('restart preserves uncertain writes and cancels approvals from the closed session', async () => {
  const record = {
    access: 'write',
    actions: [
      {
        id: 'old-running',
        chatId: 'old',
        tool: 'create_issue',
        arguments: { title: 'Only once' },
        status: 'running',
      },
      {
        id: 'old-pending',
        chatId: 'old',
        tool: 'create_issue',
        arguments: { title: 'Not approved' },
        status: 'pending',
      },
    ],
  };
  const connector = new LinearConnector(
    { load: async () => record, save: async () => {} },
    async () => {},
    () => {},
  );
  const status = await connector.status();
  assert.deepEqual(
    status.actions.map((action) => action.status),
    ['unknown', 'cancelled'],
  );
  assert.equal(status.state, 'disconnected');
  await connector.close();
});

test('overlapping sign-ins cannot mix authorization contexts', async () => {
  const { connector, remote } = setup();
  const ready = Promise.withResolvers();
  remote.connect = () => ready.promise;
  const first = connector.connect('write');
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(connector.connect('read'), /already in progress/);
  ready.resolve();
  await first;
  assert.equal(connector.snapshot().access, 'write');
  await connector.close();
});

test('a narrower granted OAuth scope never appears as write access or exposes write tools', async () => {
  const { remote } = setup();
  const connector = new LinearConnector(
    { load: async () => undefined, save: async () => {} },
    async () => {},
    () => {},
    (record) => {
      remote.connect = async () => {
        record.tokens = {
          access_token: 'fixture',
          token_type: 'Bearer',
          scope: 'read',
        };
      };
      return remote;
    },
  );
  assert.equal((await connector.connect('write')).access, 'read');
  const agent = await connector.agent('read-chat');
  assert.deepEqual(
    agent.tools.map((tool) => tool.name),
    ['get_issue'],
  );
  await assert.rejects(
    agent.call('create_issue', { title: 'Not allowed' }),
    /available/,
  );
  await connector.close();
});

test('an uncertain mutation is recorded durably and is not automatically repeated', async () => {
  const { connector, remote, calls, store } = setup();
  remote.callTool = async () => {
    calls.push('submitted');
    throw Error('Connection dropped');
  };
  await connector.connect('write');
  const agent = await connector.agent('chat-1');
  const writing = agent.call('create_issue', { title: 'Only once' });
  const rejected = assert.rejects(writing, /dropped/);
  await new Promise((resolve) => setImmediate(resolve));
  await connector.decide(connector.snapshot().actions[0].id, 'approve');
  await rejected;
  assert.equal((await store.load()).actions[0].status, 'unknown');
  await assert.rejects(
    agent.call('create_issue', { title: 'Only once' }),
    /uncertain/,
  );
  assert.equal(calls.length, 1);
  await connector.close();
});

test('cancelling a chat rejects its pending change without contacting Linear', async () => {
  const { connector, calls } = setup();
  await connector.connect('write');
  const agent = await connector.agent('chat-1');
  const writing = agent.call('create_issue', { title: 'Cancel me' });
  const rejected = assert.rejects(writing, /cancel/);
  await new Promise((resolve) => setImmediate(resolve));
  connector.cancelChat('chat-1');
  await rejected;
  assert.equal(connector.snapshot().actions[0].status, 'cancelled');
  assert.equal(calls.length, 0);
  connector.resumeChat('chat-1');
  await agent.call('get_issue', { id: 'SUP-1' });
  assert.equal(calls.length, 1);
  await connector.close();
});

test('a connected agent reads Linear and writes only after approval of exact inputs', async () => {
  const { connector, calls } = setup();
  await connector.connect('write');
  const agent = await connector.agent('chat-1');
  await agent.call('get_issue', { id: 'SUP-1' });
  assert.deepEqual(calls, [{ name: 'get_issue', args: { id: 'SUP-1' } }]);
  const writing = agent.call('create_issue', { title: 'Investigate checkout' });
  await new Promise((resolve) => setImmediate(resolve));
  const action = connector.snapshot().actions[0];
  assert.equal(action.status, 'pending');
  assert.deepEqual(action.arguments, { title: 'Investigate checkout' });
  assert.equal(calls.length, 1);
  await connector.decide(action.id, 'approve');
  await writing;
  assert.equal(calls[1].args.title, 'Investigate checkout');
  assert.equal(connector.snapshot().actions[0].status, 'verified');
  await connector.close();
});

test('a write whose read-back does not match stays uncertain and cannot be repeated', async (t) => {
  const { connector, remote, calls } = setup();
  t.after(() => connector.close());
  const call = remote.callTool;
  remote.callTool = async (name, args) => {
    const result = await call(name, args);
    return name === 'get_issue'
      ? {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id: 'issue-1', title: 'Different title' }),
            },
          ],
        }
      : result;
  };
  await connector.connect('write');
  const agent = await connector.agent('chat-1');
  const args = { title: 'Investigate checkout' };
  const write = agent.call('create_issue', args);
  await new Promise((resolve) => setImmediate(resolve));
  await connector.decide(connector.snapshot().actions[0].id, 'approve');
  await write;
  assert.equal(connector.snapshot().actions[0].status, 'unknown');
  await assert.rejects(agent.call('create_issue', args), /uncertain/);
  assert.equal(calls.filter((call) => call.name === 'create_issue').length, 1);
});

test('read-only access, invalid arguments and invented tools cannot mutate Linear', async () => {
  const { connector, calls } = setup();
  await connector.connect('read');
  const agent = await connector.agent('chat-1');
  await assert.rejects(
    agent.call('create_issue', { title: 'No' }),
    /read-only|available/,
  );
  await assert.rejects(agent.call('get_issue', { id: 123 }), /inputs/);
  await assert.rejects(agent.call('invented', {}), /available/);
  assert.equal(calls.length, 0);
  await connector.close();
});

test('disconnect cancels pending approvals and stale agents cannot use a reconnected account', async () => {
  const { connector, calls } = setup();
  await connector.connect('write');
  const agent = await connector.agent('chat-1');
  const writing = agent.call('create_issue', { title: 'Never submit' });
  const rejected = assert.rejects(writing, /cancel|disconnect/);
  await new Promise((resolve) => setImmediate(resolve));
  const id = connector.snapshot().actions[0].id;
  await connector.disconnect();
  await rejected;
  await connector.connect('write');
  await assert.rejects(connector.decide(id, 'approve'), /pending/);
  await assert.rejects(agent.call('get_issue', { id: 'SUP-1' }), /disconnect/);
  assert.equal(calls.length, 0);
  await connector.close();
});

test('saved credentials restore only for their account and old agents stop on a context switch', async () => {
  let allowed = false,
    generation = 1,
    restored = 0,
    calls = 0;
  const connector = new LinearConnector(
    {
      load: async () => ({
        access: 'read',
        actions: [],
        tokens: {
          access_token: 'private',
          token_type: 'Bearer',
          scope: 'read',
        },
      }),
      save: async () => {},
    },
    async () => {},
    () => {},
    () => ({
      connect: async () => {
        restored++;
      },
      listTools: async () => tools,
      callTool: async () => {
        calls++;
        return { content: [] };
      },
      close: async () => {},
    }),
    {
      principal: () => 'account-a',
      generation: () => generation,
      canUse: async () => allowed,
    },
  );
  assert.equal((await connector.status()).state, 'disconnected');
  assert.equal(restored, 0);
  allowed = true;
  await connector.status();
  assert.equal(restored, 1);
  const agent = await connector.agent('old');
  generation++;
  await assert.rejects(agent.call('get_issue', { id: 'x' }));
  assert.equal(calls, 0);
  await connector.close();
});
