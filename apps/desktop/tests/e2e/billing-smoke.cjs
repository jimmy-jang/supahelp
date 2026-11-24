process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
app.whenReady().then(async () => {
  let window;
  try {
    window = new BrowserWindow({
      width: 1280,
      height: 1000,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    window.webContents.on('console-message', (_event, ...args) =>
      console.log('Renderer:', ...args),
    );
    const run = (s) => window.webContents.executeJavaScript(s);
    await window.loadFile(join(tmpdir(), 'supahelp-billing-ui/index.html'));
    const wait = async (s) => {
      for (let i = 0; i < 100; i++) {
        if (await run(s)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw Error(`Timed out: ${s}`);
    };
    const has = (s) =>
      `document.body.textContent.includes(${JSON.stringify(s)})`;
    const click = async (s) => {
      await wait(
        `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(s)}&&!b.disabled)`,
      );
      await run(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(s)}).click()`,
      );
    };
    const reset = async (mode) => {
      await run(`window.billingTest.reset(${JSON.stringify(mode)})`);
      await new Promise((r) => setTimeout(r, 100));
    };
    await reset('icon-switcher');
    await wait(`!!document.querySelector('button[title="Switch workspace"]')`);
    await run(
      `document.querySelector('button[title="Switch workspace"]').click()`,
    );
    await wait(
      `[...document.querySelectorAll('button')].some(b => b.textContent.includes('General') && b.querySelector('img')?.naturalWidth > 0)`,
    );
    await click('General');
    await wait(
      `!!document.querySelector('button[title="Switch workspace"] img')`,
    );
    const previousIcon = await run(
      `document.querySelector('button[title="Switch workspace"] img').src`,
    );
    await run(`window.billingTest.setIcon('blue')`);
    await wait(
      `document.querySelector('button[title="Switch workspace"] img')?.src !== ${JSON.stringify(previousIcon)} && document.querySelector('button[title="Switch workspace"] img')?.naturalWidth > 0`,
    );
    const updatedIcon = await run(
      `document.querySelector('button[title="Switch workspace"] img').src`,
    );
    await run(
      `document.querySelector('button[title="Switch workspace"]').click()`,
    );
    await wait(
      `[...document.querySelectorAll('button')].some(b => b.textContent.includes('General') && b.querySelector('img')?.src === ${JSON.stringify(updatedIcon)})`,
    );
    // An account with an organization can still start another one.
    await reset('owner');
    await wait(`!!document.querySelector('button[title="Switch workspace"]')`);
    await run(
      `document.querySelector('button[title="Switch workspace"]').click()`,
    );
    await click('New organization');
    await wait(has('Set up another organization'));
    await click('Start 14-day free trial');
    await wait(has('Create organization and start trial'));
    assert.equal(
      await run(
        `document.querySelector('select[aria-label="Billing organization"]').value`,
      ),
      'new',
    );
    await reset('owner');
    await wait(has('Add payment method'));
    await click('Add payment method');
    await wait(has('Seats for Acme'));
    assert.equal(await run(has('$149.00/month before applicable tax')), true);
    assert.equal(await run('window.billingTest.calls().length'), 0);
    await click('Continue to save payment method');
    await wait(has('Finish payment in your browser'));
    await run(`window.billingTest.confirm('incomplete')`);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await run(has('Subscription confirmed')), false);
    await run('window.billingTest.confirm()');
    await wait(has('Subscription confirmed'));
    await reset('expired');
    await click('Subscribe now');
    await wait(has('Billing starts immediately after successful payment.'));
    await reset('owner');
    await click('Add payment method');
    await click('Continue to save payment method');
    await wait(has('Finish payment in your browser'));
    await reset('signed-out');
    await new Promise((resolve) => setTimeout(resolve, 3100));
    assert.equal(await run('window.billingTest.reads()'), 0);
    await reset('owner');
    await click('Add payment method');
    await run(
      `(()=>{const e=document.querySelector('[aria-label="Purchased seat capacity"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,'6');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await wait(has('End trial and continue to payment'));
    await wait(has('$178.00/month before applicable tax'));
    await wait(has('This ends your free trial early.'));
    await click('Cancel');
    assert.equal(await run('window.billingTest.calls().length'), 0);
    for (const [mode, text] of [
      ['signed-out', 'Sign in to start Team'],
      ['no-org', 'Start 14-day free trial'],
      ['member', 'Billing is managed by your organization owner'],
      ['disabled', "Billing isn't available yet"],
    ]) {
      await reset(mode);
      await wait(has(text));
      if (mode === 'member' || mode === 'signed-out' || mode === 'no-org')
        assert.equal(await run('window.billingTest.reads()'), 0);
    }
    await reset('no-org');
    await click('Subscribe');
    await wait(`!!document.querySelector('[aria-label="Organization name"]')`);
    await run(
      `(()=>{const e=document.querySelector('[aria-label="Organization name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Acme');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await click('Continue to seats');
    await wait(has('Seats for Acme'));
    await run(
      `document.querySelector('[aria-label="Purchased seat capacity"]').scrollIntoView({block:'center'})`,
    );
    await window
      .capturePage()
      .then((image) =>
        require('node:fs').writeFileSync(
          '/tmp/supahelp-billing-light.png',
          image.toPNG(),
        ),
      );
    nativeTheme.themeSource = 'dark';
    await new Promise((r) => setTimeout(r, 200));
    await window
      .capturePage()
      .then((image) =>
        require('node:fs').writeFileSync(
          '/tmp/supahelp-billing-dark.png',
          image.toPNG(),
        ),
      );
    console.log(
      'Billing UI smoke passed: access states, org creation, review, cancellation, early trial end, incomplete subscription and confirmed return.',
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (window)
      console.log(
        await window.webContents.executeJavaScript('document.body.innerText'),
      );
    app.exit(1);
  }
});
setTimeout(() => {
  console.error('Billing smoke timed out');
  app.exit(1);
}, 30000).unref();
