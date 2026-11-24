import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectionCatalog } from '../src/renderer/fixtures/connections.ts';
import {
  connectionProviders,
  providerFor,
} from '../src/main/integrations/connection-providers.ts';
import { ApiConnection } from '../src/main/integrations/connection-api.ts';
import { McpConnection } from '../src/main/integrations/connection-mcp.ts';
import {
  ApiAuthorization,
  ConnectionReturn,
  connectionUrl,
  connectionText,
  redactConnection,
  toolFingerprint,
} from '../src/main/integrations/connection-oauth.ts';
import { Connections } from '../src/main/features/connections/service.ts';
import { OAuthBroker } from '../src/main/integrations/oauth-broker.ts';
import { registerConnectionsIpc } from '../src/main/features/connections/ipc.ts';
import { linearFixture } from './support/linear-server.mjs';

const read = {
  name: 'get_record',
  description: 'Read one record',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
};
const write = {
  ...read,
  name: 'change_record',
  annotations: { readOnlyHint: false },
};
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const setupValues = (provider) =>
  Object.fromEntries(
    provider.fields.map((field) => [
      field.key,
      // Stripe fixtures use rk_test keys and livemode:false, so pin Test here.
      (provider.id === 'stripe' && field.key === 'environment'
        ? 'Test'
        : field.value) ??
        {
          site: provider.id.startsWith('salesforce')
            ? 'example.my.salesforce.com'
            : 'example.freshdesk.com',
          key:
            provider.id === 'stripe'
              ? 'rk_test_fixturesecret'
              : 'customer-secret',
          orgId: '12345',
          spaceId: 'space-1',
          tenant: 'example.onmicrosoft.com',
          teamId: 'team-1',
          channelId: 'channel-1',
          channels: 'C12345678',
          endpoint: 'https://admin.example.test/api',
          operations: JSON.stringify([
            {
              name: 'get_record',
              description: 'Read record',
              method: 'GET',
              path: '/records/{id}',
              inputSchema: read.inputSchema,
              readOnly: true,
            },
          ]),
        }[field.key] ??
        'customer-app',
    ]),
  );
function harness(saved, savedId = 'freshdesk', discover) {
  const stores = new Map();
  const calls = [];
  const remotes = [];
  if (saved) stores.set(savedId, structuredClone(saved));
  const service = new Connections(
    (id) => ({
      load: async () => stores.get(id),
      save: async (record) => {
        stores.set(id, structuredClone(record));
      },
      remove: async () => {
        stores.delete(id);
      },
    }),
    async () => {},
    () => {},
    (provider, record) => {
      const remote = {
        async connect() {
          record.tokens = {
            access_token: 'access-secret',
            token_type: 'Bearer',
          };
        },
        async listTools() {
          return [read, write];
        },
        async callTool(name, args) {
          calls.push({ name, args });
          return { content: [{ type: 'text', text: JSON.stringify(args) }] };
        },
        finish() {},
        async close() {},
      };
      remotes.push(remote);
      return remote;
    },
    undefined,
    new OAuthBroker('https://accounts.test', async () => 'fixture-session'),
    discover,
  );
  return { service, stores, calls, remotes };
}
test('choice fields expose a valid default when saved values are empty', async (t) => {
  for (const provider of connectionProviders.filter((p) =>
    p.fields.some((f) => f.choices),
  )) {
    const field = provider.fields.find((f) => f.choices);
    const { service } = harness(
      { access: 'read', actions: [], values: { [field.key]: '' } },
      provider.id,
    );
    t.after(() => service.close());
    await service.status();
    const shown = service
      .snapshot()
      .connections.find((p) => p.id === provider.id)
      .fields.find((f) => f.key === field.key);
    assert.equal(shown.value, field.value, provider.id);
  }
});
const connect = async (service, id = 'freshdesk', access = 'write') =>
  service.connect({ id, access, values: setupValues(providerFor(id)) });
// Billing tests retain their saved restricted-key fixture; OAuth is tested separately.
const savedStripeRemote = (provider, record, save, open) => {
  record.values.key = 'rk_test_fixturesecret';
  return new ApiConnection(provider, record, save, open);
};

