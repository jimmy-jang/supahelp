import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZendeskRemote } from '../src/main/integrations/zendesk.ts';
import { zendeskFixture } from './support/zendesk-server.mjs';

test('concurrent Zendesk reads wait until rotated credentials are persisted', async (t) => {
  const fixture = await zendeskFixture();
  const record = {
    site: 'https://acme.zendesk.com',
    clientId: 'public-client',
    access: 'read',
    actions: [],
  };
  const persisted = Promise.withResolvers();
  const remote = new ZendeskRemote(
    record,
    async () => {
      if (record.tokens?.access_token === 'zendesk-fixture-access-1')
        await persisted.promise;
    },
    (url) => fixture.authorize(url),
    fixture.origin,
    0,
  );
  t.after(async () => {
    persisted.resolve();
    await remote.close();
    await fixture.close();
  });
  await remote.connect(true);
  record.expiresAt = 1;
  const first = remote.callTool('get_ticket', { ticket_id: 123 });
  while (record.tokens.access_token !== 'zendesk-fixture-access-1')
    await new Promise((resolve) => setTimeout(resolve, 5));
  const second = remote.callTool('get_ticket', { ticket_id: 123 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    fixture.requests.filter(
      (request) => request.path === '/api/v2/tickets/123.json',
    ).length,
    0,
  );
  persisted.resolve();
  await Promise.all([first, second]);
  assert.equal(
    fixture.requests.filter(
      (request) => request.body?.grant_type === 'refresh_token',
    ).length,
    1,
  );
});
