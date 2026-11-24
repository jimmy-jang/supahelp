import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockSubscriptionPolicy } from '../../support/subscription-policy.mjs';

import { publicChatError } from '../../../src/main/features/chat/service.ts';
import { DOCUMENT_DRAFT_INSTRUCTIONS } from '../../../src/main/integrations/document-draft.ts';

mockSubscriptionPolicy();
const {
  claudeEnvironment,
  projectClaudeStatus,
  claudeOptions,
  assertChatCapabilities,
  claudeFailureCode,
} = await import('../../../src/main/integrations/claude-code.ts');

test('drafting uses fixed instructions with no tools, hooks, plugins or persisted transcript', async () => {
  const options = claudeOptions(
    '/test/claude',
    '/tmp/app',
    {},
    'sonnet',
    new AbortController(),
    [],
    'document-draft',
  );
  assert.equal(options.systemPrompt, DOCUMENT_DRAFT_INSTRUCTIONS);
  assert.deepEqual(options.mcpServers, {});
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.settingSources, []);
  assert.deepEqual(options.plugins, []);
  assert.deepEqual(options.skills, []);
  assert.equal(options.persistSession, false);
  assert.equal(options.debug, false);
  assert.equal(options.stderr('synthetic private diagnostic'), undefined);
  assert.equal(options.permissionMode, 'dontAsk');
  assert.equal(options.settings.disableAllHooks, true);
  assert.equal(options.settings.autoMemoryEnabled, false);
  assert.equal(
    (await options.canUseTool('mcp__linear__get_issue', {}, {})).behavior,
    'deny',
  );
  assert.throws(
    () =>
      claudeOptions(
        '/test/claude',
        '/tmp/app',
        {},
        'sonnet',
        new AbortController(),
        [{ name: 'linear' }],
        'document-draft',
      ),
    /^Error: case-masking-failed$/,
  );
});

test('server and unavailable-model errors do not incorrectly request a new sign-in', () => {
  assert.doesNotMatch(
    publicChatError(Error(claudeFailureCode('overloaded'))),
    /authentication/i,
  );
  assert.match(
    publicChatError(Error(claudeFailureCode('model_not_found'))),
    /model/i,
  );
  assert.match(
    publicChatError(Error(claudeFailureCode('authentication_failed'))),
    /authentication/i,
  );
});

test('explicit API-key authentication overrides ambient credentials and requires its exact runtime source', () => {
  const key = 'synthetic-anthropic-key-for-test';
  const env = claudeEnvironment(
    {
      HOME: '/test',
      ANTHROPIC_AUTH_TOKEN: 'other-secret',
      CLAUDE_CODE_USE_BEDROCK: '1',
    },
    key,
  );
  assert.equal(env.ANTHROPIC_API_KEY, key);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, undefined);
  const init = {
    apiKeySource: 'ANTHROPIC_API_KEY',
    tools: [],
    mcp_servers: [],
    skills: [],
    plugins: [],
  };
  assert.doesNotThrow(() => assertChatCapabilities(init, [], true));
  for (const source of ['none', 'apiKeyHelper', '/login managed key'])
    assert.throws(
      () => assertChatCapabilities({ ...init, apiKeySource: source }, [], true),
      /isolation/,
    );
  assert.throws(() => assertChatCapabilities(init), /isolation/);
});

test('allows only subscription authentication and projects no secret-bearing status fields', () => {
  const raw = {
    loggedIn: true,
    authMethod: 'claude.ai',
    subscriptionType: 'enterprise',
    email: 'test@example.com',
    accessToken: 'fake-secret',
  };
  const result = projectClaudeStatus(raw, '/test/claude', '2.1.319', 'default');
  assert.equal(result.state, 'ready');
  assert.equal(result.plan, 'enterprise');
  assert.doesNotMatch(JSON.stringify(result), /fake-secret|accessToken/);
  assert.equal(
    projectClaudeStatus(
      { loggedIn: true, authMethod: 'api_key' },
      '/test/claude',
      '2.1.319',
      'default',
    ).state,
    'unsupported',
  );
  assert.equal(
    projectClaudeStatus(
      { loggedIn: false },
      '/test/claude',
      '2.1.319',
      'default',
    ).state,
    'signed-out',
  );
});

