import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LinearRemote } from '../src/main/integrations/linear.ts';
import { ConnectionStore } from '../src/main/platform/connection-store.ts';
import { LinearConnector } from '../src/main/features/linear/service.ts';
import { connectorAgent } from '../src/main/integrations/connector-agent.ts';
import { linearFixture } from './support/linear-server.mjs';

test('browser OAuth with PKCE, encrypted persistence and an agent MCP call complete end to end', async (t) => {
  const fixture = await linearFixture();
  const directory = await mkdtemp(join(tmpdir(), 'supahelp-linear-'));
  t.after(async () => {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  });
  const key = randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        value.subarray(0, 12),
      );
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([
        decipher.update(value.subarray(28)),
        decipher.final(),
      ]).toString();
    },
  };
  const file = join(directory, 'linear.enc');
  const store = new ConnectionStore(file, encryption);
  const connector = new LinearConnector(
    store,
    (url) => fixture.authorize(url),
    () => {},
    (record, save, open) =>
      new LinearRemote(record, save, open, fixture.endpoint),
  );
  t.after(() => connector.close());
  const status = await connector.connect('write');
  assert.equal(status.state, 'connected', status.message);
  assert.equal(status.tools.length, 2);
  assert.doesNotMatch(
    JSON.stringify(status),
    /fixture-access-secret|fixture-refresh-secret/,
  );
  assert.equal(
    (await readFile(file)).includes(Buffer.from('fixture-access-secret')),
    false,
  );
  const bridge = await connectorAgent(
    'linear',
    await connector.agent('chat-e2e'),
  );
  t.after(() => bridge.close());
  assert.equal((await fetch(bridge.url)).status, 403);
  assert.equal(
    (
      await fetch(bridge.url, {
        headers: {
          Authorization: `Bearer ${bridge.token}`,
          Origin: 'https://malicious.example',
        },
      })
    ).status,
    403,
  );
  const agent = new Client({ name: 'test-agent', version: '1.0.0' });
  await agent.connect(
    new StreamableHTTPClientTransport(new URL(bridge.url), {
      requestInit: { headers: { Authorization: `Bearer ${bridge.token}` } },
    }),
  );
  t.after(() => agent.close());
  assert.equal((await agent.listTools()).tools.length, 2);
  const result = await agent.callTool({
    name: 'get_issue',
    arguments: { id: 'SUP-1' },
  });
  assert.match(result.content[0].text, /Checkout fails/);
  const writing = agent.callTool({
    name: 'create_issue',
    arguments: { title: 'Fix checkout' },
  });
  while (!connector.snapshot().actions.length)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fixture.mutations.length, 0);
  await connector.decide(connector.snapshot().actions[0].id, 'approve');
  assert.equal((await writing).isError, undefined);
  assert.deepEqual(fixture.mutations, [{ title: 'Fix checkout' }]);
  assert.equal(connector.snapshot().actions[0].status, 'verified');
  await connector.disconnect();
  assert.equal((await store.load()).tokens, undefined);
  const denied = await agent.callTool({
    name: 'get_issue',
    arguments: { id: 'SUP-1' },
  });
  assert.equal(denied.isError, true);
});
