// Controlled WorkOS transport and disposable local database; no model requests.
process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const assert = require('node:assert/strict');
const { app } = require('electron');
const { fork } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '../..');
const profile = mkdtempSync(join(tmpdir(), 'supahelp-onboarding-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let cloud, running;
const timer = setTimeout(() => {
  console.error('Onboarding smoke timed out');
  app.exit(1);
}, 90000);
app.whenReady().then(async () => {
  let failed = false;
  try {
    cloud = fork(
      resolve(
        root,
        '../../../supahelp-api/services/api/tests/account-cloud.mjs',
      ),
      {
        execPath: 'node',
        env: process.env,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      },
    );
    const origin = await new Promise((resolve, reject) => {
      cloud.on('error', reject);
      cloud.on('exit', (code) => {
        if (code) reject(Error(`Cloud exited ${code}`));
      });
      cloud.on('message', (message) => {
        if (message.ready) resolve(message.origin);
      });
    });
    const packaged = join(
      root,
      'out/Supahelp-darwin-arm64/Supahelp.app/Contents/Resources/app.asar',
    );
    const boot = async () => {
      running = await require(
        join(tmpdir(), 'supahelp-account-e2e/app.cjs'),
      ).boot(profile, packaged, origin, true);
    };
    const evaluate = (expression) =>
      running.window.webContents.executeJavaScript(expression);
    const waitFor = async (expression) => {
      for (let i = 0; i < 240; i++) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error(`Timed out: ${expression}`);
    };
    const text = (value) =>
      waitFor(`document.body.textContent.includes(${JSON.stringify(value)})`);
    const click = (label) =>
      evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
      );
    const pick = (label) =>
      evaluate(
        `[...document.querySelectorAll('button[role="radio"]')].find(b=>b.textContent.includes(${JSON.stringify(label)})).click()`,
      );
    const restart = async () => {
      await running.close();
      running = undefined;
      await boot();
    };
    await boot();
    await evaluate('window.supahelp.signInAccount()');
    await text('What do you do?');
    await pick('Support specialist');
    await click('Continue');
    await text('How will you use Supahelp?');
    // Resume team onboarding after the organization was saved separately.
    const created = await evaluate(`
      window.supahelp.getAccount().then(({value}) =>
        window.supahelp.createOrganization({
          context: value.context,
          name: 'Existing Team',
          requestId: crypto.randomUUID()
        })
      )
    `);
    assert.equal(created.ok, true, created.error);
    await restart();
    await text('What do you do?');
    console.log('Onboarding smoke: interrupted questions return after restart');
    await pick('Support specialist');
    await click('Continue');
    await pick('With my team');
    await click('Continue');
    await text('Tell us about your team');
    assert.equal(
      await evaluate(
        `!!document.querySelector('input[aria-label="Company name"]')`,
      ),
      false,
    );
    await click('Continue');
    await pick('Zendesk');
    await click('Continue');
    await click('Skip');
    await click('Skip');
    await click('Finish');
    await text('Existing Team is ready');
    await waitFor(
      `document.querySelector('button[aria-controls="connect-zendesk"]')?.matches(':disabled') &&
        document.querySelector('button[aria-controls="connect-zendesk"]').textContent.includes('Pending provider review')`,
    );
    let state = (await evaluate('window.supahelp.getAccount()')).value;
    assert.equal(state.view.onboardingCompleted, false);
    assert.deepEqual(
      state.view.organizations.map(({ name }) => name),
      ['Existing Team'],
    );
    const answers = state.view.onboarding;
    await restart();
    await text('Existing Team is ready');
    state = (await evaluate('window.supahelp.getAccount()')).value;
    assert.deepEqual(state.view.onboarding, answers);
    await click('‹ Back');
    await text('How did you hear about Supahelp?');
    await click('‹ Back');
    await text('What slows your support work down most?');
    await click('Continue');
    await click('Finish');
    await text('Existing Team is ready');
    state = (await evaluate('window.supahelp.getAccount()')).value;
    assert.deepEqual(state.view.onboarding, answers);
    console.log(
      'Onboarding smoke: saved answers resume the checklist after restart',
    );
    await click('Skip for now');
    await text('Good ');
    await waitFor(
      `!document.body.textContent.includes('The account or workspace changed. Try again.')`,
    );
    assert.equal(
      (await evaluate('window.supahelp.getAccount()')).value.view
        .onboardingCompleted,
      true,
    );
    await restart();
    await text('Good ');
    assert.equal(
      await evaluate(
        "document.body.textContent.includes('Existing Team is ready')",
      ),
      false,
    );
    assert.equal(
      await evaluate(
        "document.body.textContent.includes('The account or workspace changed. Try again.')",
      ),
      false,
    );
    await click('Workspace settings');
    await click('Connections');
    await waitFor(
      `document.querySelector('button[data-tool="zendesk"]')?.matches(':disabled') &&
        document.querySelector('button[data-tool="zendesk"]').textContent.includes('Pending provider review')`,
    );
    console.log(
      'Onboarding smoke: pending Zendesk setup is visible and disabled in onboarding and Team Settings',
    );
    console.log(
      'Onboarding smoke: completion survives restart and home has no stale account error',
    );
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    if (running) await running.close().catch(() => {});
    if (cloud && cloud.connected) {
      const exit = new Promise((resolve) => cloud.once('exit', resolve));
      cloud.send({ id: 9999, command: 'close' });
      await exit;
    }
    clearTimeout(timer);
    rmSync(profile, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
});
