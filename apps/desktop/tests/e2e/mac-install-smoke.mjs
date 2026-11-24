// Local artifact only: no model requests, normal profile access or Gatekeeper overrides.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
const { version, productName } = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
);
const artifact = resolve(
  process.argv[2] ||
    `out/make/zip/darwin/arm64/${productName}-darwin-arm64-${version}.zip`,
);
const scratch = await mkdtemp(join(tmpdir(), 'supahelp-install-'));
const application = join(scratch, 'Applications/Supahelp.app');
const profile = join(scratch, 'profile');
let child;
try {
  await mkdir(join(scratch, 'Applications'));
  await mkdir(profile);
  execFileSync('ditto', ['-x', '-k', artifact, join(scratch, 'Applications')]);
  execFileSync('codesign', ['--verify', '--deep', '--strict', application]);
  const signature = spawnSync('codesign', ['-dv', application], {
    encoding: 'utf8',
  });
  assert.match(signature.stderr, /Signature=adhoc/);
  const database = join(profile, 'personal', 'guest', 'cases.db');
  for (let attempt = 1; attempt <= 2; attempt++) {
    let diagnostic = '';
    child = spawn(
      join(application, 'Contents/MacOS/Supahelp'),
      [`--user-data-dir=${profile}`],
      { env: { ...process.env, SUPAHELP_DISABLE_SUBSCRIPTIONS: '1' } },
    );
    child.stdout.resume();
    child.stderr.on('data', (data) => (diagnostic += data));
    let ended = false;
    let failure;
    child.on('error', (error) => {
      ended = true;
      failure = error;
    });
    const exited = new Promise((done) =>
      child.once('exit', () => {
        ended = true;
        done();
      }),
    );
    for (let tick = 0; tick < 100; tick++) {
      assert.equal(ended, false, String(failure || diagnostic));
      if (await stat(database).catch(() => false)) break;
      await delay(100);
    }
    assert.ok((await stat(database)).size > 0, 'isolated database created');
    await delay(1500);
    assert.equal(ended, false, diagnostic);
    // The next launch opens the same scratch profile after a forced stop.
    child.kill('SIGKILL');
    await Promise.race([
      exited,
      delay(5000).then(() => {
        throw Error('Local app did not terminate');
      }),
    ]);
    child = undefined;
    console.log(
      `PASS extracted executable launch ${attempt} with scratch profile`,
    );
  }
  assert.ok((await readFile(database)).length > 0);
  assert.match(
    execFileSync('spctl', ['--status'], { encoding: 'utf8' }),
    /assessments enabled/,
  );
  execFileSync('xattr', [
    '-w',
    'com.apple.quarantine',
    `0083;${Math.floor(Date.now() / 1000).toString(16)};SupahelpLocalValidation;`,
    application,
  ]);
  const assessment = spawnSync(
    'spctl',
    ['--assess', '--type', 'execute', '--verbose=4', application],
    { encoding: 'utf8' },
  );
  assert.equal(assessment.status, 3, assessment.stderr);
  assert.match(assessment.stderr, /rejected/);
  console.log('PASS quarantined ad-hoc app rejected by Gatekeeper (expected)');
} finally {
  child?.kill('SIGKILL');
  await rm(scratch, { recursive: true, force: true });
}
