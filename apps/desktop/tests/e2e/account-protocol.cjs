process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
// Production lifecycle with a scratch profile; does not change the OS default URL handler.
const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const profile = mkdtempSync(join(tmpdir(), 'account-protocol-'));
app.setPath('userData', profile);
require('../support/skip-quick-tour.cjs')(profile);
const bundle = resolve(
  __dirname,
  `../../out/Supahelp-${process.platform}-${process.arch}/Supahelp.app`,
);
const schemes = JSON.parse(
  execFileSync(
    '/usr/bin/plutil',
    [
      '-extract',
      'CFBundleURLTypes',
      'json',
      '-o',
      '-',
      join(bundle, 'Contents/Info.plist'),
    ],
    { encoding: 'utf8' },
  ),
);
assert.ok(schemes.some((type) => type.CFBundleURLSchemes.includes('supahelp')));
const token = () => `${randomUUID()}.1.${'A'.repeat(43)}`;
const coldToken = token();
const coldCase = randomUUID();
process.argv.push(`supahelp://case/${coldCase}`);
process.argv.push(`supahelp://invite/accept?token=${coldToken}`);
const timer = setTimeout(() => {
  console.error('Account protocol timed out');
  app.exit(1);
}, 30000);
app.on('quit', () => {
  clearTimeout(timer);
  rmSync(profile, { recursive: true, force: true });
});
require(join(bundle, 'Contents/Resources/app.asar/.vite/build/main.cjs'));
app.whenReady().then(async () => {
  try {
    const wait = async (run) => {
      for (let i = 0; i < 200; i++) {
        const result = await run();
        if (result) return result;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error('Protocol condition timed out');
    };
    const window = await wait(() => BrowserWindow.getAllWindows()[0]);
    const state = async () => {
      try {
        return (
          await window.webContents.executeJavaScript(
            'window.supahelp.getAccount()',
          )
        ).value;
      } catch {
        return undefined;
      }
    };
    const cold = await wait(async () => {
      const value = await state();
      return value?.pendingInvitation && value;
    });
    assert.equal(cold.pendingInvitation.status, 'sign-in-required');
    const coldCaseState = await wait(async () => {
      const v = await state();
      return v?.pendingCaseLink?.target === coldCase && v;
    });
    assert.equal(coldCaseState.pendingCaseLink.target, coldCase);
    assert.doesNotMatch(JSON.stringify(cold), new RegExp(coldToken));
    app.emit(
      'open-url',
      { preventDefault() {} },
      `supahelp://invite/accept?token=${token()}`,
    );
    const warm = await wait(async () => {
      const value = await state();
      return (
        value?.pendingInvitation?.id !== cold.pendingInvitation.id && value
      );
    });
    app.emit('second-instance', {}, [`https://evil.example/invite#${token()}`]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      (await state()).pendingInvitation.id,
      warm.pendingInvitation.id,
    );
    app.emit('second-instance', {}, [
      `supahelp://invite/accept?token=${token()}`,
    ]);
    await wait(
      async () =>
        (await state())?.pendingInvitation?.id !== warm.pendingInvitation.id,
    );
    const nextCase = randomUUID();
    app.emit(
      'open-url',
      { preventDefault() {} },
      `https://supahelp.app/case/${nextCase}`,
    );
    await wait(
      async () => (await state())?.pendingCaseLink?.target === nextCase,
    );
    app.emit('second-instance', {}, [`https://evil.test/case/${randomUUID()}`]);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await state()).pendingCaseLink.target, nextCase);
    const secondCase = randomUUID();
    app.emit('second-instance', {}, [`supahelp://case/${secondCase}`]);
    await wait(
      async () => (await state())?.pendingCaseLink?.target === secondCase,
    );
    console.log(
      'PASS: packaged supahelp scheme metadata; cold argv, warm open-url, second-instance routing; untrusted origin rejection; invitation token stays in main; opaque case cold/warm/second-instance links persist for sign-in. OS default-handler dispatch is not exercised.',
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