test('every catalog entry has a main-owned setup, with no duplicate provider IDs', (t) => {
  const previous = process.env.SUPAHELP_GOOGLE_CLIENT_ID;
  process.env.SUPAHELP_GOOGLE_CLIENT_ID = 'fixture-google-desktop';
  for (const key of [
    'SUPAHELP_SLACK_CLIENT_ID',
    'SUPAHELP_TEAMS_CLIENT_ID',
    'SUPAHELP_SALESFORCE_CLIENT_ID',
  ]) {
    const previous = process.env[key];
    process.env[key] = 'fixture-public-app';
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.after(() => {
    if (previous === undefined) delete process.env.SUPAHELP_GOOGLE_CLIENT_ID;
    else process.env.SUPAHELP_GOOGLE_CLIENT_ID = previous;
  });
  assert.equal(connectionCatalog.length, 33);
  assert.equal(connectionProviders.length, 31);
  assert.equal(new Set(connectionProviders.map((p) => p.id)).size, 31);
  assert.deepEqual(
    connectionCatalog.map((p) => p.id).sort(),
    [...connectionProviders.map((p) => p.id), 'linear', 'zendesk'].sort(),
  );
  for (const provider of connectionProviders) {
    assert.match(provider.documentation, /^https:\/\//);
    assert.ok(provider.instructions);
    if (provider.transport === 'api') {
      const record = {
        access: 'write',
        actions: [],
        values: setupValues(provider),
      };
      assert.ok(
        new ApiConnection(
          provider,
          record,
          async () => {},
          async () => {},
        ),
      );
    }
  }
});

test('callbacks validate exact destination, state, duplicates, cancellation and one-time use', async (t) => {
  const returning = new ConnectionReturn('https://127.0.0.1:49154/callback');
  t.after(() => returning.close());
  await returning.start();
  const url = new URL(returning.redirect);
  url.search = new URLSearchParams({ state: returning.state, code: 'code' });
  for (const invalid of [
    url.href.replace('127.0.0.1', 'attacker.test'),
    url.href.replace('/callback', '/other'),
    url.href.replace(returning.state, 'wrong'),
    `${url.href}&code=other`,
    `${url.href}#fragment`,
  ])
    assert.throws(() => returning.complete(invalid), /Invalid/);
  returning.complete(url.href);
  assert.equal(await returning.code(), 'code');
  assert.throws(() => returning.complete(url.href), /Invalid/);
  assert.throws(
    () => new ConnectionReturn('https://attacker.test/callback'),
    /loopback/,
  );
  const cancelled = new ConnectionReturn();
  cancelled.cancel();
  await assert.rejects(cancelled.code(), /cancelled/);
});

test('native OAuth uses state and PKCE and stores the resulting token before returning', async (t) => {
  const record = {
    access: 'read',
    values: {
      clientId: 'own-app',
      redirectUri: 'https://127.0.0.1:49154/callback',
    },
    actions: [],
  };
  let saved = false;
  let auth;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const params = new URLSearchParams(init.body);
    assert.equal(String(input), 'https://vendor.test/token');
    assert.equal(params.get('client_id'), 'own-app');
    assert.ok(params.get('code_verifier'));
    assert.equal(init.redirect, 'error');
    return json({
      access_token: 'access-secret',
      refresh_token: 'rotating-secret',
      expires_in: 3600,
    });
  });
  auth = new ApiAuthorization(
    record,
    async () => {
      saved = true;
    },
    async (value) => {
      const url = new URL(value);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({
        state: url.searchParams.get('state'),
        code: 'test-code',
      });
      auth.finish(callback.href);
    },
    {
      authorize: 'https://vendor.test/authorize',
      token: 'https://vendor.test/token',
      scopes: 'read',
    },
  );
  await auth.connect(true);
  assert.equal(saved, true);
  assert.equal(record.tokens.refresh_token, 'rotating-secret');
  auth.close();
});

test('rotating refreshes are serialized and every caller waits for durable storage', async (t) => {
  const gate = Promise.withResolvers();
  let count = 0;
  const record = {
    access: 'read',
    values: { clientId: 'own-app' },
    actions: [],
    tokens: {
      access_token: 'expired',
      refresh_token: 'old',
      token_type: 'Bearer',
    },
    expiresAt: 1,
  };
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    return json({
      access_token: 'new',
      refresh_token: 'rotated',
      expires_in: 3600,
    });
  });
  const auth = new ApiAuthorization(
    record,
    () => gate.promise,
    async () => {},
    {
      authorize: 'https://vendor.test/authorize',
      token: 'https://vendor.test/token',
      scopes: 'read',
    },
  );
  let completed = 0;
  const first = auth.ready().then(() => completed++);
  await tick();
  const second = auth.ready().then(() => completed++);
  await tick();
  assert.equal(completed, 0);
  assert.equal(count, 1);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(completed, 2);
});

test('a token storage failure prevents future use of the unpersisted rotated token', async (t) => {
  const record = {
    access: 'read',
    values: { clientId: 'own-app' },
    actions: [],
    tokens: {
      access_token: 'expired',
      refresh_token: 'old',
      token_type: 'Bearer',
    },
    expiresAt: 1,
  };
  t.mock.method(globalThis, 'fetch', async () =>
    json({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }),
  );
  const auth = new ApiAuthorization(
    record,
    async () => {
      throw Error('disk unavailable');
    },
    async () => {},
    {
      authorize: 'https://vendor.test/authorize',
      token: 'https://vendor.test/token',
      scopes: 'read',
    },
  );
  await assert.rejects(auth.ready(), /disk/);
  await assert.rejects(auth.ready(), /saved/);
});

