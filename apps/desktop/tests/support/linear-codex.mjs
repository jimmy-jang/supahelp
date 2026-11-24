#!/usr/bin/env node
// Controlled model runtime; it invokes the real MCP connection supplied by the app.
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const overrides = new Map();
for (let i = 0; i < process.argv.length; i++)
  if (process.argv[i] === '-c') {
    const text = process.argv[++i];
    const split = text.indexOf('=');
    overrides.set(text.slice(0, split), JSON.parse(text.slice(split + 1)));
  }
let fixtureApiMode = false;
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
createInterface({ input: process.stdin }).on('line', async (line) => {
  const request = JSON.parse(line);
  const result = (value) => send({ id: request.id, result: value });
  if (request.method === 'initialize')
    result({ userAgent: 'supahelp-test/0.167.0' });
  if (request.method === 'account/login/start') {
    fixtureApiMode = request.params.type === 'apiKey';
    result({});
  }
  if (request.method === 'account/read')
    result({
      account: {
        type: fixtureApiMode ? 'apiKey' : 'chatgpt',
        email: 'fixture@example.invalid',
        planType: 'test',
      },
    });
  if (request.method === 'model/list')
    result({
      data: [
        {
          model: 'fixture-model',
          displayName: 'Controlled test agent',
          hidden: false,
        },
      ],
    });
  if (request.method === 'thread/start')
    result({
      thread: { id: 'fixture-thread' },
      model: 'fixture-model',
      instructionSources: [],
    });
  if (request.method === 'turn/start') {
    result({ turn: { id: 'fixture-turn' } });
    const agent = new Client({ name: 'controlled-agent', version: '1.0.0' });
    try {
      const zendesk = request.params.input.some(
        (item) => item.type === 'text' && item.text.includes('Zendesk'),
      );
      const custom = request.params.input.some(
        (item) => item.type === 'text' && item.text.includes('custom API'),
      );
      const name = custom ? 'custom_api' : zendesk ? 'zendesk' : 'linear';
      await agent.connect(
        new StreamableHTTPClientTransport(
          new URL(overrides.get(`mcp_servers.${name}.url`)),
          {
            requestInit: {
              headers: {
                Authorization: `Bearer ${process.env[`SUPAHELP_${name.toUpperCase()}_TOKEN`]}`,
              },
            },
          },
        ),
      );
      await agent.listTools();
      const read = await agent.callTool(
        custom
          ? { name: 'read_record', arguments: { id: 'customer-1' } }
          : zendesk
            ? { name: 'get_ticket', arguments: { ticket_id: 123 } }
            : { name: 'get_issue', arguments: { id: 'SUP-1' } },
      );
      const written = await agent.callTool(
        custom
          ? {
              name: 'change_record',
              arguments: { id: 'customer-1', status: 'investigating' },
            }
          : zendesk
            ? {
                name: 'reply_to_ticket',
                arguments: {
                  ticket_id: 123,
                  body: 'We are investigating checkout.',
                  updated_stamp: JSON.parse(read.content[0].text).updated_at,
                },
              }
            : {
                name: 'create_issue',
                arguments: { title: 'Investigate checkout' },
              },
        undefined,
        { timeout: 120000 },
      );
      send({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'fixture-thread',
          delta: written.isError
            ? 'Linear did not complete the change.'
            : custom
              ? 'The custom API accepted the requested status.'
              : zendesk
                ? 'Zendesk accepted the customer reply.'
                : 'Linear created the issue: Investigate checkout.',
        },
      });
      send({
        method: 'turn/completed',
        params: {
          threadId: 'fixture-thread',
          turn: { id: 'fixture-turn', status: 'completed' },
        },
      });
    } finally {
      await agent.close();
    }
  }
});
