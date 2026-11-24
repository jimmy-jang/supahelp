import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockSubscriptionPolicy } from '../../support/subscription-policy.mjs';
import { mkdtemp, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const subscriptionPolicy = mockSubscriptionPolicy();
const { ClaudeCode, claudeEnvironment, windowsSignInCommand } =
  await import('../../../src/main/integrations/claude-code.ts');
const { CodexRpc } = await import('../../../src/main/integrations/codex.ts');
const { ChatModels } =
  await import('../../../src/main/features/chat/models.ts');

function disableSubscriptions(t) {
  subscriptionPolicy.enabled = false;
  t.after(() => {
    subscriptionPolicy.enabled = true;
  });
}

test('Claude subscription status uses the native runtime; disconnect and explicit API mode stay separate', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'claude-subscription-fixture-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, 'claude');
  await writeFile(
    executable,
    `#!${process.execPath}
if(process.argv[2]==='--version') console.log('Claude Code 2.1.322');
else if(process.argv.slice(2).join(' ')==='auth status --json') console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'fixture@example.test',subscriptionType:'pro'}));
else process.exit(1);
`,
    { mode: 0o700 },
  );
  const settings = join(directory, 'claude.json');
  await writeFile(settings, JSON.stringify({ model: 'sonnet', executable }));
  let mode = 'subscription';
  const provider = new ClaudeCode(settings, directory, {
    get: async () => ({
      mode,
      ...(mode === 'api-key' ? { key: 'synthetic-key-for-test-only' } : {}),
    }),
  });
  assert.equal((await provider.status()).state, 'ready');
  assert.equal((await provider.status()).email, 'fixture@example.test');
  mode = 'disconnected';
  assert.equal((await provider.status()).state, 'disconnected');
  mode = 'api-key';
  disableSubscriptions(t);
  assert.equal((await provider.status()).state, 'ready');
  mode = 'subscription';
  assert.equal((await provider.status()).state, 'error');
  assert.match(
    (await provider.status()).message,
    /disabled for automated tests/,
  );
  await assert.rejects(
    () => provider.signIn(),
    /^Error: subscription-tests-disabled$/,
  );
  assert.throws(
    () => claudeEnvironment({ HOME: directory }),
    /subscription-tests-disabled/,
  );
  assert.equal(
    claudeEnvironment({ HOME: directory }, 'synthetic-api-key')
      .ANTHROPIC_API_KEY,
    'synthetic-api-key',
  );
});

test('Windows sign-in keeps the executable path out of the PowerShell command', () => {
  const executable = "C:\\Users\\A & B's\\$(calc)\\claude.exe";
  const { file, args, options } = windowsSignInCommand(
    executable,
    { PATH: 'C:\\bin' },
    'D:\\Windows',
  );
  assert.equal(
    file,
    'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
  assert.ok(!args.join(' ').includes(executable));
  assert.match(args.at(-1), /'auth','login','--claudeai'$/);
  assert.equal(options.env.SUPAHELP_CLAUDE_EXECUTABLE, executable);
  assert.equal(options.env.PATH, 'C:\\bin');
});

test('explicit subscription selection clears only that provider key and invokes native sign-in', async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), 'model-subscription-fixture-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const claude = {
    close: () => calls.push('close'),
    configure: async (value) => calls.push(['configure', value]),
    signIn: async () => calls.push('native-sign-in'),
  };
  const credentials = {
    set: async (...args) => calls.push(['credentials', ...args]),
  };
  const models = new ChatModels(
    join(directory, 'models.json'),
    claude,
    {
      disconnect: async () => {
        throw Error('Must not sign out Codex when connecting Claude');
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    credentials,
  );
  await models.connect('claude', async () => {
    throw Error('Claude owns browser sign-in');
  });
  assert.deepEqual(calls, [
    'close',
    ['credentials', 'claude', 'subscription'],
    ['configure', { enabled: true }],
    'native-sign-in',
  ]);
  disableSubscriptions(t);
  calls.length = 0;
  await assert.rejects(
    () => models.connect('claude', async () => {}),
    /subscription-tests-disabled/,
  );
  await assert.rejects(
    () => models.connect('chatgpt', async () => {}),
    /subscription-tests-disabled/,
  );
  assert.deepEqual(calls, []);
});

test('automated subscription runs are rejected before Codex spawns or creates its home', async (t) => {
  disableSubscriptions(t);
  const directory = await mkdtemp(
    join(tmpdir(), 'subscription-process-guard-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'must-not-exist');
  const rpc = new CodexRpc('/must-not-execute', home);
  await assert.rejects(
    () => rpc.start(),
    /^Error: subscription-tests-disabled$/,
  );
  rpc.close();
  await assert.rejects(() => stat(home), { code: 'ENOENT' });
});
