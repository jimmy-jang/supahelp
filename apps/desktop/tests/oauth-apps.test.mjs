import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ApiAuthorization,
  ConnectionReturn,
} from '../src/main/integrations/connection-oauth.ts';
import { ApiConnection } from '../src/main/integrations/connection-api.ts';
import { McpConnection } from '../src/main/integrations/connection-mcp.ts';
import { providerFor } from '../src/main/integrations/connection-providers.ts';
import {
  connectionSetup,
  Connections,
} from '../src/main/features/connections/service.ts';
import { oauthApp } from '../src/main/integrations/oauth-apps.ts';
import {
  OAuthBroker,
  OAuthBrokerError,
} from '../src/main/integrations/oauth-broker.ts';
import { connectionProviders } from '../src/main/integrations/connection-providers.ts';

const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
const endpoints = {
  authorize: 'https://github.com/login/oauth/authorize',
  token: 'https://github.com/login/oauth/access_token',
  device: 'https://github.com/login/device/code',
  scopes: 'repo',
};
const device = {
  device_code: 'private-device-code',
  user_code: 'ABCD-1234',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 1,
};
const newRecord = () => ({ access: 'read', values: {}, actions: [] });

test('PagerDuty uses an API token for each region and exposes browse tools as reads', async (t) => {
  const provider = providerFor('pagerduty');
  assert.deepEqual(
    provider.fields.map((field) => field.key),
    ['region', 'key'],
  );
  assert.equal(provider.reads.test('browse_incidents'), true);
  assert.equal(provider.reads.test('manage_incidents'), false);
  for (const [region, host] of [
    ['US', 'mcp.pagerduty.com'],
    ['EU', 'mcp.eu.pagerduty.com'],
  ]) {
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      assert.equal(new URL(String(input)).host, host);
      assert.equal(
        new Headers(init.headers).get('authorization'),
        'Token token=private-token',
      );
      const request = JSON.parse(init.body);
      if (request.method === 'initialize')
        return json({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: request.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1' },
          },
        });
      return new Response(null, { status: 202 });
    });
    const remote = new McpConnection(
      provider,
      { ...newRecord(), values: { region, key: 'private-token' } },
      async () => {},
      async () => {
        throw Error('Unexpected browser sign-in');
      },
    );
    try {
      await remote.connect(true);
    } finally {
      await remote.close();
      t.mock.restoreAll();
    }
  }
});

test('catalog snapshots identify only the connections needing a free Supahelp account', async () => {
  const service = new Connections(
    () => ({ load: async () => undefined, save: async () => {} }),
    async () => {},
    () => {},
  );
  try {
    const snapshot = await service.status();
    assert.deepEqual(
      snapshot.connections
        .filter((item) => item.requiresSupahelpAccount)
        .map((item) => item.id)
        .sort(),
      [
        'front',
        'helpscout',
        'hubspot',
        'hubspot-service',
        'intercom',
        'stripe',
        'zoho-desk',
      ],
    );
  } finally {
    await service.close();
  }
});

test('catalog keeps providers visible while reporting review status separately', async () => {
  const pending = ['zendesk', 'intercom', 'teams', 'front', 'stripe'];
  const service = new Connections(
    () => ({ load: async () => undefined, save: async () => {} }),
    async () => {},
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    pending,
  );
  try {
    const snapshot = await service.status();
    assert.deepEqual(snapshot.pendingReview, pending);
    for (const id of pending.filter((id) => id !== 'zendesk')) {
      assert.ok(
        snapshot.connections.some((item) => item.id === id),
        id,
      );
    }
  } finally {
    await service.close();
  }
});

test('builds without the account service or client IDs mark those connections unavailable', async () => {
  const keys = ['GOOGLE', 'GITHUB', 'SLACK', 'TEAMS', 'SALESFORCE'].map(
    (name) => `SUPAHELP_${name}_CLIENT_ID`,
  );
  const saved = keys.map((key) => process.env[key]);
  const unavailable = async (broker) => {
    const service = new Connections(
      () => ({ load: async () => undefined, save: async () => {} }),
      async () => {},
      () => {},
      undefined,
      undefined,
      broker,
    );
    try {
      return (await service.status()).connections
        .filter((item) => item.unavailable)
        .map((item) => item.id)
        .sort();
    } finally {
      await service.close();
    }
  };
  try {
    for (const key of keys) delete process.env[key];
    assert.deepEqual(await unavailable(), [
      'front',
      'github-issues',
      'google-drive',
      'helpscout',
      'hubspot',
      'hubspot-service',
      'intercom',
      'salesforce',
      'salesforce-service',
      'slack',
      'stripe',
      'teams',
      'zoho-desk',
    ]);
    for (const key of keys) process.env[key] = 'public-client-id';
    const broker = new OAuthBroker(
      'https://accounts.test',
      async () => undefined,
    );
    assert.deepEqual(await unavailable(broker), []);
  } finally {
    keys.forEach((key, i) =>
      saved[i] === undefined
        ? delete process.env[key]
        : (process.env[key] = saved[i]),
    );
  }
});

