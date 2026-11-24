import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CaseStore } from '../src/main/features/cases/store.ts';
import { CaseService } from '../src/main/features/cases/service.ts';
import { ChatModels } from '../src/main/features/chat/models.ts';
import { ChatService } from '../src/main/features/chat/service.ts';
import { caseEnvironment, caseOperation } from './support/case-environment.mjs';

async function idle(chats, id) {
  for (let i = 0; i < 200; i++) {
    if (
      chats.snapshot().chats.find((chat) => chat.id === id)?.status === 'idle'
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error('Case chat did not settle');
}
async function setup(t, createViaChat = false, { attach = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'supahelp-case-chat-')),
    state = caseEnvironment();
  const bridges = [],
    prompts = [],
    updates = [];
  let models, chats;
  const cases = new CaseService(
    new CaseStore(join(home, 'cases.db')),
    () => {},
    state.environment,
  );
  const claude = {
    status: async () => ({ state: 'ready', model: 'fixture-model' }),
    models: async () => [{ value: 'fixture-model', displayName: 'Fixture' }],
    open(_model, _options, connections = []) {
      const bridge = connections.find(
        (connection) => connection.name === 'supahelp-case',
      );
      if (bridge) bridges.push(bridge);
      return {
        provider: 'claude',
        close() {},
        async *reply(prompt) {
          prompts.push(prompt);
          yield { type: 'model', model: 'fixture-model' };
          if (!bridge) {
            yield { type: 'text', text: 'Ready to investigate.' };
            return;
          }
          const client = new Client({
            name: 'fixture-case-agent',
            version: '1',
          });
          try {
            await client.connect(
              new StreamableHTTPClientTransport(new URL(bridge.url), {
                requestInit: {
                  headers: { Authorization: `Bearer ${bridge.token}` },
                },
              }),
            );
            if (prompt.includes('Create a case')) {
              const created = await client.callTool({
                name: 'create_case',
                arguments: { title: 'Duplicate invoices after HTTP 409' },
              });
              assert.equal(created.isError, undefined);
            }
            await client.callTool({ name: 'read_case', arguments: {} });
            const result = await client.callTool({
              name: 'add_entry',
              arguments: {
                section: 'findings',
                kind: 'item',
                text: 'Alex Example alex@example.test: two invoices',
                pill: 'Confirmed',
                detail: 'Stripe in_1',
              },
            });
            if (!result.isError) {
              const update = JSON.parse(result.content[0].text);
              updates.push(update);
              chats.caseUpdated(
                chats.snapshot().chats.find((chat) => chat.status === 'running')
                  .id,
                update,
              );
            }
            yield {
              type: 'text',
              text: result.isError ? 'Nothing saved.' : 'Recorded the finding.',
            };
          } finally {
            await client.close();
          }
        },
      };
    },
  };
  models = new ChatModels(
    join(home, 'models.json'),
    claude,
    { status: async () => ({ id: 'chatgpt', state: 'missing' }), close() {} },
    undefined,
    undefined,
    undefined,
    {
      generation: () => state.environment.context().generation,
      canUse: async () => true,
    },
    cases,
    (id, update) => chats.caseUpdated(id, update),
  );
  chats = new ChatService(models, () => {});
  t.after(async () => {
    models.close();
    await chats.close();
    cases.close();
    await rm(home, { recursive: true, force: true });
  });
  const id = chats.send({
    text: createViaChat
      ? 'Create a case for duplicate invoices after HTTP 409'
      : 'Ticket #123',
    options: { selection: { provider: 'claude', model: 'fixture-model' } },
  });
  await idle(chats, id);
  const caseId =
    createViaChat || !attach
      ? cases.caseForChat(id)
      : await cases.create(chats.snapshot().chats[0], caseOperation());
  if (attach) chats.refreshTools(id);
  return {
    cases,
    chats,
    id,
    caseId,
    bridges,
    prompts,
    updates,
  };
}

test('real MCP case writes append one committed line, preserve streaming and rotate ended capabilities', async (t) => {
  const s = await setup(t);
  s.chats.send({ chatId: s.id, text: 'Add the finding' });
  await idle(s.chats, s.id);
  let chat = s.chats.snapshot().chats[0];
  assert.equal(chat.error, undefined);
  const lines = chat.messages.filter((message) => message.role === 'case');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].changeId, s.updates[0].changeId);
  assert.equal(
    s.cases.snapshot().cases[0].entries[0].text,
    'Alex Example [EMAIL]: two invoices',
  );
  assert.ok(
    chat.messages.some(
      (message) =>
        message.role === 'assistant' &&
        message.text === 'Recorded the finding.',
    ),
  );
  const old = s.bridges[0];
  await assert.rejects(
    fetch(old.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${old.token}` },
    }),
  );
  s.chats.send({ chatId: s.id, text: 'Add another finding' });
  await idle(s.chats, s.id);
  assert.notEqual(s.bridges[1].token, old.token);
  assert.ok(s.prompts.at(-1).includes('Previous conversation'));
  assert.ok(
    !s.prompts.at(-1).includes('case:') && !s.prompts.at(-1).includes('+1 ·'),
  );
  assert.equal(
    s.chats
      .snapshot()
      .chats[0].messages.filter((message) => message.role === 'case').length,
    2,
  );
});

test('a new chat has MCP creation tools and can create and populate its case in one turn', async (t) => {
  const s = await setup(t, true);
  assert.ok(s.caseId);
  assert.equal(s.cases.snapshot().cases.length, 1);
  const saved = s.cases.snapshot().cases[0];
  assert.equal(saved.title, 'Duplicate invoices after HTTP 409');
  assert.equal(saved.entries.length, 1);
  assert.equal(s.chats.snapshot().chats[0].error, undefined);
  assert.equal(
    s.chats.snapshot().chats[0].messages.filter((m) => m.role === 'case')
      .length,
    1,
  );
});

test('a caseless chat can create its case on a later turn of the same session', async (t) => {
  const s = await setup(t, false, { attach: false });
  assert.equal(s.caseId, undefined);
  s.chats.send({
    chatId: s.id,
    text: 'Create a case for duplicate invoices after HTTP 409',
  });
  await idle(s.chats, s.id);
  assert.equal(s.bridges.length, 1, 'the session and its tools were reused');
  assert.equal(s.chats.snapshot().chats[0].error, undefined);
  assert.equal(s.cases.caseForChat(s.id), s.cases.snapshot().cases[0].id);
  assert.equal(
    s.cases.snapshot().cases[0].title,
    'Duplicate invoices after HTTP 409',
  );
});