test('new connection snapshots and returned data never contain credentials or signed attachments', async (t) => {
  const { service } = harness();
  t.after(() => service.close());
  await connect(service);
  const snapshot = JSON.stringify(await service.status());
  assert.doesNotMatch(snapshot, /customer-secret|access-secret/);
  const record = {
    values: { key: 'customer-secret', clientSecret: 'client-secret' },
    tokens: { access_token: 'access-secret' },
  };
  const scrubbed = JSON.stringify(
    redactConnection(
      {
        Authorization: 'Bearer access-secret',
        text: `customer-secret ${Buffer.from('customer-secret:X').toString('base64')}`,
        attachments: [{ url: 'https://files.test/a?sig=secret' }],
        image: 'https://files.test/a?X-Amz-Signature=secret',
      },
      record,
    ),
  );
  assert.doesNotMatch(
    scrubbed,
    /access-secret|customer-secret|cHVzdG9tZXItc2VjcmV0Olg=|sig=secret|Signature=secret/,
  );
});

test('reads work, changes wait for exact approval, disconnect invalidates old capabilities', async (t) => {
  const { service, calls, stores } = harness();
  t.after(() => service.close());
  await connect(service);
  const [{ agent }] = await service.agents('chat');
  await agent.call('get_record', { id: 'one' });
  const args = { id: 'two' };
  const writing = agent.call('change_record', args);
  args.id = 'tampered';
  await tick();
  const action = service
    .snapshot()
    .connections.find((p) => p.id === 'freshdesk').actions[0];
  assert.equal(calls.length, 1);
  assert.equal(action.arguments.id, 'two');
  await service.decide('freshdesk', action.id, 'approve');
  await writing;
  assert.equal(calls[1].args.id, 'two');
  assert.equal(stores.get('freshdesk').actions[0].status, 'returned');
  await service.disconnect('freshdesk');
  assert.equal(stores.get('freshdesk').tokens, undefined);
  assert.deepEqual(stores.get('freshdesk').values, {});
  await assert.rejects(agent.call('get_record', { id: 'one' }), /changed/);
});

test('read-only connections reject write tools, invented tools and invalid schemas', async (t) => {
  const { service, calls } = harness();
  t.after(() => service.close());
  await connect(service, 'freshdesk', 'read');
  const [{ agent }] = await service.agents('chat');
  await assert.rejects(
    agent.call('change_record', { id: 'one' }),
    /unavailable/,
  );
  await assert.rejects(agent.call('invented', {}), /unavailable/);
  await assert.rejects(agent.call('get_record', { id: 12 }), /inputs/);
  assert.equal(calls.length, 0);
});

test('cancelled and uncertain mutations do not silently execute again', async (t) => {
  const { service, remotes, calls } = harness();
  t.after(() => service.close());
  await connect(service);
  const [{ agent }] = await service.agents('chat');
  const pending = agent.call('change_record', { id: 'one' });
  const cancelled = assert.rejects(pending, /cancelled|stopped/);
  await tick();
  service.cancelChat('chat');
  await cancelled;
  assert.equal(calls.length, 0);
  service.resumeChat('chat');
  remotes[0].callTool = async () => {
    throw Error('network dropped');
  };
  const uncertain = agent.call('change_record', { id: 'two' });
  const rejected = assert.rejects(uncertain, /network/);
  await tick();
  await service.decide(
    'freshdesk',
    service.snapshot().connections.find((p) => p.id === 'freshdesk').actions[0]
      .id,
    'approve',
  );
  await rejected;
  await assert.rejects(agent.call('change_record', { id: 'two' }), /uncertain/);
});

test('restart recovers receipts and cannot turn a pending action into approval', async (t) => {
  const { service } = harness({
    access: 'write',
    values: {},
    actions: [
      {
        id: 'one',
        chatId: 'old',
        tool: 'change_record',
        arguments: {},
        status: 'running',
      },
      {
        id: 'two',
        chatId: 'old',
        tool: 'change_record',
        arguments: {},
        status: 'pending',
      },
    ],
  });
  t.after(() => service.close());
  const item = (await service.status()).connections.find(
    (p) => p.id === 'freshdesk',
  );
  assert.deepEqual(
    item.actions.map((a) => a.status),
    ['unknown', 'cancelled'],
  );
  await assert.rejects(
    service.decide('freshdesk', 'two', 'approve'),
    /pending/,
  );
});

test('custom MCP annotations do not bypass approval; explicit schema review grants reads only to the reviewed schema', async (t) => {
  const { service } = harness();
  t.after(() => service.close());
  await connect(service, 'custom-mcp-0a1b2c3d', 'read');
  let [{ agent }] = await service.agents('chat');
  assert.equal(agent.tools.length, 0);
  await assert.rejects(
    service.reviewReads('custom-mcp-0a1b2c3d', [
      { name: read.name, fingerprint: 'wrong' },
    ]),
    /changed/,
  );
  await service.reviewReads('custom-mcp-0a1b2c3d', [
    { name: read.name, fingerprint: toolFingerprint(read) },
  ]);
  [{ agent }] = await service.agents('chat-2');
  assert.deepEqual(
    agent.tools.map((t) => t.name),
    ['get_record'],
  );
  await agent.call('get_record', { id: 'one' });
});