test('signed-out managed reconnect preserves the saved grant before opening provider consent', async () => {
  const saved = {
    ...newRecord(),
    tokens: { access_token: 'saved-private-token' },
  };
  let writes = 0,
    opened = 0,
    lastSaved;
  const broker = new OAuthBroker(
    'https://accounts.test',
    async () => undefined,
  );
  const service = new Connections(
    (id) => ({
      load: async () =>
        id === 'intercom' ? structuredClone(saved) : undefined,
      save: async (record) => {
        writes++;
        lastSaved = structuredClone(record);
      },
    }),
    async () => {
      opened++;
    },
    () => {},
    () => ({
      connect: async () => {},
      listTools: async () => [],
      callTool: async () => {},
      finish() {},
      close: async () => {},
    }),
    undefined,
    broker,
  );
  try {
    await service.status();
    const previousWrites = writes;
    await assert.rejects(
      service.connect({
        id: 'intercom',
        access: 'read',
        values: { region: 'US' },
      }),
      (error) => error.code === 'sign-in-required',
    );
    assert.equal(writes, previousWrites);
    assert.equal(lastSaved.tokens.access_token, 'saved-private-token');
    assert.equal(opened, 0);
    assert.doesNotMatch(
      JSON.stringify(service.snapshot()),
      /saved-private-token/,
    );
  } finally {
    await service.close();
  }
});

test('exchange errors are safe and distinguish expired sign-in from service failure', async (t) => {
  const broker = new OAuthBroker(
    'https://accounts.test',
    async () => 'session',
  );
  for (const status of [401, 403, 503]) {
    t.mock.method(
      globalThis,
      'fetch',
      async () => new Response('private-provider-payload', { status }),
    );
    await assert.rejects(
      broker.authorize('intercom', {}, {}, new AbortController().signal),
      (error) =>
        error.code === (status === 401 ? 'sign-in-required' : 'unavailable') &&
        !error.message.includes('private-provider-payload'),
    );
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async () => {
    throw Error('private-network-detail');
  });
  await assert.rejects(
    broker.authorize('intercom', {}, {}, new AbortController().signal),
    (error) =>
      error.code === 'unavailable' &&
      !error.message.includes('private-network-detail'),
  );
});

test('connection failures preserve safe broker guidance without forwarding provider details', async () => {
  for (const error of [
    new OAuthBrokerError('sign-in-required'),
    new OAuthBrokerError('unavailable'),
    Error('private-credential sign-in is not configured in this build'),
    Error('private-provider-error'),
    Error('Sign-in cancelled or timed out.'),
  ]) {
    const service = new Connections(
      () => ({ load: async () => undefined, save: async () => {} }),
      async () => {},
      () => {},
      () => ({
        connect: async () => {
          throw error;
        },
        listTools: async () => [],
        callTool: async () => {},
        finish() {},
        close: async () => {},
      }),
    );
    try {
      const result = await service.connect({
        id: 'freshdesk',
        access: 'read',
        values: { site: 'example.freshdesk.com', key: 'private-key' },
      });
      const connection = result.connections.find(
        (item) => item.id === 'freshdesk',
      );
      assert.equal(connection.state, 'error');
      assert.doesNotMatch(connection.message, /private-/);
      if (error instanceof OAuthBrokerError)
        assert.equal(connection.message, error.message);
      if (error.message === 'Sign-in cancelled or timed out.')
        assert.match(connection.message, /canceled or timed out/);
    } finally {
      await service.close();
    }
  }
});

