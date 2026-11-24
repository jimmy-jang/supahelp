// Run in Electron after packaging; never sends a model request.
process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '../..');
const profile = mkdtempSync(path.join(tmpdir(), 'supahelp-tour-'));
app.setPath('userData', profile);
const seenFile = path.join(profile, 'quick-tour.json');
const timer = setTimeout(() => {
  console.error('Quick tour smoke timed out');
  app.exit(1);
}, 60000);
app.on('quit', () => {
  clearTimeout(timer);
  rmSync(profile, { recursive: true, force: true });
});
require(
  path.join(
    root,
    `out/Supahelp-${process.platform}-${process.arch}/Supahelp.app/Contents/Resources/app.asar/.vite/build/main.cjs`,
  ),
);

async function waitFor(run, label) {
  for (let i = 0; i < 150; i++) {
    const result = await run();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Timed out waiting for ${label}`);
}

app.whenReady().then(async () => {
  try {
    const window = await waitFor(
      () => BrowserWindow.getAllWindows()[0],
      'window',
    );
    const evaluate = (code) => window.webContents.executeJavaScript(code);
    const tourText = () =>
      evaluate(`document.querySelector('dialog[open]')?.textContent ?? ''`);
    const see = (text) =>
      waitFor(async () => (await tourText()).includes(text), text);
    const click = (label) =>
      evaluate(`(() => {
        const button = [...document.querySelectorAll('dialog[open] button')]
          .find((item) => item.textContent.trim() === ${JSON.stringify(label)});
        if (!button) throw Error('Missing button: ' + ${JSON.stringify(label)});
        button.click();
      })()`);
    const counts = () =>
      evaluate(`(async () => {
        const { value: account } = await window.supahelp.getAccount();
        const chats = await window.supahelp.getChats(account.context);
        const cases = await window.supahelp.getCases(account.context);
        return [chats.value.chats.length, cases.value.cases.length];
      })()`);

    await see('Welcome to Supahelp');
    assert.equal(existsSync(seenFile), false, 'opening does not mark it seen');
    await click('Start tour');
    await see('Start with a ticket');
    await evaluate(
      `document.querySelector('[aria-label="Send the sample ticket"]').click()`,
    );
    await see('See what Supahelp checked');
    await evaluate(`document.querySelector('[data-tour="steps"]').click()`);
    await see('Read ticket #48213');
    await click('Next');
    await see('Keep the case in one place');
    await click('Back');
    await see('See what Supahelp checked');
    await click('Next');
    await see('Keep the case in one place');
    await click('Next');
    await see('You approve every change');
    await click('Approve refund');
    await see('No refund was made');
    assert.equal((await tourText()).includes('re_3PqL9a'), false);
    assert.deepEqual(await counts(), [0, 0], 'the tour saves no real work');

    window.focus();
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(
      () => evaluate(`!document.querySelector('dialog[open]')`),
      'Esc to close the tour',
    );
    await waitFor(
      () => evaluate(`document.body.textContent.includes('Tour closed')`),
      'closed note',
    );
    await waitFor(() => existsSync(seenFile), 'saved state');
    assert.deepEqual(JSON.parse(readFileSync(seenFile, 'utf8')), {
      seen: true,
    });
    assert.equal(
      await evaluate(
        `document.body.textContent.includes('Charged twice in March')`,
      ),
      false,
      'the sample case is gone after the tour',
    );

    await evaluate(`document.querySelector('[data-menu-anchor]').click()`);
    await waitFor(
      () => evaluate(`!!document.querySelector('[role=menu]')`),
      'account menu',
    );
    await evaluate(`[...document.querySelectorAll('[role=menuitem]')]
      .find((item) => item.textContent.includes('Quick tour')).click()`);
    await see('Welcome to Supahelp');
    await click('Start tour');
    for (const title of [
      'Start with a ticket',
      'See what Supahelp checked',
      'Keep the case in one place',
      'You approve every change',
    ]) {
      await see(title);
      await click('Next');
    }
    await see('Reuse what worked');
    await click('Finish');
    await see('Tour complete');
    await see('Connect an AI model to start');
    await click('Connect a model');
    await waitFor(
      () => evaluate(`!document.querySelector('dialog[open]')`),
      'finish to close the tour',
    );
    await waitFor(
      () =>
        evaluate(
          `document.querySelector('main header')?.textContent.includes('Models')`,
        ),
      'Models settings',
    );

    window.webContents.reload();
    await waitFor(
      () =>
        evaluate(`!!document.querySelector('textarea, main header')`).catch(
          () => false,
        ),
      'app after reload',
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(
      await evaluate(`!!document.querySelector('dialog[open]')`),
      false,
      'the tour does not reopen',
    );
    console.log('Quick tour smoke passed');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