test('the user can add several MCP servers and APIs; each has its own name, tools and removal', async (t) => {
  const { service, stores } = harness();
  t.after(() => service.close());
  await assert.rejects(connect(service, 'custom-mcp'), /new connection/);
  const first = 'custom-mcp-0a1b2c3d';
  const second = 'custom-mcp-11223344';
  await service.connect({
    id: first,
    access: 'write',
    values: { ...setupValues(providerFor(first)), name: 'Billing tools' },
  });
  await service.connect({
    id: second,
    access: 'write',
    values: { ...setupValues(providerFor(second)), name: 'Ops tools' },
  });
  const added = service
    .snapshot()
    .connections.filter((c) => c.instanceOf === 'custom-mcp');
  assert.deepEqual(
    added.map((c) => [c.id, c.name, c.state]),
    [
      [first, 'Billing tools', 'connected'],
      [second, 'Ops tools', 'connected'],
    ],
  );
  assert.deepEqual(
    (await service.agents('chat')).map((a) => a.name),
    ['custom_mcp_0a1b2c3d', 'custom_mcp_11223344'],
  );
  // Disconnecting keeps the entry and its name; removing deletes it and its file.
  await service.disconnect(first);
  assert.equal(
    service.snapshot().connections.find((c) => c.id === first).name,
    'Billing tools',
  );
  await service.remove(first);
  assert.equal(stores.has(first), false);
  assert.equal(
    service.snapshot().connections.some((c) => c.id === first),
    false,
  );
  assert.equal(stores.has(second), true);
  await assert.rejects(service.remove('freshdesk'), /own connections/);
  await assert.rejects(
    service.connect({ id: 'custom-mcp-zz', access: 'read', values: {} }),
    /./,
  );
});

test('saved servers are found on restart; an unfinished one is dropped; the old single record moves to a real entry', async (t) => {
  const { service, stores } = harness(
    {
      access: 'write',
      values: { endpoint: 'https://old.example/mcp', key: 'legacy-secret' },
      actions: [],
    },
    'custom-mcp',
    async () => ['custom-mcp-aabbccdd', 'custom-api-00000001'],
  );
  stores.set('custom-mcp-aabbccdd', {
    access: 'write',
    values: { name: 'Kept', endpoint: 'https://kept.example/mcp', key: 'k' },
    actions: [],
    tokens: undefined,
  });
  stores.set('custom-api-00000001', {
    access: 'write',
    values: { name: 'Never finished' },
    actions: [],
  });
  t.after(() => service.close());
  await service.status();
  const mine = service
    .snapshot()
    .connections.filter((c) => c.instanceOf)
    .map((c) => [c.id, c.name]);
  assert.deepEqual(mine.sort(), [
    ['custom-mcp-00000000', 'Your MCP server'],
    ['custom-mcp-aabbccdd', 'Kept'],
  ]);
  assert.equal(stores.has('custom-api-00000001'), false);
  assert.deepEqual(stores.get('custom-mcp').values, {});
});

test('known MCP services cannot expose generic execution tools as automatic reads', async (t) => {
  const { service, remotes } = harness();
  t.after(() => service.close());
  // Replace the first remote's discovery while connection establishment waits.
  const connecting = connect(service, 'notion', 'read');
  await tick();
  await connecting;
  const item = service.snapshot().connections.find((p) => p.id === 'notion');
  assert.equal(item.state, 'error');
  assert.equal(item.tools.length, 0);
  assert.equal(remotes.length, 1);
});

test('API clients keep tenant, chosen channels, private notes and request bodies bounded', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), ...options });
    return json({ id: 'one' });
  });
  const provider = providerFor('freshdesk');
  const record = {
    access: 'write',
    values: setupValues(provider),
    actions: [],
  };
  const api = new ApiConnection(
    provider,
    record,
    async () => {},
    async () => {},
  );
  await api.connect(false);
  await api.callTool('add_internal_note', {
    id: '123',
    text: 'Private investigation',
  });
  assert.equal(
    requests[1].url,
    'https://example.freshdesk.com/api/v2/tickets/123/notes',
  );
  assert.equal(requests[1].redirect, 'error');
  assert.deepEqual(JSON.parse(requests[1].body), {
    body: 'Private investigation',
    private: true,
  });
  assert.throws(
    () =>
      new ApiConnection(
        provider,
        {
          ...record,
          values: {
            ...record.values,
            site: 'https://freshdesk.com.attacker.test',
          },
        },
        async () => {},
        async () => {},
      ),
    /canonical/,
  );
  await assert.rejects(api.callTool('get_ticket', { id: '..' }), /target/);
  const slack = new ApiConnection(
    providerFor('slack'),
    {
      access: 'write',
      values: {
        ...setupValues(providerFor('slack')),
        clientId: 'fixture-public-app',
      },
      actions: [],
    },
    async () => {},
    async () => {},
  );
  const tools = await slack.listTools();
  assert.deepEqual(
    tools.find((t) => t.name === 'post_message').inputSchema.properties.channel
      .enum,
    ['C12345678'],
  );
});