test('saved legacy Intercom credentials restore directly without a Supahelp account', async (t) => {
  const saved = {
    ...newRecord(),
    values: {
      clientId: 'legacy-client',
      clientSecret: 'legacy-secret',
      region: 'US',
    },
    tokens: { access_token: 'legacy-access' },
  };
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), 'https://api.intercom.io/me');
    assert.equal(init.headers.Authorization, 'Bearer legacy-access');
    return json({ id: 'admin-1', name: 'Fixture' });
  });
  const service = new Connections(
    (id) => ({
      load: async () =>
        id === 'intercom' ? structuredClone(saved) : undefined,
      save: async () => {},
    }),
    async () => {
      throw Error('Restoration must not open consent');
    },
    () => {},
  );
  try {
    const connection = (await service.status()).connections.find(
      (item) => item.id === 'intercom',
    );
    assert.equal(connection.state, 'connected');
    assert.doesNotMatch(
      JSON.stringify(connection),
      /legacy-secret|legacy-access/,
    );
  } finally {
    await service.close();
  }
});

test('named connections never request developer app IDs, secrets or redirect URLs', () => {
  for (const provider of connectionProviders.filter(
    (item) => !item.id.startsWith('custom-'),
  )) {
    assert.equal(
      provider.fields.some((field) =>
        ['clientId', 'clientSecret', 'redirectUri', 'tenant'].includes(
          field.key,
        ),
      ),
      false,
      provider.id,
    );
    if (
      !['freshdesk', 'shortcut', 'gitbook', 'pagerduty'].includes(provider.id)
    )
      assert.equal(
        provider.fields.some((field) => field.secret),
        false,
        provider.id,
      );
  }
});

test('managed native app IDs are Supahelp-owned and missing registrations fail clearly', (t) => {
  for (const [id, key] of [
    ['slack', 'SUPAHELP_SLACK_CLIENT_ID'],
    ['teams', 'SUPAHELP_TEAMS_CLIENT_ID'],
    ['salesforce', 'SUPAHELP_SALESFORCE_CLIENT_ID'],
    ['zendesk', 'SUPAHELP_ZENDESK_CLIENT_ID'],
  ]) {
    env(t, { [key]: 'public-supahelp-id' });
    assert.deepEqual(oauthApp(id), { clientId: 'public-supahelp-id' });
    delete process.env[key];
    assert.throws(() => oauthApp(id), /not configured/);
  }
});

test('confidential authorization uses the broker and a signed callback ticket without storing app credentials', async (t) => {
  const record = newRecord();
  record.values.redirectUri = 'https://127.0.0.1:49154/callback';
  let auth,
    state,
    exchanged = false;
  const broker = {
    authorize: async (id, _values, parameters) => {
      assert.equal(id, 'intercom');
      state = parameters.state;
      return 'https://app.intercom.com/oauth?state=signed-server-state';
    },
    exchange: async (id, _values, parameters) => {
      assert.equal(id, 'intercom');
      assert.equal(parameters.ticket, 'signed-code-ticket');
      assert.equal(parameters.code, 'code');
      assert.equal(parameters.client_secret, undefined);
      exchanged = true;
      return {
        access_token: 'personal-token',
        refresh_token: 'refresh',
        expires_in: 3600,
      };
    },
  };
  t.mock.method(globalThis, 'fetch', () => {
    throw Error('No direct provider exchange is allowed.');
  });
  auth = new ApiAuthorization(
    record,
    async () => {},
    async () => {
      auth.finish(
        'https://127.0.0.1:49154/callback?' +
          new URLSearchParams({
            state,
            code: 'code',
            ticket: 'signed-code-ticket',
          }),
      );
    },
    {
      authorize: 'https://app.intercom.com/oauth',
      token: 'https://api.intercom.io/auth/eagle/token',
      scopes: '',
      pkce: false,
    },
    undefined,
    undefined,
    { id: 'intercom', broker },
  );
  t.after(() => auth.close());
  await auth.connect(true);
  assert.equal(exchanged, true);
  assert.equal(record.tokens.access_token, 'personal-token');
  assert.equal(record.values.clientId, undefined);
  assert.equal(record.values.clientSecret, undefined);
});

