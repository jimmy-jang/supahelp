import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const config = (distribution, identity = '', profile = '') =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'import config from "./forge.config.mts"; console.log(JSON.stringify({...config.packagerConfig, signingOptions: config.packagerConfig.osxSign?.optionsForFile?.("Supahelp.app", {})}));',
      ],
      {
        cwd: new URL('..', import.meta.url),
        env: {
          ...process.env,
          SUPAHELP_MAC_DISTRIBUTION: distribution,
          SUPAHELP_MAC_SIGN_IDENTITY: identity,
          SUPAHELP_MAC_NOTARY_PROFILE: profile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  );

test('local packaging never submits to Apple; distribution requires both credential references', () => {
  const local = config('0');
  assert.equal(local.appBundleId, 'com.supahelp.desktop');
  assert.equal(local.asar, true);
  assert.deepEqual(local.osxSign, {
    identity: '-',
    identityValidation: false,
    continueOnError: false,
  });
  assert.equal(local.osxNotarize, undefined);
  assert.deepEqual(local.signingOptions, { hardenedRuntime: false });
  for (const [identity, profile] of [
    ['', ''],
    ['-', 'notary'],
    ['Apple Development: Test', 'notary'],
    ['Developer ID Application: Test (TEAM)', ''],
  ]) {
    assert.throws(() => config('1', identity, profile), /Command failed/);
  }
  const signed = config('1', 'Developer ID Application: Test (TEAM)', 'notary');
  assert.deepEqual(signed.osxSign, {
    identity: 'Developer ID Application: Test (TEAM)',
    continueOnError: false,
  });
  assert.deepEqual(signed.osxNotarize, { keychainProfile: 'notary' });
  assert.equal(signed.signingOptions, undefined);
});
