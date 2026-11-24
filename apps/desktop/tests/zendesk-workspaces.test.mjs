import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZendeskConnector } from '../src/main/features/zendesk/service.ts';
import { ZendeskRemote } from '../src/main/integrations/zendesk.ts';
import { zendeskFixture } from './support/zendesk-server.mjs';

test('Zendesk receipts retain the exact workspace when switching authorized tenants', async (t) => {
  const first = await zendeskFixture();
  const second = await zendeskFixture();
  const connector = new ZendeskConnector(
    { load: async () => undefined, save: async () => {} },
    (address) =>
      new URL(address).origin === first.origin
        ? first.authorize(address)
        : second.authorize(address),
    () => {},
    (record, save, open) =>
      new ZendeskRemote(
        record,
        save,
        open,
        record.site.includes('acme.') ? first.origin : second.origin,
        0,
      ),
    'public-client',
  );
  t.after(async () => {
    await connector.close();
    await first.close();
    await second.close();
  });
  await connector.connect({
    site: 'acme',
    access: 'write',
  });
  const oldAgent = await connector.agent('chat-old');
  const pending = oldAgent.call('reply_to_ticket', {
    ticket_id: 123,
    body: 'Account-specific reply',
    updated_stamp: first.ticket.updated_at,
  });
  const cancelled = assert.rejects(pending, /disconnected|cancelled/);
  while (!connector.snapshot().actions.length)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await connector.disconnect();
  await cancelled;
  await connector.connect({
    site: 'second-team',
    access: 'write',
  });
  assert.equal(
    connector.snapshot().actions[0].scope,
    'https://acme.zendesk.com',
  );
  assert.match(
    connector.snapshot().actions[0].account,
    /acme.zendesk.com.*Test Agent/,
  );
  await assert.rejects(
    oldAgent.call('get_ticket', { ticket_id: 123 }),
    /disconnected/,
  );
  assert.equal(connector.snapshot().site, 'https://second-team.zendesk.com');
  assert.equal(first.writes.length + second.writes.length, 0);
});