test('OAuth broker pins its own origin, requires a Supahelp session and rejects unexpected provider hosts', async (t) => {
  const signal = new AbortController().signal;
  assert.throws(
    () =>
      new OAuthBroker(
        'https://user:password@accounts.test',
        async () => 'token',
      ),
    /HTTPS/,
  );
  const anonymous = new OAuthBroker(
    'https://accounts.test',
    async () => undefined,
  );
  await assert.rejects(
    anonymous.authorize('front', {}, {}, signal),
    /Sign in to Supahelp/,
  );
  const broker = new OAuthBroker(
    'https://accounts.test',
    async () => 'session-token',
  );
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://accounts.test/v1/oauth/front/authorize');
    assert.equal(init.headers.Authorization, 'Bearer session-token');
    assert.equal(init.redirect, 'error');
    return json({
      ok: true,
      value: { url: 'https://attacker.test/authorize' },
    });
  });
  await assert.rejects(broker.authorize('front', {}, {}, signal), /host/);
});
function env(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

test('Google and GitHub customers submit no app credentials; missing build configuration fails clearly', (t) => {
  env(t, {
    SUPAHELP_GOOGLE_CLIENT_ID: undefined,
    SUPAHELP_GITHUB_CLIENT_ID: undefined,
  });
  for (const id of ['google-drive', 'github-issues']) {
    assert.deepEqual(providerFor(id).fields, []);
    assert.deepEqual(
      connectionSetup({
        id,
        access: 'read',
        values: { clientId: 'customer', clientSecret: 'customer-secret' },
      }).values,
      {},
    );
    assert.throws(() => oauthApp(id), /not configured in this build/);
  }
});

test('Google uses the Supahelp desktop app with PKCE and keeps credentials out of customer records', async (t) => {
  env(t, {
    SUPAHELP_GOOGLE_CLIENT_ID: 'supahelp-google',
    SUPAHELP_GOOGLE_DESKTOP_CLIENT_SECRET: 'supahelp-google-secret',
  });
  const record = newRecord();
  record.values.redirectUri = 'https://127.0.0.1:49154/callback';
  let api;
  let saved = false;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (
      String(url) === 'https://www.googleapis.com/drive/v3/about?fields=user'
    ) {
      assert.equal(
        new Headers(init.headers).get('Authorization'),
        'Bearer google-token',
      );
      return json({ user: { displayName: 'Google user' } });
    }
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    const params = new URLSearchParams(init.body);
    assert.equal(params.get('client_id'), 'supahelp-google');
    assert.equal(params.get('client_secret'), 'supahelp-google-secret');
    assert.ok(params.get('code_verifier'));
    return json({
      access_token: 'google-token',
      refresh_token: 'google-refresh',
      expires_in: 3600,
    });
  });
  api = new ApiConnection(
    providerFor('google-drive'),
    record,
    async () => {
      saved = true;
    },
    async (href) => {
      const url = new URL(href);
      assert.equal(url.searchParams.get('client_id'), 'supahelp-google');
      assert.equal(
        url.searchParams.get('scope'),
        'https://www.googleapis.com/auth/drive.readonly',
      );
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({
        state: url.searchParams.get('state'),
        code: 'google-code',
      });
      // Use the checked pasted-return path without reserving the production port.
      api.finish(callback.href);
    },
  );
  t.after(() => api.close());
  await api.connect(true);
  assert.equal(saved, true);
  assert.deepEqual(record.values, {
    redirectUri: 'https://127.0.0.1:49154/callback',
  });
  assert.equal(record.tokens.refresh_token, 'google-refresh');
});

test('Salesforce returns to localhost, which its external client app accepts, not 127.0.0.1', async (t) => {
  env(t, { SUPAHELP_SALESFORCE_CLIENT_ID: 'supahelp-salesforce' });
  // The pasted return exercises the same state checks without taking the production port.
  t.mock.method(ConnectionReturn.prototype, 'start', async () => {});
  const record = newRecord();
  record.values.site = 'acme.my.salesforce.com';
  let api;
  let authorizeUrl;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).endsWith('/limits')) return json({});
    assert.equal(
      String(url),
      'https://acme.my.salesforce.com/services/oauth2/token',
    );
    const params = new URLSearchParams(init.body);
    assert.equal(params.get('redirect_uri'), 'http://localhost:49154/callback');
    assert.equal(params.has('client_secret'), false);
    return json({
      access_token: 'sf-token',
      refresh_token: 'sf-refresh',
      instance_url: 'https://acme.my.salesforce.com',
      expires_in: 3600,
    });
  });
  api = new ApiConnection(
    providerFor('salesforce'),
    record,
    async () => {},
    async (href) => {
      const url = new URL(href);
      authorizeUrl = url;
      const callback = new URL(url.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({
        state: url.searchParams.get('state'),
        code: 'sf-code',
      });
      api.finish(callback.href);
    },
  );
  t.after(() => api.close());
  await api.connect(true);
  assert.equal(
    authorizeUrl.searchParams.get('client_id'),
    'supahelp-salesforce',
  );
  assert.equal(
    authorizeUrl.searchParams.get('redirect_uri'),
    'http://localhost:49154/callback',
  );
  assert.equal(record.tokens.refresh_token, 'sf-refresh');
});