test('custom REST rejects unsafe definitions and credentials and never offers arbitrary URL fetching', async (t) => {
  const provider = providerFor('custom-api');
  const values = setupValues(provider);
  for (const path of [
    'https://attacker.test',
    '//attacker.test',
    '/../admin',
    '/records?redirect=other',
    '/records\\other',
  ])
    assert.throws(
      () =>
        new ApiConnection(
          provider,
          {
            access: 'read',
            actions: [],
            values: {
              ...values,
              operations: JSON.stringify([
                {
                  name: 'bad',
                  description: 'bad',
                  method: 'GET',
                  path,
                  inputSchema: read.inputSchema,
                  readOnly: true,
                },
              ]),
            },
          },
          async () => {},
          async () => {},
        ),
      /definition/,
    );
  for (const header of ['Host', 'Cookie', 'Content-Length', 'X-Key\r\nOther'])
    assert.throws(
      () =>
        new ApiConnection(
          provider,
          { access: 'read', actions: [], values: { ...values, header } },
          async () => {},
          async () => {},
        ),
      /header/,
    );
  const api = new ApiConnection(
    provider,
    { access: 'read', actions: [], values },
    async () => {},
    async () => {},
  );
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(
      String(url),
      'https://admin.example.test/api/records/customer%2Fone?id=customer%2Fone',
    );
    assert.equal(init.headers.Authorization, 'customer-secret');
    return json({ value: 'customer-secret' });
  });
  const result = await api.callTool('get_record', { id: 'customer/one' });
  assert.doesNotMatch(result.content[0].text, /customer-secret/);
  await assert.rejects(
    api.callTool('fetch_url', { url: 'https://attacker.test' }),
    /unavailable/,
  );
});

test('connection IPC rejects other frames and malformed requests before invoking service logic', async (t) => {
  const { service } = harness();
  t.after(() => service.close());
  const handlers = new Map();
  const frame = {};
  const contents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  const event = { sender: contents, senderFrame: frame };
  registerConnectionsIpc(
    { handle: (name, fn) => handlers.set(name, fn) },
    () => ({ webContents: contents }),
    'file:///app/index.html',
    service,
    { refreshTools() {} },
  );
  assert.equal(
    (await handlers.get('connections:status')({ ...event, senderFrame: {} }))
      .ok,
    false,
  );
  for (const input of [
    null,
    [],
    { id: 'no-such-provider', access: 'read', values: {} },
    { id: 'freshdesk', access: 'admin', values: {} },
  ])
    assert.equal(
      (await handlers.get('connections:connect')(event, input)).ok,
      false,
    );
  assert.equal(
    (
      await handlers.get('connections:decide')(event, {
        id: 'freshdesk',
        action: {},
        decision: 'approve',
      })
    ).ok,
    false,
  );
  assert.equal(
    (await handlers.get('connections:status')(event)).value.connections.length,
    31,
  );
});

test('the shared MCP client performs real local OAuth/PKCE, discovery and transport calls', async (t) => {
  const fixture = await linearFixture();
  t.after(() => fixture.close());
  const provider = { ...providerFor('custom-mcp'), endpoint: fixture.endpoint };
  const record = { access: 'write', values: {}, actions: [] };
  let saved = 0;
  const remote = new McpConnection(
    provider,
    record,
    async () => {
      saved++;
    },
    (url) => fixture.authorize(url),
  );
  t.after(() => remote.close());
  await remote.connect(true);
  assert.ok(saved > 1);
  assert.equal((await remote.listTools()).length, 2);
  assert.match(
    (await remote.callTool('get_issue', { id: 'SUP-1' })).content[0].text,
    /Checkout/,
  );
  assert.doesNotMatch(
    JSON.stringify(await remote.callTool('get_issue', { id: 'SUP-1' })),
    /fixture-access-secret/,
  );
});

test('connection URLs reject credentials, fragments and non-HTTPS remote endpoints', () => {
  for (const value of [
    'https://user:password@vendor.test',
    'https://vendor.test/#token',
    'http://vendor.test',
    'file:///tmp/server',
  ])
    assert.throws(() => connectionUrl(value));
  assert.equal(connectionUrl('http://127.0.0.1:1234/mcp', true).port, '1234');
});