test('fails closed on authentication conflicts instead of silently billing an API account', () => {
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'ANTHROPIC_PROFILE',
  ]) {
    assert.throws(
      () => claudeEnvironment({ HOME: '/tmp/test', [key]: 'fake-secret' }),
      (error) => /authentication/i.test(publicChatError(error)),
    );
  }
  const env = claudeEnvironment({
    HOME: '/tmp/test',
    PATH: '/bin',
    CLAUDECODE: '1',
    UNRELATED_SECRET: 'fake-secret',
  });
  assert.equal(env.HOME, '/tmp/test');
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.UNRELATED_SECRET, undefined);
});

test('chat sessions disable tools, MCP discovery, plugins and persisted transcripts', () => {
  const options = claudeOptions(
    '/test/claude',
    '/tmp/work',
    {},
    'sonnet',
    new AbortController(),
  );
  assert.equal(options.pathToClaudeCodeExecutable, '/test/claude');
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.strictMcpConfig, true);
  assert.deepEqual(options.settingSources, []);
  assert.deepEqual(options.plugins, []);
  assert.equal(options.persistSession, false);
  assert.equal(options.model, 'sonnet');
  assert.equal(options.extraArgs?.bare, undefined);
  assert.equal(options.extraArgs?.['disable-slash-commands'], null);
});

test('permits native built-in modules but refuses injected plugin, skill or tool capabilities', () => {
  const init = {
    apiKeySource: 'none',
    tools: [],
    mcp_servers: [],
    skills: [],
    plugins: [{ name: 'cc-plugin-privacy', path: 'builtin' }],
  };
  assert.doesNotThrow(() => assertChatCapabilities(init));
  for (const change of [
    { tools: ['Bash'] },
    { mcp_servers: [{ name: 'private' }] },
    { skills: ['custom'] },
    { plugins: [{ name: 'cc-plugin-privacy', path: '/tmp/plugin' }] },
    { apiKeySource: 'apiKeyHelper' },
  ]) {
    assert.throws(
      () => assertChatCapabilities({ ...init, ...change }),
      /isolation/,
    );
  }
});

test('connected chats expose only the app-owned Linear endpoint and keep other tools denied', async () => {
  const options = claudeOptions(
    '/test/claude',
    '/tmp/work',
    {},
    'sonnet',
    new AbortController(),
    [
      {
        name: 'linear',
        url: 'http://127.0.0.1:1234/mcp',
        token: 'local-capability',
        close() {},
      },
    ],
  );
  assert.deepEqual(options.tools, []);
  assert.equal(options.mcpServers.linear.url, 'http://127.0.0.1:1234/mcp');
  assert.equal(
    (await options.canUseTool('mcp__linear__get_issue', { id: 'SUP-1' }, {}))
      .behavior,
    'allow',
  );
  assert.equal(
    (await options.canUseTool('Bash', { command: 'echo nope' }, {})).behavior,
    'deny',
  );
  const init = {
    apiKeySource: 'none',
    tools: ['mcp__linear__get_issue'],
    mcp_servers: [{ name: 'linear' }],
    skills: [],
    plugins: [],
  };
  assert.doesNotThrow(() => assertChatCapabilities(init, ['linear']));
  assert.throws(
    () => assertChatCapabilities({ ...init, tools: ['Bash'] }, ['linear']),
    /isolation/,
  );
  assert.throws(
    () =>
      assertChatCapabilities({ ...init, mcp_servers: [{ name: 'other' }] }, [
        'linear',
      ]),
    /isolation/,
  );
});

