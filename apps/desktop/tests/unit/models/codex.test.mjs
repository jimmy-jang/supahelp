import assert from 'node:assert/strict';
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  writeFile,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { mockSubscriptionPolicy } from '../../support/subscription-policy.mjs';

import { DOCUMENT_DRAFT_INSTRUCTIONS } from '../../../src/main/integrations/document-draft.ts';

mockSubscriptionPolicy();
const { Codex, codexConfig, codexEnvironment } =
  await import('../../../src/main/integrations/codex.ts');

async function setup(t, mode = 'chatgpt', credentials) {
  const home = await mkdtemp(join(tmpdir(), 'supahelp-codex-test-'));
  const executable = join(home, 'codex');
  await writeFile(
    executable,
    `#!${process.execPath}
const {createInterface}=require('node:readline');
const {appendFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const mode=${JSON.stringify(mode)};
writeFileSync(join(process.env.CODEX_HOME,'arguments'),JSON.stringify(process.argv));
let turns=0;
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
 const request=JSON.parse(line);if(!request.method)return;
 appendFileSync(join(process.env.CODEX_HOME,'requests'),JSON.stringify(request)+'\\n');
 const result=value=>send({id:request.id,result:value});
 const event=(method,params)=>send({method,params:{threadId:'thread-1',...params}});
 if(request.method==='initialize')result({userAgent:'supahelp_desktop/0.167.0'});
 if(request.method==='account/read')result({account:{type:['failed','hanging'].includes(mode)?'chatgpt':mode,email:'user@example.com',planType:'plus',accessToken:'fake-secret'}});
 if(request.method==='model/list')result({data:[{model:'test-model',displayName:'Test model',hidden:false},{model:'hidden',hidden:true}]});
 if(request.method==='account/login/start')result({authUrl:mode==='bad-url'?'https://evil.example/login':'https://auth.openai.com/oauth/authorize?state=test',loginId:'login-1'});
 if(request.method==='account/logout')result({});
 if(request.method==='account/login/cancel')result({});
 if(request.method==='thread/start')result({thread:{id:'thread-1'},model:'test-model',instructionSources:[]});
 if(request.method==='turn/start'){
   turns++;
   result({turn:{id:'turn-'+turns}});
   event('item/agentMessage/delta',{delta:'reply '+turns});
   if(mode!=='hanging') event('turn/completed',{turn:{id:'turn-'+turns,status:mode==='failed'?'failed':'completed',error:{message:'fake-secret'}}});
 }
});
`,
    { mode: 0o700 },
  );
  const provider = new Codex(home, executable, credentials);
  t.after(async () => {
    provider.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(home, { recursive: true, force: true });
  });
  return { provider, home };
}

test('isolates the Codex home and excludes API keys, inherited auth and unrelated secrets', () => {
  const env = codexEnvironment('/app/codex', {
    HOME: '/user',
    PATH: '/bin',
    CODEX_HOME: '/other',
    OPENAI_API_KEY: 'secret',
    CODEX_ACCESS_TOKEN: 'secret',
    OTHER_SECRET: 'secret',
  });
  assert.deepEqual(env, {
    HOME: '/user',
    PATH: '/bin',
    CODEX_HOME: '/app/codex',
  });
  for (const key of [
    'features.shell_tool',
    'features.view_image',
    'features.apply_patch_freeform',
    'features.hooks',
    'features.plugins',
    'features.apps',
    'features.multi_agent',
    'agents.enabled',
  ])
    assert.equal(codexConfig[key], false);
  assert.equal(codexConfig.forced_login_method, 'chatgpt');
  assert.equal(codexConfig.web_search, 'disabled');
});