test('Stripe refunds require exact approval, account/environment binding, durable idempotency and independent read-back', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    requests.push({ url, ...init });
    if (url.endsWith('/account')) return json({ id: 'acct_fixture' });
    if (url.includes('/charges/'))
      return json({
        id: 'ch_1',
        customer: 'cus_1',
        currency: 'usd',
        livemode: false,
        paid: true,
        amount: 2000,
        amount_refunded: 0,
      });
    return json({
      id: 're_1',
      charge: 'ch_1',
      amount: 500,
      currency: 'usd',
      livemode: false,
      status: 'succeeded',
    });
  });
  const stores = new Map();
  const service = new Connections(
    (id) => ({
      load: async () => stores.get(id),
      save: async (value) => stores.set(id, structuredClone(value)),
    }),
    async () => {},
    () => {},
    savedStripeRemote,
    undefined,
    new OAuthBroker('https://accounts.test', async () => 'fixture-session'),
  );
  t.after(() => service.close());
  await connect(service, 'stripe');
  const [{ agent }] = await service.agents('billing');
  await assert.rejects(
    agent.call('refund_charge', {
      charge_id: 'ch_1',
      customer_id: 'cus_1',
      amount: 0,
      currency: 'usd',
    }),
    /inputs/,
  );
  const writing = agent.call('refund_charge', {
    charge_id: 'ch_1',
    customer_id: 'cus_1',
    amount: 500,
    currency: 'usd',
  });
  await tick();
  const item = service.snapshot().connections.find((c) => c.id === 'stripe');
  const action = item.actions[0];
  assert.equal(action.status, 'pending');
  assert.equal(action.account, 'acct_fixture · Test');
  assert.equal(requests.length, 1);
  assert.equal(
    stores.get('stripe').actions[0].arguments._requestId,
    action.arguments._requestId,
  );
  await service.decide('stripe', action.id, 'approve');
  await writing;
  const writeRequest = requests.find((r) => r.method === 'POST');
  assert.equal(
    writeRequest.headers['Idempotency-Key'],
    action.arguments._requestId,
  );
  assert.deepEqual(Object.fromEntries(new URLSearchParams(writeRequest.body)), {
    charge: 'ch_1',
    amount: '500',
  });
  assert.equal(
    service.snapshot().connections.find((c) => c.id === 'stripe').actions[0]
      .status,
    'verified',
  );
});

test('Stripe refuses changed customers, environments, currencies and amounts before submitting money', async (t) => {
  let charge = {
    id: 'ch_1',
    customer: 'cus_1',
    currency: 'usd',
    livemode: false,
    paid: true,
    amount: 1000,
    amount_refunded: 0,
  };
  let submitted = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init.method !== 'GET') submitted++;
    return json(charge);
  });
  const provider = providerFor('stripe');
  const api = new ApiConnection(
    provider,
    {
      access: 'write',
      values: { ...setupValues(provider), key: 'rk_test_fixturesecret' },
      actions: [],
    },
    async () => {},
    async () => {},
  );
  const args = {
    charge_id: 'ch_1',
    customer_id: 'cus_1',
    amount: 500,
    currency: 'usd',
    _requestId: '00000000-0000-4000-8000-000000000000',
  };
  for (const changed of [
    { customer: 'cus_other' },
    { livemode: true },
    { currency: 'eur' },
    { amount_refunded: 900 },
    { id: 'ch_other' },
  ]) {
    charge = {
      id: 'ch_1',
      customer: 'cus_1',
      currency: 'usd',
      livemode: false,
      paid: true,
      amount: 1000,
      amount_refunded: 0,
      ...changed,
    };
    await assert.rejects(api.callTool('refund_charge', args), /changed|match/);
  }
  assert.equal(submitted, 0);
  assert.throws(
    () =>
      new ApiConnection(
        provider,
        {
          access: 'write',
          values: {
            ...setupValues(provider),
            key: 'rk_test_fixturesecret',
            environment: 'Live',
          },
          actions: [],
        },
        async () => {},
        async () => {},
      ),
    /environment/,
  );
});

test('Front send approvals contain the actual draft and a changed version cannot be sent', async (t) => {
  const stores = new Map();
  let draft = {
    id: 'msg_1',
    body: 'Reviewed reply',
    recipients: [{ handle: 'customer@example.test', role: 'to' }],
    draft_version: 'version-1',
  };
  const calls = [];
  const readMessage = {
    ...read,
    name: 'read_message',
    inputSchema: {
      type: 'object',
      properties: { messageId: { type: 'string' } },
      required: ['messageId'],
      additionalProperties: false,
    },
  };
  const send = {
    ...write,
    name: 'send_message',
    inputSchema: {
      type: 'object',
      properties: { draftId: { type: 'string' } },
      required: ['draftId'],
      additionalProperties: false,
    },
  };
  const service = new Connections(
    (id) => ({
      load: async () => stores.get(id),
      save: async (v) => stores.set(id, structuredClone(v)),
    }),
    async () => {},
    () => {},
    () => ({
      connect: async () => {},
      listTools: async () => [readMessage, send],
      callTool: async (name) => {
        calls.push(name);
        return { content: [{ type: 'text', text: JSON.stringify(draft) }] };
      },
      close: async () => {},
      finish() {},
    }),
    undefined,
    new OAuthBroker('https://accounts.test', async () => 'fixture-session'),
  );
  t.after(() => service.close());
  await connect(service, 'front');
  const [{ agent }] = await service.agents('front-chat');
  const writing = agent.call('send_message', { draftId: 'msg_1' });
  const rejected = assert.rejects(writing, /changed/);
  await tick();
  const action = service.snapshot().connections.find((c) => c.id === 'front')
    .actions[0];
  assert.equal(action.arguments._review.body, 'Reviewed reply');
  assert.equal(
    action.arguments._review.recipients[0].handle,
    'customer@example.test',
  );
  draft = {
    ...draft,
    body: 'Changed outside the app',
    draft_version: 'version-2',
  };
  await service.decide('front', action.id, 'approve');
  await rejected;
  assert.equal(calls.includes('send_message'), false);
});