test('Salesforce reports a missing external client app in connection settings', async (t) => {
  env(t, { SUPAHELP_SALESFORCE_CLIENT_ID: 'supahelp-salesforce' });
  t.mock.method(ConnectionReturn.prototype, 'start', async () => {});
  const service = new Connections(
    () => ({ load: async () => undefined, save: async () => {} }),
    async (href) => {
      const authorize = new URL(href);
      const callback = new URL(authorize.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({
        state: authorize.searchParams.get('state'),
        error: 'OAUTH_EC_APP_NOT_FOUND',
        error_description: 'External client app is not installed in this org',
      });
      await service.finish('salesforce', callback.href);
    },
    () => {},
  );
  t.after(() => service.close());
  const snapshot = await service.connect({
    id: 'salesforce',
    access: 'read',
    values: { site: 'acme.my.salesforce.com' },
  });
  const connection = snapshot.connections.find(
    (item) => item.id === 'salesforce',
  );
  assert.equal(connection.state, 'error');
  assert.match(
    connection.message,
    /Supahelp External Client App is not installed/,
  );
});

test('GitHub device authorization respects pending/slow-down, saves before success and refreshes without a secret', async (t) => {
  const record = newRecord();
  const times = [];
  let saved = 0;
  let auth;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const params = new URLSearchParams(init.body);
    assert.equal(params.get('client_id'), 'supahelp-github');
    assert.equal(params.has('client_secret'), false);
    if (String(url) === endpoints.device) return json(device);
    if (params.get('grant_type') === 'refresh_token') {
      assert.equal(params.get('refresh_token'), 'refresh');
      return json({
        access_token: 'rotated',
        refresh_token: 'next-refresh',
        expires_in: 3600,
      });
    }
    assert.equal(params.get('device_code'), device.device_code);
    times.push(Date.now());
    if (times.length === 1) return json({ error: 'authorization_pending' });
    if (times.length === 2) return json({ error: 'slow_down' });
    return json({
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 3600,
    });
  });
  auth = new ApiAuthorization(
    record,
    async () => {
      saved++;
    },
    async (href) => {
      assert.equal(href, device.verification_uri);
      assert.equal(auth.verificationCode, device.user_code);
    },
    endpoints,
    { clientId: 'supahelp-github' },
  );
  t.after(() => auth.close());
  await auth.connect(true);
  assert.equal(saved, 1);
  assert.ok(times[1] - times[0] >= 990);
  assert.ok(times[2] - times[1] >= 5990);
  assert.equal(auth.verificationCode, undefined);
  record.expiresAt = 1;
  await Promise.all([auth.ready(), auth.ready()]);
  assert.equal(saved, 2);
  assert.equal(record.tokens.access_token, 'rotated');
});

test('GitHub rejects unexpected verification URLs and cancellation stops pending authorization', async (t) => {
  let opened = false;
  t.mock.method(globalThis, 'fetch', async () =>
    json({ ...device, verification_uri: 'https://attacker.test' }),
  );
  const invalid = new ApiAuthorization(
    newRecord(),
    async () => {},
    async () => {
      opened = true;
    },
    endpoints,
    { clientId: 'app' },
  );
  await assert.rejects(invalid.connect(true), /invalid sign-in response/);
  assert.equal(opened, false);
  t.mock.method(globalThis, 'fetch', async () => json(device));
  let cancelled;
  cancelled = new ApiAuthorization(
    newRecord(),
    async () => {
      throw Error('must not save');
    },
    async () => cancelled.close(),
    endpoints,
    { clientId: 'app' },
  );
  await assert.rejects(cancelled.connect(true), /abort/i);
  assert.equal(cancelled.verificationCode, undefined);
});