test('a selected project enables file reads, edits only when confirmation is skipped, and blocks secrets', async () => {
  const open = (write) =>
    claudeOptions(
      '/test/claude',
      '/tmp/project',
      {},
      'sonnet',
      new AbortController(),
      [],
      undefined,
      { write },
    );
  const asking = open(false);
  assert.equal(asking.cwd, '/tmp/project');
  assert.deepEqual(asking.tools, ['Read', 'Glob', 'Grep']);
  assert.equal(asking.permissionMode, 'default');
  const { permissions } = asking.settings;
  assert.equal(permissions.blockReadsOutsideWorkingDirectories, true);
  assert.equal(permissions.blockWritesOutsideWorkingDirectories, true);
  assert.ok(permissions.deny.includes('Read(**/.env)'));
  assert.ok(permissions.deny.includes('Edit(**/.env)'));
  assert.equal(asking.settings.disableAllHooks, true);
  assert.match(asking.systemPrompt, /Editing is off/);
  for (const tool of ['Edit', 'Write', 'Bash'])
    assert.equal((await asking.canUseTool(tool, {}, {})).behavior, 'deny');
  assert.equal(
    (await asking.canUseTool('Read', { file_path: '/tmp/project/a' }, {}))
      .behavior,
    'allow',
  );

  const writing = open(true);
  assert.deepEqual(writing.tools, ['Read', 'Glob', 'Grep', 'Edit', 'Write']);
  assert.match(writing.systemPrompt, /You can edit files/);
  assert.equal((await writing.canUseTool('Edit', {}, {})).behavior, 'allow');
  assert.equal((await writing.canUseTool('Bash', {}, {})).behavior, 'deny');

  const init = {
    apiKeySource: 'none',
    tools: ['Read', 'Glob', 'Grep'],
    mcp_servers: [],
    skills: [],
    plugins: [],
  };
  assert.doesNotThrow(() =>
    assertChatCapabilities(init, [], false, asking.tools),
  );
  assert.throws(
    () =>
      assertChatCapabilities(
        { ...init, tools: [...init.tools, 'Bash'] },
        [],
        false,
        asking.tools,
      ),
    /isolation/,
  );
});

test('a selected project keeps connected tools and leaves drafting untouched', async () => {
  const connected = claudeOptions(
    '/test/claude',
    '/tmp/project',
    {},
    'sonnet',
    new AbortController(),
    [{ name: 'linear', url: 'http://127.0.0.1:1/mcp', token: 't', close() {} }],
    undefined,
    { write: false },
  );
  assert.equal(
    (await connected.canUseTool('mcp__linear__get_issue', {}, {})).behavior,
    'allow',
  );
  assert.match(connected.systemPrompt, /linear tools/);
  assert.match(connected.systemPrompt, /project folder is selected/);
  const drafting = claudeOptions(
    '/test/claude',
    '/tmp/work',
    {},
    'sonnet',
    new AbortController(),
    [],
    'document-draft',
    { write: true },
  );
  assert.deepEqual(drafting.tools, []);
});

test('with Ask first, project edits wait for the user and a decline is refused', async () => {
  const asked = [];
  let answer = true;
  const options = claudeOptions(
    '/test/claude',
    '/tmp/project',
    {},
    'sonnet',
    new AbortController(),
    [],
    undefined,
    {
      write: false,
      approve: async (request) => {
        asked.push(request);
        return answer;
      },
    },
  );
  assert.deepEqual(options.tools, ['Read', 'Glob', 'Grep', 'Edit', 'Write']);
  assert.match(options.systemPrompt, /approves each change/);
  const edit = {
    file_path: '/tmp/project/src/a.ts',
    old_string: 'a',
    new_string: 'b',
  };
  assert.equal((await options.canUseTool('Edit', edit, {})).behavior, 'allow');
  assert.deepEqual(asked[0], {
    tool: 'Edit',
    path: 'src/a.ts',
    before: 'a',
    after: 'b',
  });
  answer = false;
  assert.equal(
    (
      await options.canUseTool(
        'Write',
        { file_path: '/tmp/project/b.ts', content: 'x' },
        {},
      )
    ).behavior,
    'deny',
  );
  assert.deepEqual(asked[1], { tool: 'Write', path: 'b.ts', after: 'x' });
  assert.equal((await options.canUseTool('Read', {}, {})).behavior, 'allow');
  assert.equal(asked.length, 2);
});