test('Stripe cancellation, fixed-price changes and credit preserve the approved billing effect', async (t) => {
  const writes = [];
  let subscription = {
    id: 'sub_1',
    customer: 'cus_1',
    livemode: false,
    currency: 'usd',
    items: { data: [{ id: 'si_1', quantity: 2, price: { id: 'price_old' } }] },
  };
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (init.method !== 'GET') {
      const body = Object.fromEntries(new URLSearchParams(init.body));
      writes.push({ url, method: init.method, body, headers: init.headers });
      if (url.includes('balance_transactions'))
        return json({ id: 'cbt_1', amount: -500, currency: 'usd' });
      if (init.method === 'DELETE')
        subscription = { ...subscription, status: 'canceled' };
      if (body.cancel_at_period_end)
        subscription = { ...subscription, cancel_at_period_end: true };
      if (body['items[0][price]'])
        subscription = {
          ...subscription,
          items: {
            data: [{ id: 'si_1', quantity: 2, price: { id: 'price_new' } }],
          },
        };
      return json(subscription);
    }
    if (url.endsWith('/customers/cus_1'))
      return json({ id: 'cus_1', currency: 'usd', livemode: false });
    if (url.includes('/prices/'))
      return json({
        id: 'price_new',
        active: true,
        recurring: { interval: 'month' },
        unit_amount: 1200,
        currency: 'usd',
        livemode: false,
      });
    if (url.includes('/balance_transactions/'))
      return json({ id: 'cbt_1', amount: -500, currency: 'usd' });
    return json(subscription);
  });
  const api = new ApiConnection(
    providerFor('stripe'),
    {
      access: 'write',
      values: {
        ...setupValues(providerFor('stripe')),
        key: 'rk_test_fixturesecret',
      },
      actions: [],
    },
    async () => {},
    async () => {},
  );
  const request = { _requestId: '00000000-0000-4000-8000-000000000000' };
  for (const at_period_end of [true, false]) {
    const args = {
      id: 'sub_1',
      customer_id: 'cus_1',
      at_period_end,
      ...request,
    };
    const result = await api.callTool('cancel_subscription', args);
    assert.match(
      await api.verify(
        'cancel_subscription',
        result,
        args,
        new AbortController().signal,
      ),
      /cancellation/,
    );
  }
  assert.deepEqual(writes[0].body, { cancel_at_period_end: 'true' });
  assert.deepEqual(writes[1].body, { invoice_now: 'false', prorate: 'false' });
  const priceArgs = {
    id: 'sub_1',
    customer_id: 'cus_1',
    subscription_item_id: 'si_1',
    new_price_id: 'price_new',
    new_price_amount: 1200,
    currency: 'usd',
    quantity: 2,
    ...request,
  };
  const priceResult = await api.callTool('change_plan', priceArgs);
  assert.equal(writes[2].body.proration_behavior, 'none');
  assert.equal(writes[2].body['items[0][quantity]'], '2');
  assert.match(
    await api.verify(
      'change_plan',
      priceResult,
      priceArgs,
      new AbortController().signal,
    ),
    /price/,
  );
  await assert.rejects(
    api.callTool('change_plan', { ...priceArgs, quantity: 5 }),
    /quantity/,
  );
  const creditArgs = { id: 'cus_1', amount: 500, currency: 'usd', ...request };
  const credit = await api.callTool('add_credit', creditArgs);
  assert.deepEqual(writes[3].body, { amount: '-500', currency: 'usd' });
  assert.match(
    await api.verify(
      'add_credit',
      credit,
      creditArgs,
      new AbortController().signal,
    ),
    /credit/,
  );
  assert.ok(
    writes.every((w) => w.headers['Idempotency-Key'] === request._requestId),
  );
});

test('a pending Stripe refund remains uncertain and cannot bypass duplicate protection with a fresh request identity', async (t) => {
  let submitted = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).endsWith('/account')) return json({ id: 'acct_fixture' });
    if (String(input).includes('/charges/'))
      return json({
        id: 'ch_1',
        customer: 'cus_1',
        currency: 'usd',
        livemode: false,
        paid: true,
        amount: 1000,
        amount_refunded: 0,
      });
    if (init.method === 'POST') submitted++;
    return json({
      id: 're_1',
      charge: 'ch_1',
      amount: 500,
      currency: 'usd',
      status: 'pending',
    });
  });
  const stores = new Map();
  const service = new Connections(
    (id) => ({
      load: async () => stores.get(id),
      save: async (v) => stores.set(id, structuredClone(v)),
    }),
    async () => {},
    () => {},
    savedStripeRemote,
    undefined,
    new OAuthBroker('https://accounts.test', async () => 'fixture-session'),
  );
  t.after(() => service.close());
  await connect(service, 'stripe');
  const [{ agent }] = await service.agents('billing');
  const args = {
    charge_id: 'ch_1',
    customer_id: 'cus_1',
    amount: 500,
    currency: 'usd',
  };
  const writing = agent.call('refund_charge', args);
  await tick();
  const action = service.snapshot().connections.find((c) => c.id === 'stripe')
    .actions[0];
  await service.decide('stripe', action.id, 'approve');
  await writing;
  assert.equal(
    service.snapshot().connections.find((c) => c.id === 'stripe').actions[0]
      .status,
    'unknown',
  );
  await assert.rejects(agent.call('refund_charge', args), /uncertain/);
  assert.equal(submitted, 1);
});