test('explicit API keys use memory-only runtime login for status, models and every chat process', async (t) => {
  const key = 'synthetic-openai-key-for-test';
  const { provider, home } = await setup(t, 'apiKey', {
    get: async () => ({ mode: 'api-key', key }),
  });
  assert.equal((await provider.status()).state, 'ready');
  assert.doesNotMatch(JSON.stringify(await provider.status()), new RegExp(key));
  const session = provider.open('test-model');
  for await (const _ of session.reply('hello', new AbortController().signal)) {
  }
  session.close();
  const requests = (await readFile(join(home, 'requests'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const logins = requests.filter((r) => r.method === 'account/login/start');
  assert.equal(logins.length, 2);
  assert.ok(
    logins.every((r) => r.params.type === 'apiKey' && r.params.apiKey === key),
  );
  const args = JSON.parse(await readFile(join(home, 'arguments'), 'utf8'));
  assert.ok(args.includes('cli_auth_credentials_store="ephemeral"'));
  assert.ok(args.includes('forced_login_method="api"'));
  assert.equal(args.join(' ').includes(key), false);
});

test('disconnect cancels browser login and erases credentials saved by an earlier process', async (t) => {
  const { provider, home } = await setup(t);
  await writeFile(join(home, 'auth.json'), 'old-subscription-token');
  await provider.disconnect();
  await assert.rejects(() => readFile(join(home, 'auth.json')), {
    code: 'ENOENT',
  });
  await provider.signIn();
  await provider.disconnect();
  const requests = (await readFile(join(home, 'requests'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.ok(requests.some((r) => r.method === 'account/login/cancel'));
  assert.ok(requests.some((r) => r.method === 'account/logout'));
});

test(
  'uses the npm-installed native binary on macOS without requiring Node on the child PATH',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const { home, provider } = await setup(t);
    const launcher = join(home, 'node_modules/@openai/codex/bin/codex.js');
    const native = join(
      home,
      `node_modules/@openai/codex/node_modules/@openai/codex-darwin-${process.arch}/vendor/${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin/bin/codex`,
    );
    await mkdir(dirname(launcher), { recursive: true });
    await mkdir(dirname(native), { recursive: true });
    await writeFile(launcher, '#!/usr/bin/env missing-node\n', { mode: 0o700 });
    await copyFile(join(home, 'codex'), native);
    provider.useExecutable(launcher);
    const status = await provider.status();
    assert.equal(status.state, 'ready');
    assert.equal(status.executable, await realpath(native));
  },
);

test('projects subscription status without credentials and excludes hidden model catalog entries', async (t) => {
  const { provider } = await setup(t);
  const status = await provider.status();
  assert.equal(status.state, 'ready');
  assert.equal(status.email, 'user@example.com');
  assert.doesNotMatch(JSON.stringify(status), /fake-secret|accessToken/);
  assert.deepEqual(
    (await provider.models()).map((model) => model.model),
    ['test-model'],
  );
});

test('rejects API authentication and untrusted browser sign-in URLs', async (t) => {
  const { provider } = await setup(t, 'apiKey');
  assert.equal((await provider.status()).state, 'signed-out');
  const session = provider.open('default');
  await assert.rejects(async () => {
    for await (const _ of session.reply(
      'hello',
      new AbortController().signal,
    )) {
    }
  }, /codex-auth/);
  const bad = await setup(t, 'bad-url');
  await assert.rejects(() => bad.provider.signIn(), /codex-auth/);
});

test('keeps sign-in pending until the native completion notification', async (t) => {
  const { provider, home } = await setup(t);
  await provider.signIn();
  provider.close(true);
  const status = await provider.status();
  assert.equal(status.state, 'signed-out');
  assert.match(status.message, /Finish ChatGPT sign-in/);
  const requests = (await readFile(join(home, 'requests'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.equal(
    requests.filter((request) => request.method === 'account/read').length,
    0,
  );
  provider.close();
  assert.equal((await provider.status()).state, 'ready');
});

test('streams replies and reuses an ephemeral thread for follow-up context', async (t) => {
  const { provider, home } = await setup(t);
  const session = provider.open('test-model');
  t.after(() => session.close());
  const replies = [];
  for (const text of ['hello', 'follow up']) {
    const output = [];
    for await (const item of session.reply(text, new AbortController().signal))
      output.push(item);
    replies.push(output);
  }
  assert.deepEqual(
    replies.map((items) =>
      items
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join(''),
    ),
    ['reply 1', 'reply 2'],
  );
  const requests = (await readFile(join(home, 'requests'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const threads = requests.filter(
    (request) => request.method === 'thread/start',
  );
  assert.equal(threads.length, 1);
  assert.equal(threads[0].params.ephemeral, true);
  assert.equal(threads[0].params.sandbox, 'read-only');
  assert.equal(threads[0].params.approvalPolicy, 'untrusted');
  assert.equal(threads[0].params.model, 'test-model');
  assert.equal(
    requests.filter((request) => request.method === 'turn/start').length,
    2,
  );
});

test('drafting starts an isolated ephemeral thread with fixed instructions and no project or connections', async (t) => {
  const { provider, home } = await setup(t);
  const session = provider.open(
    'test-model',
    { project: '/untrusted/project' },
    [],
    'document-draft',
  );
  t.after(() => session.close());
  for await (const _ of session.reply(
    '{"fields":[]}',
    new AbortController().signal,
  )) {
  }
  const requests = (await readFile(join(home, 'requests'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const thread = requests.find(
    (request) => request.method === 'thread/start',
  ).params;
  assert.equal(thread.cwd, home);
  assert.equal(thread.ephemeral, true);
  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.sandbox, 'read-only');
  assert.equal(thread.baseInstructions, DOCUMENT_DRAFT_INSTRUCTIONS);
  assert.throws(
    () =>
      provider.open('test-model', {}, [{ name: 'linear' }], 'document-draft'),
    /^Error: case-masking-failed$/,
  );
});

test('a failed turn preserves partial output and never exposes raw provider diagnostics', async (t) => {
  const { provider } = await setup(t, 'failed');
  const session = provider.open('default');
  const output = [];
  await assert.rejects(
    async () => {
      for await (const item of session.reply(
        'hello',
        new AbortController().signal,
      ))
        output.push(item);
    },
    (error) => error.message === 'codex-failure',
  );
  assert.equal(output.at(-1).text, 'reply 1');
});

test('main-owned MCP bridges permit writes without a second Codex approval gate', async (t) => {
  const { provider, home } = await setup(t);
  const session = provider.open('test-model', {}, [
    {
      name: 'supahelp-case',
      url: 'http://127.0.0.1:12345/mcp',
      token: 'synthetic',
      close() {},
    },
  ]);
  t.after(() => session.close());
  for await (const _ of session.reply(
    'Add a local case entry',
    new AbortController().signal,
  )) {
  }
  const argv = JSON.parse(await readFile(join(home, 'arguments'), 'utf8'));
  assert.ok(
    argv.includes(
      'mcp_servers.supahelp-case.default_tools_approval_mode="approve"',
    ),
  );
  const requests = (await readFile(join(home, 'requests'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const thread = requests.find((r) => r.method === 'thread/start').params;
  assert.equal(thread.approvalPolicy, 'never');
  assert.match(
    thread.baseInstructions,
    /External connector changes require approval through Supahelp/,
  );
  assert.equal(codexConfig['features.shell_tool'], false);
});

test('Stop settles a waiting stream and closes its child process', async (t) => {
  const { provider } = await setup(t, 'hanging');
  const session = provider.open('default');
  const controller = new AbortController();
  const stream = session.reply('hello', controller.signal);
  assert.equal((await stream.next()).value.type, 'model');
  assert.equal((await stream.next()).value.text, 'reply 1');
  const waiting = stream.next();
  setTimeout(() => controller.abort(), 10);
  assert.equal((await waiting).done, true);
});

test('passes project, effort, confirmation and attachments to the native provider', async (t) => {
  const { provider, home } = await setup(t);
  const session = provider.open('test-model', {
    project: home,
    effort: 'high',
    confirmation: 'skip',
  });
  t.after(() => session.close());
  for await (const _ of session.reply(
    'Look at these',
    new AbortController().signal,
    [
      {
        id: 'one',
        name: 'notes.txt',
        mime: 'text/plain',
        size: 4,
        data: 'dGVzdA==',
      },
      {
        id: 'two',
        name: 'screen.png',
        mime: 'image/png',
        size: 4,
        data: 'dGVzdA==',
      },
    ],
  )) {
  }
  const requests = (await readFile(join(home, 'requests'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const thread = requests.find((item) => item.method === 'thread/start').params;
  assert.equal(thread.cwd, home);
  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.sandbox, 'read-only');
  const turn = requests.find((item) => item.method === 'turn/start').params;
  assert.equal(turn.effort, 'high');
  assert.match(turn.input[1].text, /notes.txt\ntest/);
  assert.equal(turn.input[2].url, 'data:image/png;base64,dGVzdA==');
});
