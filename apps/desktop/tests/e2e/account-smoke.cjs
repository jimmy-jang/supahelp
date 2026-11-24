process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const assert = require('node:assert/strict');
const { app, nativeTheme } = require('electron');
const { fork } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const root = resolve(__dirname, '../..'),
  profile = mkdtempSync(join(tmpdir(), 'supahelp-account-ui-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const timer = setTimeout(() => {
  console.error('Account smoke timed out');
  app.exit(1);
}, 120000);
let cloud,
  running,
  failed = 0;
let serial = 0;
const requests = new Map();
const command = (command, input = {}) =>
  new Promise((resolve, reject) => {
    const id = ++serial;
    requests.set(id, { resolve, reject });
    cloud.send({ id, command, ...input });
  });
app.whenReady().then(async () => {
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
        if (code) reject(Error(`Cloud fixture exited ${code}`));
      });
      cloud.on('message', (message) => {
        if (message.ready) resolve(message.origin);
        else {
          const pending = requests.get(message.id);
          requests.delete(message.id);
          if (pending) {
            if (message.error) pending.reject(Error(message.error));
            else pending.resolve(message.value);
          }
        }
      });
    });
    const packaged = join(
      root,
      `out/Supahelp-${process.platform}-${process.arch}/Supahelp.app/Contents/Resources/app.asar`,
    );
    const boot = () =>
      require(join(tmpdir(), 'supahelp-account-e2e/app.cjs')).boot(
        profile,
        packaged,
        origin,
      );
    running = await boot();
    const evaluate = (expression) =>
      running.window.webContents.executeJavaScript(expression);
    const waitFor = async (expression) => {
      for (let i = 0; i < 240; i++) {
        if (
          await (typeof expression === 'function'
            ? expression()
            : evaluate(expression))
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw Error(`Timed out: ${expression}`);
    };
    const click = async (text) => {
      await waitFor(
        `[...document.querySelectorAll('button')].some(button=>button.textContent.trim()===${JSON.stringify(text)}&&!button.disabled)`,
      );
      return evaluate(
        `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    };
    const input = (label, value) =>
      evaluate(
        `(()=>{const el=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    const snapshot = async () => {
      const reply = await evaluate('window.supahelp.getAccount()');
      assert.equal(reply.ok, true, reply.error);
      return reply.value;
    };
    const settings = async () => {
      await click('Workspace settings');
      await waitFor(
        `document.querySelector('h1')?.textContent === 'Workspace'`,
      );
    };
    const selectOrganization = (id) =>
      evaluate(
        `(()=>{const el=document.querySelector('select[aria-label="Organization"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(id)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    const settingsPage = async (name) => {
      await click(name);
      await waitFor(
        `document.querySelector('[data-settings-scroll] h1')?.textContent === ${JSON.stringify(name)}`,
      );
    };
    const accountPage = async () => {
      await settings();
      await settingsPage('Account');
    };
    const signin = async (name) => {
      await command('user', { name });
      await accountPage();
      if ((await snapshot()).view) {
        await click('Sign out');
        await waitFor(`document.body.textContent.includes('Confirm sign out')`);
        await click('Confirm sign out');
        await waitFor(
          `window.supahelp.getAccount().then(r=>r.ok && !r.value.view)`,
        );
        await accountPage();
        await waitFor(
          `document.body.textContent.includes('Sign in with email or Google')`,
        );
      }
      await click('Sign in with email or Google');
      await waitFor(
        `window.supahelp.getAccount().then(r=>r.ok && r.value.status==='ready' && r.value.view?.account.email===${JSON.stringify(name + '@example.test')})`,
      );
      await settings();
    };
    await waitFor('!!window.supahelp');
    const personalPlaybooks = (
      await evaluate(
        'window.supahelp.getAccount().then(r=>window.supahelp.getPlaybooks({context:r.value.context}))',
      )
    ).value.playbooks;
    assert.equal(personalPlaybooks.length, 1);
    const metrics = async (name = 'getPilotMetrics', context) =>
      evaluate(
        `window.supahelp.getAccount().then(r=>window.supahelp[${JSON.stringify(name)}]({context:${context ? JSON.stringify(context) : 'r.value.context'}}))`,
      );
    assert.equal(
      (await metrics('startPilotMetrics')).value.state,
      'collecting',
    );
    const personalCounts = (await metrics()).value.counts;
    const personalCases = (
      await evaluate(
        'window.supahelp.getAccount().then(r => window.supahelp.getCases(r.value.context))',
      )
    ).value.cases;
    await settings();
    assert.equal(
      await evaluate('document.body.textContent.includes("Viewers are free")'),
      false,
    );
    assert.equal(
      await evaluate('document.body.textContent.includes("$149")'),
      false,
    );
    assert.equal(await evaluate('typeof window.require'), 'undefined');
    console.log('Account smoke: owner setup');
    await signin('owner');
    const ownerWork = await running.seedPersonal();
    const caseRow = `[...document.querySelectorAll('section[aria-label="Cases"] button[draggable]')].find(button=>button.textContent.includes('Account-owned private case'))`;
    await waitFor(`!!(${caseRow})`);
    const ownerName = (await snapshot()).view.account.name;
    assert.equal(
      await evaluate(
        `(${caseRow}).querySelector('span[title=${JSON.stringify(ownerName)}]')?.textContent`,
      ),
      ownerName[0],
      'The personal case avatar uses the signed-in owner’s name',
    );
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', {key: ',', metaKey: true, bubbles: true}))`,
    );
    await waitFor(`document.querySelector('h1')?.textContent === 'General'`);
    await settingsPage('Organization');
    await input('Organization name', 'Controlled Acme');
    await click('Create organization');
    await waitFor(`document.body.textContent.includes('Awaiting activation')`);
    let state = await snapshot();
    const org = state.view.organizations[0],
      workspace = state.view.workspaces[0];
    assert.equal(org.access, 'setup');
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Create organization')`,
      ),
      false,
    );
    assert.deepEqual(
      await evaluate(`
        window.supahelp.createOrganization({
          name: 'Duplicate organization',
          requestId: crypto.randomUUID()
        })
      `),
      { ok: false, error: 'You already belong to an organization.' },
    );
    await click('Plan & billing');
    await waitFor(
      `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Start free trial'&&!b.disabled)`,
    );
    assert.equal(
      await evaluate(
        `document.body.textContent.includes('No card and no automatic charge')`,
      ),
      true,
    );
    await click('Start free trial');
    await waitFor(
      `window.supahelp.getAccount().then(r=>r.value.view.organizations[0].source==='trial')`,
    );
    assert.equal((await snapshot()).view.organizations[0].assigned, 1);
    console.log(
      'Account smoke: billing trial controls cross real renderer/preload/main/API',
    );
    await settingsPage('Organization');
    await waitFor(
      `window.supahelp.getAccount().then(({value}) => {
        const {expiresAt} = value.view.organizations[0];
        const date = new Date(expiresAt).toLocaleDateString(undefined, {
          day: 'numeric', month: 'short', year: 'numeric',
        });
        return document.body.textContent.includes('Free trial') &&
          document.body.textContent.includes('Expires ' + date);
      })`,
    );
    assert.equal(org.assigned, 0);
    await command('grant', { organizationId: org.id });
    await click('Refresh');
    await waitFor(`document.body.textContent.includes('1 of 5 used')`);
    console.log('Account smoke: deletion and restart isolation');
    const personalWork = async () => ({
      cases: (
        await evaluate(
          'window.supahelp.getAccount().then(r=>window.supahelp.getCases(r.value.context))',
        )
      ).value.cases,
      books: (
        await evaluate(
          'window.supahelp.getAccount().then(r=>window.supahelp.getPlaybooks({context:r.value.context}))',
        )
      ).value.playbooks,
    });
    await signin('uninvited');
    assert.deepEqual((await snapshot()).view.organizations, []);
    assert.deepEqual((await snapshot()).view.workspaces, []);
    assert.equal(
      (await evaluate(`window.supahelp.getBilling(${JSON.stringify(org.id)})`))
        .ok,
      false,
    );
    assert.deepEqual(await personalWork(), { cases: [], books: [] });
    const bWork = await running.seedPersonal();
    await running.close();
    running = await boot();
    assert.equal(
      (await snapshot()).view.account.email,
      'uninvited@example.test',
    );
    const beforeDelete = await personalWork();
    assert.deepEqual(beforeDelete.cases, bWork.cases);
    assert.deepEqual(beforeDelete.books, bWork.playbooks);
    const removedCase = await evaluate(
      `window.supahelp.getAccount().then(r=>window.supahelp.removeCase({context:r.value.context,caseId:${JSON.stringify(bWork.cases[0].id)}}))`,
    );
    assert.equal(removedCase.ok, true, removedCase.error);
    const removedBook = await evaluate(
      `window.supahelp.getAccount().then(r=>window.supahelp.removePlaybook({context:r.value.context,id:${JSON.stringify(bWork.playbooks[0].id)},version:${bWork.playbooks[0].version}}))`,
    );
    assert.equal(removedBook.ok, true, removedBook.error);
    assert.deepEqual(await personalWork(), { cases: [], books: [] });
    await signin('owner');
    assert.deepEqual(await personalWork(), {
      cases: ownerWork.cases,
      books: ownerWork.playbooks,
    });
    await running.close();
    running = await boot();
    assert.equal((await snapshot()).view.account.email, 'owner@example.test');
    assert.deepEqual(await personalWork(), {
      cases: ownerWork.cases,
      books: ownerWork.playbooks,
    });
    await signin('uninvited');
    assert.deepEqual(await personalWork(), { cases: [], books: [] });
    await signin('owner');
    console.log(
      'PASS: deleting B cases and Playbooks after restart leaves A unchanged across switch and another restart.',
    );
    console.log('Account smoke: capacity and invitations');
    await settingsPage('Workspace');
    for (let n = 1; n <= 4; n++) {
      await input('Invite email', `person${n}@example.test`);
      if (n === 1)
        await evaluate(
          `(()=>{const el=document.querySelector('select[aria-label="Invitation role"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'viewer');el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
      await click('Invite');
      await waitFor(
        `window.supahelp.getAccount().then(r=>r.value.view.organizations[0].reserved===${n})`,
      );
    }
    await input('Invite email', 'extra@example.test');
    await click('Invite');
    await waitFor(
      `document.body.textContent.includes('needs an available seat')`,
    );
    await waitFor(async () => (await command('delivery-count')) === 4);
    const token = await command('token', { name: 'person1' }),
      link = `supahelp://invite/accept?token=${token}`;
    await running.accounts.receiveLink(link);
    await waitFor(`document.body.textContent.includes('Review invitation')`);
    assert.equal((await snapshot()).pendingInvitation.status, 'wrong-account');
    console.log('Account smoke: recipient and restart');
    await signin('person1');
    await waitFor(`document.body.textContent.includes('Join workspace')`);
    // Restart before acceptance: protected credentials survive, pending links must be supplied again.
    await running.close();
    running = await boot();
    await running.accounts.receiveLink(link);
    await settings();
    await waitFor(`document.body.textContent.includes('Join workspace')`);
    await click('Join workspace');
    await waitFor(
      `!document.body.textContent.includes('Join workspace') && document.body.textContent.includes('Controlled Acme')`,
    );
    state = await snapshot();
    assert.equal(state.view.workspaces[0].role, 'viewer');
    assert.equal(state.view.organizations[0].assigned, 2);
    await running.close();
    running = await boot();
    await settings();
    state = await snapshot();
    assert.equal(state.view.account.email, 'person1@example.test');
    assert.doesNotMatch(
      JSON.stringify(state),
      /access_token|refresh_token|code_verifier/,
    );
    assert.doesNotMatch(
      readFileSync(join(profile, 'account.enc'), 'utf8'),
      /refresh_|access_token/,
    );
    const multi = await command('multi-workspace', { organizationId: org.id });
    assert.equal(multi.workspaces.length, 4);
    assert.equal(multi.organizations.length, 2);
    assert.equal(multi.organizations.find((o) => o.id === org.id).assigned, 2);
    assert.equal(multi.organizations.find((o) => o.id !== org.id).assigned, 2);
    await click('Refresh');
    await waitFor(`document.body.textContent.includes('Engineering')`);
    await input('Workspace name', 'Member workspace');
    await click('Create workspace');
    await waitFor(
      `window.supahelp.getAccount().then(r=>r.value.view.workspaces.some(w=>w.name==='Member workspace' && w.role==='admin'))`,
    );
    await settingsPage('Organization');
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Delete organization')`,
      ),
      false,
    );
    await settingsPage('Workspace');
    const teamHome = `document.querySelector('main h1')?.textContent.startsWith('Good ') && document.body.textContent.includes('New personal chat')`;
    const openWorkspace = `[...document.querySelectorAll('[data-settings-scroll] button')].find(button=>button.textContent.trim()==='Open' && button.parentElement.firstElementChild.firstElementChild.textContent===${JSON.stringify(workspace.name)})`;
    await waitFor(`!!(${openWorkspace})`);
    await evaluate(`(${openWorkspace}).click()`);
    await waitFor(teamHome);
    // Personal chat works inside a team workspace.
    await waitFor(
      `!!document.querySelector('main textarea[placeholder="Ask anything, or paste a ticket link…"]')`,
    );
    await settings();
    await evaluate(`(${openWorkspace}).click()`);
    await waitFor(teamHome);
    assert.equal(
      await evaluate(
        'document.querySelectorAll("[aria-label=Chats] button").length',
      ),
      1,
    );
    assert.equal(
      (
        await evaluate(
          'window.supahelp.getAccount().then(r => window.supahelp.getCases(r.value.context))',
        )
      ).value.cases.length,
      0,
    );
    assert.equal(
      (
        await evaluate(
          'window.supahelp.getAccount().then(r=>window.supahelp.getPlaybooks({context:r.value.context}))',
        )
      ).value.playbooks.length,
      0,
    );
    const stamp = (await snapshot()).context;
    const humanEdit = (context) =>
      evaluate(
        `window.supahelp.editCaseEntry({action:'add',caseId:${JSON.stringify(personalCases[0].id)},requestId:crypto.randomUUID(),value:{section:'summary',kind:'text',text:'Must not cross contexts'},context:${JSON.stringify(context)}})`,
      );
    assert.equal((await humanEdit(stamp)).ok, false);
    for (const name of [
      'getPilotMetrics',
      'startPilotMetrics',
      'finishPilotMetrics',
      'exportPilotMetrics',
      'deletePilotMetrics',
    ])
      assert.equal((await metrics(name)).ok, false);
    running.window.webContents.send('accounts:changed', {
      ...(await snapshot()),
      revision: 999999,
      context: { ...stamp, generation: stamp.generation - 1 },
      view: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await evaluate(teamHome), true);
    await command('remove', {
      organizationId: org.id,
      accountId: state.view.account.id,
    });
    await running.accounts.refresh();
    await waitFor(`!document.body.textContent.includes('New personal chat')`);
    state = await snapshot();
    assert.equal(state.context.context.kind, 'personal');
    assert.equal((await metrics()).value.state, 'off');
    assert.equal((await metrics('getPilotMetrics', stamp)).ok, false);
    assert.equal((await humanEdit(stamp)).ok, false);
    assert.equal(
      state.view.organizations.some((o) => o.id === org.id),
      false,
    );
    assert.equal(state.view.organizations.length, 1);
    assert.deepEqual(
      (
        await evaluate(
          'window.supahelp.getAccount().then(r => window.supahelp.getCases(r.value.context))',
        )
      ).value.cases,
      [],
    );
    assert.deepEqual(
      (
        await evaluate(
          'window.supahelp.getAccount().then(r=>window.supahelp.getPlaybooks({context:r.value.context}))',
        )
      ).value.playbooks,
      [],
    );
    await settings();
    for (const theme of ['light', 'dark']) {
      nativeTheme.themeSource = theme;
      await new Promise((resolve) => setTimeout(resolve, 100));
      writeFileSync(
        join(tmpdir(), `supahelp-account-${theme}.png`),
        (await running.window.webContents.capturePage()).toPNG(),
      );
      assert.equal(
        await evaluate('document.documentElement.scrollWidth <= innerWidth'),
        true,
      );
    }
    await settingsPage('Account');
    await click('Sign out');
    await waitFor(`document.body.textContent.includes('Confirm sign out')`);
    await click('Confirm sign out');
    await accountPage();
    await waitFor(
      `document.body.textContent.includes('Sign in with email or Google')`,
    );
    assert.equal((await snapshot()).context.accountId, null);
    assert.deepEqual((await metrics()).value.counts, personalCounts);
    assert.deepEqual(
      (
        await evaluate(
          'window.supahelp.getAccount().then(r=>window.supahelp.getCases(r.value.context))',
        )
      ).value.cases,
      personalCases,
    );
    assert.deepEqual(
      (
        await evaluate(
          'window.supahelp.getAccount().then(r=>window.supahelp.getPlaybooks({context:r.value.context}))',
        )
      ).value.playbooks,
      personalPlaybooks,
    );
    await signin('owner');
    const other = (await snapshot()).view.organizations.find(
      (o) => o.name === 'Other company',
    );
    await settingsPage('Organization');
    await selectOrganization(other.id);
    await command('expiry', { organizationId: other.id });
    await click('Refresh');
    await waitFor(
      `document.body.textContent.includes('Other company · read-only') && document.body.textContent.includes('Reclaim seat')`,
    );
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Export metadata').disabled`,
      ),
      false,
    );
    await settingsPage('Workspace');
    await selectOrganization(other.id);
    assert.equal(
      await evaluate(
        `document.querySelector('select[aria-label="Organization"]').value`,
      ),
      other.id,
    );
    await waitFor(
      `!!document.querySelector('select[aria-label="person1@example.test role"]')`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('select[aria-label="person1@example.test role"]').disabled`,
      ),
      true,
    );
    await command('expiry', { organizationId: other.id, locked: true });
    await settingsPage('Organization');
    await selectOrganization(other.id);
    await click('Refresh');
    await waitFor(
      `document.body.textContent.includes('Other company · locked')`,
    );
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Export metadata').disabled`,
      ),
      true,
    );
    await waitFor(
      `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Reclaim seat')`,
    );
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reclaim seat').disabled`,
      ),
      false,
    );
    await click('Delete organization');
    const deleteButton = `document.querySelector('dialog button[type="submit"]')`;
    assert.equal(await evaluate(`${deleteButton}.disabled`), true);
    await evaluate(
      `(() => {
        const field = document.querySelector('dialog input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(other.name)});
        field.dispatchEvent(new Event('input', {bubbles: true}));
      })()`,
    );
    await waitFor(`!${deleteButton}.disabled`);
    await evaluate(`${deleteButton}.click()`);
    await waitFor(
      `window.supahelp.getAccount().then(r=>r.value.view?.organizations.length===1 && r.value.view.organizations[0].id===${JSON.stringify(org.id)})`,
    );
    console.log(
      'PASS: packaged React/preload with real local HTTP/Postgres; public PKCE; owner setup; five-seat capacity; viewer invitation; controlled delivery; wrong account; encrypted restart; multi-workspace and cross-org seats; stale snapshot; removal; sign-out; personal case/Playbook preservation; grace/lock controls; light/dark and focus; member workspace creation; owner organization deletion.',
    );
  } catch (error) {
    console.error(error);
    if (running) {
      try {
        console.error(
          (
            await running.window.webContents.executeJavaScript(
              'document.body.textContent',
            )
          ).slice(-7000),
        );
      } catch {}
    }
    failed = 1;
  } finally {
    clearTimeout(timer);
    if (running) await running.close().catch(() => {});
    if (cloud?.connected) await command('close').catch(() => cloud.kill());
    rmSync(profile, { recursive: true, force: true });
    app.exit(failed);
  }
});
