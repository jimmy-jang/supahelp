import { PlaybookService } from '../../src/main/features/playbooks/service.ts';
import { playbookAgent } from '../../src/main/features/playbooks/agent.ts';
// Synthetic API-key metadata only: never use a subscription in automated checks.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { LinearConnector } from '../../src/main/features/linear/service.ts';
import { LinearRemote } from '../../src/main/integrations/linear.ts';
import { connectorAgent } from '../../src/main/integrations/connector-agent.ts';
import { CodexRpc } from '../../src/main/integrations/codex.ts';
import {
  claudeOptions,
  claudeEnvironment,
} from '../../src/main/integrations/claude-code.ts';
import { linearFixture } from '../support/linear-server.mjs';
import { zendeskFixture } from '../support/zendesk-server.mjs';
import { ZendeskConnector } from '../../src/main/features/zendesk/service.ts';
import { ZendeskRemote } from '../../src/main/integrations/zendesk.ts';
import { Connections } from '../../src/main/features/connections/service.ts';
import { CaseStore } from '../../src/main/features/cases/store.ts';
import { CaseService } from '../../src/main/features/cases/service.ts';
import { caseAgent } from '../../src/main/features/cases/agent.ts';
import {
  caseEnvironment,
  caseOperation,
} from '../support/case-environment.mjs';

