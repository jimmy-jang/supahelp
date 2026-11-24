import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { TeamStore } from '../../../src/main/platform/team-store.ts';
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (bytes) => bytes.toString(),
};
test('encrypted team queue survives process kill; tampering/missing key fails closed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'team-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const program = `import {TeamStore} from ${JSON.stringify(new URL('../../../src/main/platform/team-store.ts', import.meta.url).href)};
 const s=await TeamStore.open(process.argv[1],'account/workspace',{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:b=>b.toString()});
 s.transaction(()=>{s.put('document',{text:'TEAM_PRIVATE_CRASH_MARKER'});s.put('queue',{text:'TEAM_PRIVATE_CRASH_MARKER'});});
 console.log('committed');setInterval(()=>{},1000);`;
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', program, root],
    {
      env: { ...process.env, SUPAHELP_DISABLE_SUBSCRIPTIONS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code) reject(Error(`child ${code}`));
    });
  });
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGKILL');
  await exited;
  for (const name of await readdir(root))
    if (name !== 'key.enc')
      assert(
        !(await readFile(join(root, name))).includes(
          Buffer.from('TEAM_PRIVATE_CRASH_MARKER'),
        ),
      );
  let s = await TeamStore.open(root, 'account/workspace', encryption);
  assert.equal(s.get('document').text, 'TEAM_PRIVATE_CRASH_MARKER');
  assert.equal(s.get('queue').text, 'TEAM_PRIVATE_CRASH_MARKER');
  s.close();
  const db = new DatabaseSync(join(root, 'team.db'));
  db.prepare('UPDATE records SET payload=? WHERE id=?').run(
    Buffer.from('bad ciphertext'),
    'document',
  );
  db.close();
  s = await TeamStore.open(root, 'account/workspace', encryption);
  assert.throws(() => s.get('document'), /sync-locked/);
  s.close();
  await rm(join(root, 'key.enc'));
  await assert.rejects(
    TeamStore.open(root, 'account/workspace', encryption),
    /sync-locked/,
  );
});
test('unavailable OS encryption cannot create a plaintext fallback; key rotation invalidates prior rows', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'team-keys-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    TeamStore.open(join(root, 'locked'), 'scope', {
      ...encryption,
      isEncryptionAvailable: () => false,
    }),
    /sync-locked/,
  );
  const store = await TeamStore.open(root, 'scope', encryption);
  store.put('draft', 'masked');
  const old = await readFile(join(root, 'key.enc'));
  await store.rotate(encryption);
  assert.notDeepEqual(await readFile(join(root, 'key.enc')), old);
  assert.equal(store.get('draft'), undefined);
  await store.destroy();
  await writeFile(join(root, 'unused'), '').catch(() => {});
});

test('team creation never reads or copies a personal chat behind the context boundary', async () => {
  const { CaseStore } =
    await import('../../../src/main/features/cases/store.ts');
  const { CaseService } =
    await import('../../../src/main/features/cases/service.ts');
  const context = {
    generation: 1,
    accountId: 'account',
    context: { kind: 'team', organizationId: 'org', workspaceId: 'workspace' },
  };
  const cases = new CaseService(new CaseStore(':memory:'), () => {}, {
    context: () => context,
    assertContext: () => {},
    encryption,
    mask: () => assert.fail('personal chat must never reach team masking'),
  });
  await assert.rejects(
    cases.create(
      { id: 'personal-chat', title: 'Personal title', messages: [] },
      { context, signal: new AbortController().signal },
    ),
    /sync-unavailable-operation/,
  );
  assert.equal(cases.caseForChat('personal-chat'), undefined);
  cases.close();
});
