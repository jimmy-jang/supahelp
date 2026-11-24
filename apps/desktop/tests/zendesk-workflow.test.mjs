import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZendeskConnector } from '../src/main/features/zendesk/service.ts';
import { ZendeskRemote } from '../src/main/integrations/zendesk.ts';
import { zendeskFixture } from './support/zendesk-server.mjs';
import { registerZendeskIpc } from '../src/main/features/zendesk/ipc.ts';

async function setup(t, access = 'write') {
  const fixture = await zendeskFixture();
  let saved;
  const store = {
    load: async () => saved,
    save: async (value) => {
      saved = structuredClone(value);
    },
  };
  const connector = new ZendeskConnector(
    store,
    (url) => fixture.authorize(url),
    () => {},
    (record, save, open) =>
      new ZendeskRemote(record, save, open, fixture.origin, 0),
    'public-client',
  );
  t.after(async () => {
    await connector.close();
    await fixture.close();
  });
  const status = await connector.connect({
    site: 'acme',
    access,
  });
  assert.equal(status.state, 'connected', status.message);
  return {
    connector,
    fixture,
    store,
    agent: await connector.agent('chat-zendesk'),
  };
}
async function proposed(connector) {
  for (let i = 0; i < 100; i++) {
    const action = connector
      .snapshot()
      .actions.find((action) => action.status === 'pending');
    if (action) return action;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error('Approval was not published.');
}
test('Resolve notes retain source authority and cannot be repeated with changed body after verification', async (t) => {
  const { connector, fixture } = await setup(t);
  const agent = await connector.agent('resolve-chat', {
    caseId: 'case-a',
    resolutionId: 'resolve-a',
  });
  const read = JSON.parse(
    (await agent.call('get_ticket', { ticket_id: 123 })).content[0].text,
  );
  const pending = agent.call('add_internal_note', {
    ticket_id: 123,
    body: 'What fixed it: retry guard',
    updated_stamp: read.updated_at,
  });
  const receipt = await proposed(connector);
  assert.deepEqual(receipt.source, {
    caseId: 'case-a',
    resolutionId: 'resolve-a',
  });
  assert.equal(fixture.writes.length, 0);
  await connector.decide(receipt.id, 'approve');
  await pending;
  assert.equal(connector.snapshot().actions[0].status, 'verified');
  await assert.rejects(
    agent.call('add_internal_note', {
      ticket_id: 123,
      body: 'Different retry text',
      updated_stamp: read.updated_at,
    }),
    /already exists/,
  );
  assert.equal(fixture.writes.length, 1);
});

test('an uncertain Resolve note requires the existing explicit reconciliation before a new proposal', async (t) => {
  const { connector, fixture } = await setup(t),
    agent = await connector.agent('resolve-chat', {
      caseId: 'case-b',
      resolutionId: 'resolve-b',
    });
  const ticket = JSON.parse(
    (await agent.call('get_ticket', { ticket_id: 123 })).content[0].text,
  );
  fixture.failures.set('/api/v2/tickets/123/audits/1.json', 503);
  const sent = agent.call('add_internal_note', {
    ticket_id: 123,
    body: 'What fixed it',
    updated_stamp: ticket.updated_at,
  });
  const first = await proposed(connector);
  await connector.decide(first.id, 'approve');
  await sent;
  assert.equal(connector.snapshot().actions[0].status, 'unknown');
  await assert.rejects(
    agent.call('add_internal_note', {
      ticket_id: 123,
      body: 'Changed body',
      updated_stamp: fixture.ticket.updated_at,
    }),
    /already exists/,
  );
  await connector.decide(first.id, 'checked');
  const retried = agent
    .call('add_internal_note', {
      ticket_id: 123,
      body: 'Changed body',
      updated_stamp: fixture.ticket.updated_at,
    })
    .catch((error) => error);
  const next = await proposed(connector);
  assert.notEqual(next.id, first.id);
  await connector.decide(next.id, 'deny');
  await retried;
  assert.equal(fixture.writes.length, 1);
});
test('Zendesk setup reads identity and grants, then sends and independently verifies an approved public reply', async (t) => {
  const { connector, fixture, agent, store } = await setup(t);
  assert.equal(connector.snapshot().account, 'Test Agent');
  assert.deepEqual(connector.snapshot().scopes, [
    'tickets:read',
    'users:read',
    'tickets:write',
  ]);
  assert.doesNotMatch(
    JSON.stringify(connector.snapshot()),
    /zendesk-fixture-access|zendesk-fixture-refresh/,
  );
  const read = await agent.call('get_ticket', { ticket_id: 123 });
  const ticket = JSON.parse(read.content[0].text);
  const write = agent.call('reply_to_ticket', {
    ticket_id: 123,
    body: 'We are investigating checkout.',
    updated_stamp: ticket.updated_at,
  });
  const action = await proposed(connector);
  assert.equal(fixture.writes.length, 0);
  assert.equal(action.arguments.body, 'We are investigating checkout.');
  await connector.decide(action.id, 'approve');
  await write;
  assert.deepEqual(fixture.comments, [
    { id: 1, body: 'We are investigating checkout.', public: true },
  ]);
  assert.equal((await store.load()).actions[0].status, 'verified');
  assert.ok(
    fixture.requests.some(
      (request) => request.path === '/api/v2/tickets/123/audits/1.json',
    ),
  );
  await connector.disconnect();
  assert.equal((await store.load()).tokens, undefined);
  await assert.rejects(
    agent.call('get_ticket', { ticket_id: 123 }),
    /disconnected/,
  );
});
test('Zendesk internal notes remain private and status changes are read back', async (t) => {
  const { connector, fixture, agent } = await setup(t);
  const note = agent.call('add_internal_note', {
    ticket_id: 123,
    body: 'Internal evidence',
    updated_stamp: fixture.ticket.updated_at,
  });
  await connector.decide((await proposed(connector)).id, 'approve');
  await note;
  assert.equal(fixture.comments[0].public, false);
  fixture.comments[0].attachments = [
    { content_url: 'https://example.invalid/signed-private-attachment' },
  ];
  const comments = await agent.call('list_comments', { ticket_id: 123 });
  assert.equal(JSON.parse(comments.content[0].text).comments[0].public, false);
  assert.doesNotMatch(comments.content[0].text, /signed-private-attachment/);
  const status = agent.call('update_ticket', {
    ticket_id: 123,
    status: 'pending',
    updated_stamp: fixture.ticket.updated_at,
  });
  await connector.decide((await proposed(connector)).id, 'approve');
  await status;
  assert.equal(fixture.ticket.status, 'pending');
  assert.equal(connector.snapshot().actions[0].status, 'verified');
});
test('Zendesk read-only authorization cannot write and rejects invalid tool inputs', async (t) => {
  const { connector, fixture, agent } = await setup(t, 'read');
  assert.equal(connector.snapshot().access, 'read');
  assert.ok(agent.tools.some((tool) => tool.name === 'search_customers'));
  assert.ok(agent.tools.every((tool) => tool.annotations.readOnlyHint));
  await assert.rejects(
    agent.call('reply_to_ticket', { ticket_id: 123, body: 'No' }),
    /available/,
  );
  await assert.rejects(
    agent.call('get_ticket', { ticket_id: '../users' }),
    /inputs/,
  );
  await assert.rejects(
    agent.call('get_customer', { customer_id: '../users' }),
    /inputs/,
  );
  assert.equal(fixture.writes.length, 0);
});
test('revoked Zendesk authorization marks the connection for sign-in and invalidates existing agents', async (t) => {
  const { connector, fixture, agent } = await setup(t);
  fixture.failures.set('/api/v2/tickets/123.json', 401);
  await assert.rejects(
    agent.call('get_ticket', { ticket_id: 123 }),
    /Reconnect/,
  );
  assert.equal(connector.snapshot().state, 'error');
  assert.deepEqual(connector.snapshot().tools, []);
  assert.match(connector.snapshot().message, /sign in again/i);
  await assert.rejects(
    agent.call('get_ticket', { ticket_id: 123 }),
    /disconnected/,
  );
});
test('a transient Zendesk API failure preserves the authorized connection', async (t) => {
  const { connector, fixture, agent } = await setup(t);
  fixture.failures.set('/api/v2/tickets/123.json', 503);
  await assert.rejects(
    agent.call('get_ticket', { ticket_id: 123 }),
    /complete/,
  );
  assert.equal(connector.snapshot().state, 'connected');
  fixture.failures.clear();
  await agent.call('get_ticket', { ticket_id: 123 });
});
for (const status of [401, 503]) {
  test(`an accepted reply with a failed audit check (${status}) cannot be repeated without checking its outcome`, async (t) => {
    const { connector, fixture, agent } = await setup(t);
    fixture.failures.set('/api/v2/tickets/123/audits/1.json', status);
    const args = {
      ticket_id: 123,
      body: 'Only one customer reply',
      updated_stamp: fixture.ticket.updated_at,
    };
    const write = agent.call('reply_to_ticket', args);
    await connector.decide((await proposed(connector)).id, 'approve');
    await write;
    assert.equal(fixture.comments.length, 1);
    assert.equal(connector.snapshot().actions[0].status, 'unknown');
    assert.equal(
      connector.snapshot().state,
      status === 401 ? 'error' : 'connected',
    );
    fixture.failures.clear();
    let currentAgent = agent;
    if (status === 401) {
      await connector.connect({
        site: 'acme',
        access: 'write',
      });
      currentAgent = await connector.agent('chat-after-reconnect');
    }
    await assert.rejects(
      currentAgent.call('reply_to_ticket', {
        ...args,
        updated_stamp: fixture.ticket.updated_at,
      }),
      /uncertain/,
    );
    assert.equal(fixture.writes.length, 1);
  });
}
test('Zendesk concurrent edits and uncertain replies cannot be silently retried with a fresh version stamp', async (t) => {
  const { connector, fixture, agent } = await setup(t);
  const write = agent.call('reply_to_ticket', {
    ticket_id: 123,
    body: 'Only once',
    updated_stamp: fixture.ticket.updated_at,
  });
  const failure = assert.rejects(write, /ticket changed/);
  const action = await proposed(connector);
  fixture.ticket.updated_at = '2026-11-07T00:01:00Z';
  await connector.decide(action.id, 'approve');
  await failure;
  assert.equal(connector.snapshot().actions[0].status, 'unknown');
  await assert.rejects(
    agent.call('reply_to_ticket', {
      ticket_id: 123,
      body: 'Only once',
      updated_stamp: fixture.ticket.updated_at,
    }),
    /uncertain/,
  );
  assert.equal(fixture.writes.length, 0);
});
test('Zendesk rotates expiring tokens before API requests without exposing them', async (t) => {
  const fixture = await zendeskFixture();
  const record = {
    site: 'https://acme.zendesk.com',
    clientId: 'public-client',
    access: 'read',
    actions: [],
  };
  const remote = new ZendeskRemote(
    record,
    async () => {},
    (url) => fixture.authorize(url),
    fixture.origin,
    0,
  );
  t.after(async () => {
    await remote.close();
    await fixture.close();
  });
  await remote.connect(true);
  record.expiresAt = 1;
  const result = await remote.callTool('get_ticket', { ticket_id: 123 });
  assert.equal(record.tokens.access_token, 'zendesk-fixture-access-1');
  assert.doesNotMatch(JSON.stringify(result), /zendesk-fixture-access/);
  assert.equal(
    fixture.requests.filter(
      (request) => request.body?.grant_type === 'refresh_token',
    ).length,
    1,
  );
});
test('Zendesk IPC rejects untrusted frames, arbitrary hosts, secrets and malformed decisions', async (t) => {
  const { connector } = await setup(t, 'read');
  const handlers = new Map();
  const frame = {};
  const contents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  const event = { sender: contents, senderFrame: frame };
  registerZendeskIpc(
    { handle: (name, run) => handlers.set(name, run) },
    () => ({ webContents: contents }),
    'file:///app/index.html',
    connector,
    { refreshTools() {} },
  );
  assert.equal(
    (await handlers.get('zendesk:status')({ ...event, senderFrame: {} })).ok,
    false,
  );
  assert.equal(
    (
      await handlers.get('zendesk:connect')(event, {
        site: 'acme',
        clientId: 'public-client',
        access: 'read',
        accessToken: 'do-not-accept',
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await handlers.get('zendesk:connect')(event, {
        site: 'https://evil.test',
        access: 'read',
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await handlers.get('zendesk:decide')(event, {
        id: 'missing',
        decision: 'yes',
      })
    ).ok,
    false,
  );
});
