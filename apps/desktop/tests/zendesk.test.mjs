import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  zendeskSite,
  zendeskTools,
  ZendeskRemote,
} from '../src/main/integrations/zendesk.ts';

test('Zendesk accepts only a canonical tenant and cannot send credentials to arbitrary hosts', () => {
  assert.equal(zendeskSite('acme'), 'https://acme.zendesk.com');
  assert.equal(
    zendeskSite('https://acme.zendesk.com/'),
    'https://acme.zendesk.com',
  );
  for (const value of [
    'http://acme.zendesk.com',
    'https://evil.test',
    'https://acme.zendesk.com.evil.test',
    'https://a@acme.zendesk.com',
    'https://acme.zendesk.com/path',
    'https://acme.zendesk.com:8443',
    'localhost',
  ])
    assert.throws(() => zendeskSite(value), /Zendesk/);
});

test('Zendesk read-only grants do not expose replies, notes or ticket changes', () => {
  assert.deepEqual(
    zendeskTools(['tickets:read', 'users:read']).map((tool) => tool.name),
    [
      'search_tickets',
      'get_ticket',
      'list_comments',
      'search_customers',
      'get_customer',
    ],
  );
  assert.ok(
    !zendeskTools(['tickets:read']).some(
      (tool) => tool.name === 'search_customers',
    ),
  );
  assert.ok(
    zendeskTools(['tickets:read', 'tickets:write']).some(
      (tool) => tool.name === 'reply_to_ticket',
    ),
  );
  const tool = zendeskTools(['read', 'write']).find(
    (tool) => tool.name === 'update_ticket',
  );
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.deepEqual(tool.inputSchema.required, [
    'ticket_id',
    'status',
    'updated_stamp',
  ]);
});

test('Zendesk rejects credential-bearing input and exposes no generic HTTP operation', async () => {
  const remote = new ZendeskRemote(
    {
      access: 'read',
      actions: [],
      site: 'https://acme.zendesk.com',
      clientId: 'public-client',
      callbackPort: 49153,
    },
    async () => {},
    async () => {},
  );
  await assert.rejects(
    remote.callTool('http_request', { url: 'https://evil.test' }),
    /available|connect/i,
  );
});

test('Zendesk customer lookup reads matching end users and omits unrelated user fields', async (t) => {
  const customer = {
    id: 123,
    name: 'Fixture Customer',
    email: 'fixture@example.test',
    role: 'end-user',
    notes: 'Private note',
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.method ?? 'GET', 'GET');
    if (url.pathname === '/api/v2/users/search') {
      assert.equal(url.searchParams.get('query'), 'Fixture Customer');
      return Response.json({
        users: [customer, { id: 124, role: 'agent' }],
        next_page: null,
      });
    }
    assert.equal(url.pathname, '/api/v2/users/123');
    return Response.json({ user: customer });
  });
  const remote = new ZendeskRemote(
    {
      access: 'read',
      actions: [],
      site: 'https://acme.zendesk.com',
      tokens: {
        access_token: 'fixture-token',
        token_type: 'Bearer',
        scope: 'tickets:read users:read',
      },
    },
    async () => {},
    async () => {},
  );
  const lookup = async (name, args) =>
    JSON.parse((await remote.callTool(name, args)).content[0].text);
  const match = {
    id: 123,
    name: 'Fixture Customer',
    email: 'fixture@example.test',
    url: 'https://acme.zendesk.com/agent/users/123',
  };
  assert.deepEqual(
    await lookup('search_customers', { query: 'Fixture Customer' }),
    { customers: [match], has_more: false, page: 1 },
  );
  assert.deepEqual(await lookup('get_customer', { customer_id: 123 }), match);
});