test('response limits stop oversized streams and redaction preserves schema metadata and JSON types', async () => {
  await assert.rejects(
    connectionText(new Response(new Uint8Array(5000)), 1000),
    /large/,
  );
  const value = redactConnection(
    {
      number: 1,
      fields: [{ secret: true }],
      inputSchema: { properties: { password: { type: 'string' } } },
      password__c: 'hidden',
      text: '1',
    },
    { values: { key: '1' } },
  );
  assert.equal(value.number, 1);
  assert.equal(value.fields[0].secret, true);
  assert.deepEqual(value.inputSchema.properties.password, { type: 'string' });
  assert.equal(value.password__c, '[removed secret]');
  assert.equal(value.text, '[removed secret]');
});

test('Help Scout customer search honors read-only access and returns identity fields', async (t) => {
  const query = '(firstName:"Fixture")';
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    assert.equal(init.method, 'GET');
    if (url.pathname.endsWith('/users/me')) return json({ id: 1 });
    assert.equal(url.pathname, '/v2/customers');
    assert.equal(url.searchParams.get('query'), query);
    return json({
      _embedded: {
        customers: [
          {
            id: 42,
            firstName: 'Fixture',
            lastName: 'Customer',
            background: 'Private note',
          },
        ],
      },
      page: { number: 1, totalPages: 2 },
    });
  });
  const provider = providerFor('helpscout');
  const api = new ApiConnection(
    provider,
    {
      access: 'read',
      values: setupValues(provider),
      actions: [],
      tokens: { access_token: 'fixture-token', token_type: 'Bearer' },
    },
    async () => {},
    async () => {},
  );
  await api.connect(false);
  assert.ok(
    (await api.listTools()).some(
      (tool) =>
        tool.name === 'search_customers' && tool.annotations.readOnlyHint,
    ),
  );
  const result = await api.callTool('search_customers', { query });
  assert.deepEqual(JSON.parse(result.content[0].text), {
    customers: [{ id: 42, name: 'Fixture Customer', emails: [] }],
    page: 1,
    has_more: true,
  });
});

test('Help Scout replies include the required customer and status and cannot target a different conversation customer', async (t) => {
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).endsWith('/users/me'))
      return json({ id: 1, firstName: 'Test', lastName: 'Agent' });
    if (init.method === 'GET')
      return json({ id: 123, primaryCustomer: { id: 456 }, status: 'closed' });
    writes.push(JSON.parse(init.body));
    return new Response(null, { status: 201 });
  });
  const record = {
    access: 'write',
    values: setupValues(providerFor('helpscout')),
    actions: [],
    tokens: { access_token: 'fixture-token', token_type: 'Bearer' },
  };
  const api = new ApiConnection(
    providerFor('helpscout'),
    record,
    async () => {},
    async () => {},
  );
  await api.connect(false);
  await api.callTool('reply_to_customer', {
    id: '123',
    customer_id: 456,
    text: 'Reviewed reply',
    status: 'closed',
  });
  assert.deepEqual(writes, [
    { customer: { id: 456 }, text: 'Reviewed reply', status: 'closed' },
  ]);
  await assert.rejects(
    api.callTool('reply_to_customer', {
      id: '123',
      customer_id: 999,
      text: 'Wrong person',
      status: 'active',
    }),
    /customer changed/,
  );
  assert.equal(writes.length, 1);
});

test('the MCP transport bounds response streams before decoding provider JSON', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('x'.repeat(9 * 1024 * 1024), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  const remote = new McpConnection(
    {
      ...providerFor('custom-mcp'),
      endpoint: 'https://server.example.test/mcp',
    },
    { access: 'read', values: { key: 'fixture-key' }, actions: [] },
    async () => {},
    async () => {},
  );
  t.after(() => remote.close());
  await assert.rejects(remote.connect(false), /too large/);
});

test('a REST API with no credential survives a restart and is offered to chat', async (t) => {
  const id = 'custom-api-0000abcd';
  const values = {
    ...setupValues(providerFor('custom-api')),
    name: 'Open',
    header: '',
    key: '',
  };
  const { service, stores } = harness(undefined, id, async () => [id]);
  t.after(() => service.close());
  await service.status();
  await service.connect({ id, access: 'write', values });
  assert.equal((await service.agents('chat')).length, 1);
  // Restart: a new service over the same saved record.
  const again = harness(stores.get(id), id, async () => [id]);
  t.after(() => again.service.close());
  await again.service.status();
  assert.equal(
    again.service.snapshot().connections.find((c) => c.id === id)?.state,
    'connected',
  );
  assert.equal((await again.service.agents('chat')).length, 1);
});