test('GitHub device tokens authenticate the issue MCP endpoint and keep the read-only restriction', async (t) => {
  env(t, { SUPAHELP_GITHUB_CLIENT_ID: 'supahelp-github' });
  const record = newRecord();
  let remote;
  let notified = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url === endpoints.device) return json(device);
    if (url === endpoints.token)
      return json({ access_token: 'github-token', expires_in: 3600 });
    assert.equal(url, 'https://api.githubcopilot.com/mcp/x/issues/readonly');
    assert.equal(
      new Headers(init.headers).get('Authorization'),
      'Bearer github-token',
    );
    const request = JSON.parse(init.body);
    if (request.method === 'initialize')
      return json({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'fixture', version: '1' },
        },
      });
    if (request.method === 'tools/list')
      return json({ jsonrpc: '2.0', id: request.id, result: { tools: [] } });
    return new Response(null, { status: 202 });
  });
  remote = new McpConnection(
    providerFor('github-issues'),
    record,
    async () => {},
    async () => {
      assert.equal(remote.verificationCode, device.user_code);
    },
    () => {
      notified++;
    },
  );
  t.after(() => remote.close());
  await remote.connect(true);
  assert.deepEqual(await remote.listTools(), []);
  assert.equal(notified, 2);
  assert.equal(record.values.key, undefined);
});

test('device progress exposes only the user code while connecting', async () => {
  let publish;
  const service = new Connections(
    () => ({ load: async () => undefined, save: async () => {} }),
    async () => {},
    () => {},
    (_provider, _record, _save, _open, notify) => ({
      verificationCode: device.user_code,
      connect: async () => {
        notify();
        publish = service.snapshot();
      },
      listTools: async () => [],
      callTool: async () => {},
      finish() {},
      close: async () => {},
    }),
  );
  try {
    await service.connect({ id: 'github-issues', access: 'read', values: {} });
    const pending = publish.connections.find(
      (item) => item.id === 'github-issues',
    );
    assert.equal(pending.verificationCode, device.user_code);
    assert.doesNotMatch(JSON.stringify(publish), /private-device-code/);
    assert.equal(
      service.snapshot().connections.find((item) => item.id === 'github-issues')
        .verificationCode,
      undefined,
    );
  } finally {
    await service.close();
  }
});

test('Drive writes upload Google Docs as multipart and plain-text media', async (t) => {
  env(t, { SUPAHELP_GOOGLE_CLIENT_ID: 'supahelp-google' });
  const record = {
    access: 'write',
    values: {},
    actions: [],
    tokens: { access_token: 'google-token' },
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), init });
    return json({ id: 'doc-1' });
  });
  const api = new ApiConnection(
    providerFor('google-drive'),
    record,
    async () => {},
    async () => {},
  );
  await api.callTool('create_google_doc', { name: 'Fix', text: 'Step 1' });
  await api.callTool('replace_google_doc_text', { id: 'doc-1', text: 'v2' });
  const [create, replace] = calls;
  assert.match(
    create.url,
    /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=multipart/,
  );
  const type = new Headers(create.init.headers).get('Content-Type');
  const boundary = type.match(/^multipart\/related; boundary=(.+)$/)[1];
  assert.match(create.init.body, new RegExp(`--${boundary}--$`));
  assert.ok(
    create.init.body.includes(
      '"mimeType":"application/vnd.google-apps.document"',
    ),
  );
  assert.ok(create.init.body.includes('\r\n\r\nStep 1\r\n'));
  assert.equal(replace.init.method, 'PATCH');
  assert.match(
    replace.url,
    /\/upload\/drive\/v3\/files\/doc-1\?uploadType=media/,
  );
  assert.equal(replace.init.body, 'v2');
  assert.equal(
    new Headers(replace.init.headers).get('Content-Type'),
    'text/plain; charset=UTF-8',
  );
});

test('provider failures show the provider’s own error, not a generic message', async (t) => {
  env(t, { SUPAHELP_GOOGLE_CLIENT_ID: 'supahelp-google' });
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          error: {
            status: 'PERMISSION_DENIED',
            message: 'Google Drive API has not been used in project 1.',
          },
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  const api = new ApiConnection(
    providerFor('google-drive'),
    {
      access: 'read',
      values: {},
      actions: [],
      tokens: { access_token: 'google-token' },
    },
    async () => {},
    async () => {},
  );
  await assert.rejects(
    api.callTool('read_file', { id: 'f1' }),
    /HTTP 403\): PERMISSION_DENIED: Google Drive API has not been used/,
  );
});
