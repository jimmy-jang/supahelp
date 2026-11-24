#!/usr/bin/env node
// Controlled inference transport only. No network except the supplied local case MCP bridge.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const overrides = new Map();
for (let i = 0; i < process.argv.length; i++)
  if (process.argv[i] === '-c') {
    const text = process.argv[++i],
      split = text.indexOf('=');
    overrides.set(text.slice(0, split), JSON.parse(text.slice(split + 1)));
  }
let masking = false,
  drafting = false,
  apiKey = false;
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({ input: process.stdin }).on('line', async (line) => {
  const request = JSON.parse(line),
    result = (value) => send({ id: request.id, result: value });
  if (request.method === 'initialize')
    result({ userAgent: 'supahelp-controlled/0.167.0' });
  if (request.method === 'account/login/start') {
    assert.equal(request.params.type, 'apiKey');
    assert.equal(request.params.apiKey, 'controlled-fixture-api-key-only');
    apiKey = true;
    result({ type: 'apiKey' });
  }
  if (request.method === 'account/read')
    result({
      account: {
        type: apiKey ? 'apiKey' : 'chatgpt',
        email: 'fixture@example.test',
        planType: 'fixture',
      },
    });
  if (request.method === 'model/list')
    result({
      data: [
        {
          model: 'fixture-model',
          displayName: 'Controlled case model',
          hidden: false,
        },
      ],
    });
  if (request.method === 'thread/start') {
    masking = request.params.baseInstructions.includes('candidate case fields');
    drafting = request.params.baseInstructions.includes(
      'Draft a local support document',
    );
    if (masking) {
      assert.equal(request.params.ephemeral, true);
      assert.ok(
        ![...overrides.keys()].some((key) => key.startsWith('mcp_servers.')),
      );
    }
    result({
      thread: { id: 'fixture-thread' },
      model: 'fixture-model',
      instructionSources: [],
    });
  }
  if (request.method !== 'turn/start') return;
  result({ turn: { id: 'fixture-turn' } });
  const output = (text) => {
    send({
      method: 'item/agentMessage/delta',
      params: { threadId: 'fixture-thread', delta: text },
    });
    send({
      method: 'turn/completed',
      params: {
        threadId: 'fixture-thread',
        turn: { id: 'fixture-turn', status: 'completed' },
      },
    });
  };
  const prompt = request.params.input[0].text;
  if (drafting) {
    assert.ok(
      ![...overrides.keys()].some((key) => key.startsWith('mcp_servers.')),
    );
    const { kind } = JSON.parse(prompt);
    output(
      JSON.stringify(
        kind === 'resolution'
          ? {
              resolution:
                'Alex Example fixed duplicate invoices by adding a retry guard.',
            }
          : {
              title: 'Safe invoice retries',
              markdown:
                '## Retry safely\n\nAvoid duplicate invoice requests.\n\n- Check the previous request result before retrying.',
            },
      ),
    );
    return;
  }
  if (masking) {
    assert.ok(!prompt.includes('alex@example.test'));
    if (prompt.includes('FIXTURE_WAIT_MASK')) {
      writeFileSync(join(process.env.CODEX_HOME, 'masking-waiting'), 'waiting');
      return;
    }
    if (prompt.includes('FIXTURE_FAIL_MASK')) {
      output('invalid masking result');
      return;
    }
    output(
      JSON.stringify({
        fields: JSON.parse(prompt).fields.map(({ id, text }) => {
          const spans = [];
          for (const [secret, kind] of [
            ['Alex Example', 'person'],
            ['12 Example Road', 'address'],
          ]) {
            let start = text.indexOf(secret);
            while (start >= 0) {
              spans.push({ start, end: start + secret.length, kind });
              start = text.indexOf(secret, start + secret.length);
            }
          }
          return { id, spans };
        }),
      }),
    );
    return;
  }
  const bookEndpoint = overrides.get('mcp_servers.supahelp-playbooks.url');
  const message = prompt.split('Current user message:\n').at(-1).toLowerCase();
  const bookAction = new Map([
    ['publish it', 'publish'],
    ['discard the playbook draft', 'discard'],
    ['delete the playbook', 'delete'],
    ['export the playbook', 'export'],
    ['copy the playbook', 'copy'],
    ['add a screenshot to it', 'screenshot'],
  ]).get(message);
  if (
    bookEndpoint &&
    (bookAction ||
      [
        'are you able to create a sample playbook?',
        'add a verification step',
        'show playbook history',
      ].includes(message))
  ) {
    const client = new Client({
      name: 'controlled-playbook-chat',
      version: '1',
    });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(bookEndpoint), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${process.env['SUPAHELP_SUPAHELP-PLAYBOOKS_TOKEN']}`,
            },
          },
        }),
      );
      const call = async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, undefined, result.content[0].text);
        return JSON.parse(result.content[0].text);
      };
      if (bookAction && bookAction !== 'screenshot') {
        assert.ok(
          (await call('request_playbook_action', { action: bookAction }))
            .awaitingUser,
        );
        output('Review the Playbook action below.');
        return;
      }
      if (message === 'are you able to create a sample playbook?') {
        const content = {
          title: 'Troubleshoot a CSV export with missing columns',
          markdown: '1. Check the selected columns.\n2. Run the export again.',
        };
        const draft = await call('save_playbook_draft', content);
        assert.equal((await call('save_playbook_draft', content)).id, draft.id);
        assert.ok(draft.saved);
        output('I saved the sample Playbook draft.');
        return;
      }
      const p = await call('read_playbook_for_editing', {});
      if (message === 'show playbook history') {
        const earlier = await call('read_playbook_for_editing', {
          historyIndex: p.history[0].historyIndex,
        });
        assert.ok(
          earlier.historyVersion.content.markdown.includes('Date column'),
        );
        output('I found the earlier published version.');
        return;
      }
      const content = p.draft ?? p.published;
      assert.ok(
        (
          await call('save_playbook_draft', {
            id: p.id,
            version: p.version,
            ...content,
            markdown: bookAction
              ? content.markdown
              : content.markdown +
                '\n3. Verify that the Date column has values.',
          })
        ).saved,
      );
      if (bookAction) {
        assert.ok(
          (await call('request_playbook_action', { action: bookAction }))
            .awaitingUser,
        );
        output('Choose a screenshot below.');
      } else {
        output('I updated the saved Playbook draft.');
      }
    } catch (error) {
      output(`Controlled Playbook tool failed: ${error.message}`);
    } finally {
      await client.close();
    }
    return;
  }
  if (bookEndpoint && prompt.toLowerCase().includes('read playbook')) {
    const client = new Client({
      name: 'controlled-playbook-agent',
      version: '1',
    });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(bookEndpoint), {
          requestInit: {
            headers: {
              Authorization: `Bearer ${process.env['SUPAHELP_SUPAHELP-PLAYBOOKS_TOKEN']}`,
            },
          },
        }),
      );
      const tools = await client.listTools();
      const id = tools.tools.find((tool) => tool.name === 'read_playbook')
        .inputSchema.properties.id.enum[0];
      const result = await client.callTool({
        name: 'read_playbook',
        arguments: { id },
      });
      assert.equal(result.isError, undefined);
      assert.ok(!JSON.stringify(result).includes('screenshotId'));
      output(
        'Read published Playbook: ' + JSON.parse(result.content[0].text).title,
      );
    } finally {
      await client.close();
    }
    return;
  }
  const endpoint = overrides.get('mcp_servers.supahelp-case.url');
  if (!endpoint && message !== 'find saved ticket #123') {
    output('Ready to investigate this ticket.');
    return;
  }
  assert.ok(endpoint, 'case reference lookup is available in chat');
  const client = new Client({ name: 'controlled-case-agent', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${process.env['SUPAHELP_SUPAHELP-CASE_TOKEN']}`,
          },
        },
      }),
    );
    const current = prompt
      .split('Current user message:\n')
      .at(-1)
      .toLowerCase();
    if (current === 'find saved ticket #123') {
      const found = await client.callTool({
        name: 'search_references',
        arguments: { kind: 'ticket', query: '#123' },
      });
      assert.equal(found.isError, undefined, found.content[0].text);
      const { cases } = JSON.parse(found.content[0].text);
      assert.equal(cases.length, 1);
      output(`Found saved ticket ${cases[0].ticket}.`);
      return;
    }
    const read = await client.callTool({ name: 'read_case', arguments: {} });
    const doc = JSON.parse(read.content[0].text),
      entry = doc.entries[0];
    if (
      current === 'can you resolve this case?' ||
      current === 'revise the resolution to mention testing three retries'
    ) {
      const revise = current.startsWith('revise');
      const review = doc.resolutionDraft && !revise;
      const version = doc.resolutionDraft?.version ?? 0;
      const result = await client.callTool({
        name: review ? 'review_resolution_draft' : 'save_resolution_draft',
        arguments: review
          ? { version }
          : {
              version,
              text: revise
                ? 'Added a retry guard and tested three retries.'
                : 'A retry guard stopped duplicate invoices.',
            },
      });
      assert.equal(result.isError, undefined, result.content[0].text);
      output('Review the draft and use Confirm Resolve in chat.');
      return;
    }
    if (current.includes('read case only')) {
      output('Read the case without changing it.');
      return;
    }
    let result;
    if (current.includes('update finding'))
      result = await client.callTool({
        name: 'update_entry',
        arguments: {
          entryId: entry.id,
          version: entry.version,
          value: {
            section: 'findings',
            kind: 'item',
            text: 'Later checked finding',
            pill: 'Confirmed',
            detail: 'Stripe in_1',
          },
        },
      });
    else if (current.includes('remove finding'))
      result = await client.callTool({
        name: 'remove_entry',
        arguments: { entryId: entry.id, version: entry.version },
      });
    else
      result = await client.callTool({
        name: 'add_entry',
        arguments: {
          section: 'findings',
          kind: 'item',
          text: current.includes('cancel check')
            ? 'FIXTURE_WAIT_MASK'
            : current.includes('fail check')
              ? 'FIXTURE_FAIL_MASK'
              : 'Alex Example at 12 Example Road; alex@example.test reported two invoices.',
          pill: 'Confirmed',
          detail: 'Stripe in_1',
        },
      });
    if (current.includes('hold reply')) {
      writeFileSync(
        join(process.env.CODEX_HOME, 'case-reply-waiting'),
        'waiting',
      );
      for (let i = 0; i < 400; i++) {
        if (existsSync(join(process.env.CODEX_HOME, 'case-reply-release')))
          break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    output(
      result.isError
        ? 'The entry was not saved.'
        : 'The case finding was saved.',
    );
  } catch {
    output('The case tool did not complete this operation.');
  } finally {
    await client.close();
  }
});