process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const directory = await mkdtemp(join(tmpdir(), 'linear-runtimes-'));
const fixture = await linearFixture();
const zendeskServer = await zendeskFixture();
let zendeskSaved;
const zendesk = new ZendeskConnector(
  {
    load: async () => zendeskSaved,
    save: async (value) => {
      zendeskSaved = structuredClone(value);
    },
  },
  (url) => zendeskServer.authorize(url),
  () => {},
  (record, save, open) =>
    new ZendeskRemote(record, save, open, zendeskServer.origin, 0),
  'public-client',
);
let saved;
const connector = new LinearConnector(
  {
    load: async () => saved,
    save: async (value) => {
      saved = structuredClone(value);
    },
  },
  (url) => fixture.authorize(url),
  () => {},
  (record, save, open) =>
    new LinearRemote(record, save, open, fixture.endpoint),
);
let bridge;
let zendeskBridge;
let catalogBridge;
let caseBridge, cases, playbookBridge;
const catalogRecords = new Map();
const catalog = new Connections(
  (id) => ({
    load: async () => catalogRecords.get(id),
    save: async (record) => catalogRecords.set(id, structuredClone(record)),
  }),
  async () => {},
  () => {},
);
let rpc;
let claude;
const input = Promise.withResolvers();
const deadline = setTimeout(() => {
  console.error('Native Linear discovery timed out');
  process.exit(1);
}, 45000);
try {
  cases = new CaseService(
    new CaseStore(join(directory, 'cases.db')),
    () => {},
    caseEnvironment().environment,
  );
  const caseOp = caseOperation();
  await cases.create(
    { id: 'runtime-chat', title: 'Controlled case', messages: [] },
    caseOp,
  );
  const books = new PlaybookService(cases, cases.store.books, () => {});
  const draft = await books.save(
    undefined,
    0,
    { title: 'Controlled Playbook', markdown: 'Safe retry checks' },
    caseOp,
  );
  books.publish(draft.id, draft.version, caseOp);
  playbookBridge = await connectorAgent(
    'supahelp-playbooks',
    playbookAgent(books, [draft.id], caseOp),
  );
  caseBridge = await connectorAgent(
    'supahelp-case',
    caseAgent(cases, 'runtime-chat', caseOp),
  );
  assert.equal((await connector.connect('read')).state, 'connected');
  bridge = await connectorAgent(
    'linear',
    await connector.agent('runtime-check'),
  );
  assert.equal(
    (
      await zendesk.connect({
        site: 'acme',
        clientId: 'public-client',
        access: 'read',
      })
    ).state,
    'connected',
  );
  zendeskBridge = await connectorAgent(
    'zendesk',
    await zendesk.agent('runtime-check'),
  );
  await catalog.connect({
    id: 'custom-api',
    access: 'read',
    values: {
      endpoint: 'http://127.0.0.1:1',
      header: 'Authorization',
      key: 'Bearer controlled-not-a-provider-token',
      operations: JSON.stringify([
        {
          name: 'lookup_record',
          description: 'Read a controlled record',
          method: 'GET',
          path: '/record',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          readOnly: true,
        },
      ]),
    },
  });
  const [entry] = await catalog.agents('runtime-check');
  catalogBridge = await connectorAgent(entry.name, entry.agent);
  rpc = new CodexRpc(
    process.env.LINEAR_TEST_CODEX ?? join(homedir(), '.npm-global/bin/codex'),
    directory,
    [bridge, zendeskBridge, catalogBridge, caseBridge, playbookBridge],
    'synthetic-api-key-for-runtime-metadata',
  );
  await rpc.start();
  const status = await rpc.request('mcpServerStatus/list', {});
  const linear = status.data.find((item) => item.name === 'linear');
  assert.ok(linear, 'Codex discovers the app-scoped Linear server');
  assert.ok(
    Object.keys(linear.tools).some((name) => name.includes('get_issue')),
    'Codex sees the Linear read tool',
  );
  assert.ok(
    Object.keys(status.data.find((item) => item.name === 'zendesk').tools).some(
      (name) => name.includes('get_ticket'),
    ),
    'Codex discovers Zendesk alongside Linear',
  );
  console.log('Codex: native configuration and MCP tool discovery passed');
  assert.ok(
    Object.keys(
      status.data.find((item) => item.name === 'supahelp-case').tools,
    ).some((name) => name.includes('read_case')),
    'Codex discovers the case tool alongside connector tools',
  );
  assert.ok(
    Object.keys(
      status.data.find((item) => item.name === 'supahelp-playbooks').tools,
    ).some((name) => name.includes('read_playbook')),
    'Codex discovers the read-only Playbook tool',
  );
  assert.ok(
    Object.keys(
      status.data.find((item) => item.name === 'custom_api').tools,
    ).some((name) => name.includes('lookup_record')),
    'Codex discovers catalog capabilities',
  );
  const options = claudeOptions(
    process.env.LINEAR_TEST_CLAUDE ?? join(homedir(), '.local/bin/claude'),
    directory,
    {
      ...claudeEnvironment(
        process.env,
        'synthetic-api-key-for-runtime-metadata',
      ),
      CLAUDE_CONFIG_DIR: join(directory, 'claude-api-config'),
    },
    'sonnet',
    new AbortController(),
    [bridge, zendeskBridge, catalogBridge, caseBridge, playbookBridge],
  );
  claude = query({
    prompt: (async function* () {
      yield* await input.promise;
    })(),
    options,
  });
  let servers = [];
  for (let i = 0; i < 100; i++) {
    servers = await claude.mcpServerStatus();
    if (
      [
        'linear',
        'zendesk',
        'custom_api',
        'supahelp-case',
        'supahelp-playbooks',
      ].every((name) =>
        servers.some(
          (server) => server.name === name && server.status === 'connected',
        ),
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(
    'Claude server statuses:',
    servers.map((server) => ({ name: server.name, status: server.status })),
  );
  assert.ok(
    [
      'linear',
      'zendesk',
      'custom_api',
      'supahelp-case',
      'supahelp-playbooks',
    ].every((name) =>
      servers.some(
        (server) => server.name === name && server.status === 'connected',
      ),
    ),
    'Claude connects to the app-scoped Linear server',
  );
  console.log('Claude: native configuration and MCP connection passed');
} finally {
  clearTimeout(deadline);
  catalogBridge?.close();
  caseBridge?.close();
  playbookBridge?.close();
  cases?.close();
  await catalog.close();
  input.resolve([]);
  claude?.close();
  rpc?.close();
  bridge?.close();
  zendeskBridge?.close();
  await connector.close();
  await zendesk.close();
  await fixture.close();
  await zendeskServer.close();
  await rm(directory, { recursive: true, force: true });
}
