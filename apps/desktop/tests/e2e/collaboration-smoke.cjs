process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const assert = require('node:assert/strict');
const clickMenu = require('../support/click-menu.cjs');
const { app } = require('electron');
const { fork } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const root = resolve(__dirname, '../..'),
  directory = mkdtempSync(join(tmpdir(), 'supahelp-collaboration-native-'));
app.setPath('userData', join(directory, 'runner'));
app.on('window-all-closed', () => {});
let cloud,
  running,
  serial = 0;
const waiting = new Map();
const timer = setTimeout(() => {
  console.error('Collaboration native smoke timed out');
  app.exit(1);
}, 120000);
const command = (command) =>
  new Promise((resolve, reject) => {
    const id = ++serial;
    waiting.set(id, { resolve, reject });
    cloud.send({ id, command });
  });
app.whenReady().then(async () => {
  try {
    cloud = fork(
      resolve(root, '../../../supahelp-api/services/api/tests/sync-cloud.mjs'),
      {
        execPath: 'node',
        env: process.env,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      },
    );
    const config = await new Promise((resolve, reject) => {
      cloud.once('error', reject);
      cloud.on('message', (m) => {
        if (m.ready) resolve(m);
        else {
          const p = waiting.get(m.id);
          waiting.delete(m.id);
          if (m.error) p.reject(Error(m.error));
          else p.resolve(m);
        }
      });
    });
    const packaged = join(
      root,
      `out/Supahelp-${process.platform}-${process.arch}/Supahelp.app/Contents/Resources/app.asar`,
    );
    const boot = async (token) => {
      running = await require(join(tmpdir(), 'supahelp-sync-e2e/app.cjs')).boot(
        join(directory, token),
        packaged,
        config.origin,
        token,
        config.workspaceId,
        config.organizationId,
      );
      return running;
    };
    const evaluate = (code) =>
      running.window.webContents.executeJavaScript(code);
    const raw = (method, input) =>
      evaluate(
        `window.supahelp[${JSON.stringify(method)}](${JSON.stringify(input)})`,
      );
    const invoke = async (method, input) => {
      const r = await raw(method, input);
      assert.equal(r.ok, true, `${method}: ${r.error}`);
      return r.value;
    };
    const context = async () => (await invoke('getAccount')).context;
    const pause = () => new Promise((r) => setTimeout(r, 50));
    const wait = async (check) => {
      for (let i = 0; i < 200; i++) {
        if (await check()) return;
        await pause();
      }
      throw Error('UI condition timed out');
    };
    await boot('person');
    let stamp = await context();
    await invoke('syncNow', stamp);
    await invoke('getCollaboration', { context: stamp });
    await invoke('notificationBannerSettings', {
      context: stamp,
      value: { enabled: true, hideDetails: true },
    });
    await running.close();
    running = undefined;
    await boot('owner');
    stamp = await context();
    const meta = await invoke('getCollaboration', { context: stamp }),
      person = meta.members.find((m) => m.role === 'member');
    assert(person);
    const id = await invoke('createTeamCase', stamp);
    await invoke('renameCase', {
      context: stamp,
      caseId: id,
      title: 'Shared collaboration acceptance',
      expectedTitle: 'Untitled case',
    }).catch(async () => {
      const c = (await invoke('getCases', stamp)).cases.find(
        (c) => c.id === id,
      );
      await invoke('renameCase', {
        context: stamp,
        caseId: id,
        title: 'Shared collaboration acceptance',
        expectedTitle: c.title,
      });
    });
    await invoke('syncNow', stamp);
    let c = (await invoke('getCases', stamp)).cases.find((c) => c.id === id);
    const lookup = (property) =>
      evaluate(
        `document.querySelector('aside[aria-label^="Case #"] button[title="Look up ${property}"]').click()`,
      );
    const caseRow = `[...document.querySelectorAll('section[aria-label="Cases"] button')].find(b => b.textContent.includes('Shared collaboration acceptance'))`;
    await wait(() => evaluate(`!!(${caseRow})`));
    await evaluate(`(${caseRow}).click()`);
    await wait(() =>
      evaluate(
        `!!document.querySelector('button[title="Look up contributors"]')`,
      ),
    );
    await lookup('contributors');
    await wait(() =>
      evaluate(
        `[...document.querySelectorAll(':popover-open button')].some(b => b.textContent.includes('Add'))`,
      ),
    );
    await evaluate(`document.querySelector(':popover-open').hidePopover()`);
    assert.equal((await raw('getCustomers', stamp)).ok, false);
    console.log(
      'PASS: shared contributor lookup opens from the case, and personal customer storage is scoped out.',
    );
    const bring = {
      context: stamp,
      id: randomUUID(),
      caseId: id,
      type: 'bring-in',
      recipientId: person.id,
      ownerRevision: c.ownerRevision ?? 0,
    };
    await invoke('collaborateCase', bring);
    await invoke('collaborateCase', bring);
    await invoke('editCaseEntry', {
      context: stamp,
      caseId: id,
      requestId: randomUUID(),
      action: 'add',
      value: {
        section: 'questions',
        kind: 'item',
        text: 'Which release contains the fix?',
        pill: 'Open',
      },
    });
    await invoke('syncNow', stamp);
    c = (await invoke('getCases', stamp)).cases.find((c) => c.id === id);
    const q = c.entries.find((e) => e.section === 'questions');
    await invoke('collaborateCase', {
      context: stamp,
      id: randomUUID(),
      caseId: id,
      type: 'assign-question',
      entryId: q.id,
      base: q.version,
      recipientId: person.id,
    });
    await lookup('owner');
    await evaluate(
      `[...document.querySelectorAll(':popover-open button')].find(b => b.textContent.includes('Make owner')).click()`,
    );
    await wait(
      async () =>
        (await invoke('getCases', stamp)).cases.find((c) => c.id === id)
          .ownerId === person.id,
    );
    console.log('PASS: the new owner was saved through the case lookup.');
    assert.equal(
      (
        await raw('collaborateCase', {
          context: stamp,
          id: randomUUID(),
          caseId: id,
          type: 'handoff',
          recipientId: person.id,
          ownerRevision: 0,
        })
      ).ok,
      false,
    );
    await running.close();
    running = undefined;
    await boot('person');
    stamp = await context();
    let inbox = await invoke('getCollaboration', { context: stamp });
    assert.equal(inbox.events.length, 3);
    assert.equal(new Set(inbox.events.map((e) => e.id)).size, 3);
    await wait(async () => running.delivered.length === 3);
    assert.equal(
      (await invoke('getCases', stamp)).cases.find((c) => c.id === id).ownerId,
      person.id,
    );
    await invoke('openCaseLink', { context: stamp, id });
    await wait(() =>
      evaluate('!!document.querySelector(\'aside[aria-label^="Case #"]\')'),
    );
    await evaluate(
      "Object.defineProperty(navigator.clipboard, 'writeText', { value: async text => { window.__caseLink = text; }, configurable: true })",
    );
    await clickMenu(
      running.window,
      'aside[aria-label^="Case #"]',
      'Copy case link',
    );
    await wait(() => evaluate('!!window.__caseLink'));
    assert.equal(
      await evaluate('window.__caseLink'),
      `https://supahelp.app/case/${id}`,
    );
    await wait(
      async () =>
        await evaluate(
          `document.body.textContent.includes('Shared collaboration acceptance')&&document.body.textContent.includes('Which release contains the fix?')`,
        ),
    );
    assert.equal(await evaluate('typeof window.require'), 'undefined');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(
      await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),
      true,
      'case controls fit the native window',
    );
    require('node:fs').writeFileSync(
      '/tmp/supahelp-collaboration-case.png',
      (await running.window.webContents.capturePage()).toPNG(),
    );
    await invoke('readCaseNotification', {
      context: stamp,
      id: inbox.events[0].id,
    });
    await running.close();
    running = undefined;
    await boot('person');
    stamp = await context();
    inbox = await invoke('getCollaboration', { context: stamp });
    assert.equal(running.delivered.length, 0);
    assert.equal(inbox.events[0].read, true);
    await command('viewer');
    await invoke('refreshAccount');
    stamp = await context();
    await invoke('syncNow', stamp);
    assert.notEqual(
      (await invoke('getCases', stamp)).cases.find((c) => c.id === id).ownerId,
      person.id,
    );
    c = (await invoke('getCases', stamp)).cases.find((c) => c.id === id);
    const entry = c.entries.find((e) => e.id === q.id),
      answer = randomUUID();
    assert.equal(
      (
        await raw('editCaseEntry', {
          context: stamp,
          caseId: id,
          requestId: randomUUID(),
          action: 'update',
          entryId: q.id,
          version: entry.version,
          value: {
            section: 'questions',
            kind: 'item',
            text: 'Unauthorized rewrite',
            pill: 'Open',
          },
        })
      ).ok,
      false,
    );
    await invoke('openCaseLink', { context: stamp, id });
    await wait(
      async () =>
        await evaluate(
          "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Answer question')",
        ),
    );
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Answer question').click()",
    );
    await wait(
      async () =>
        await evaluate("!!document.querySelector('dialog[open] textarea')"),
    );
    await evaluate(
      "Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent.trim()==='Cancel').click()",
    );
    await invoke('answerCaseQuestion', {
      context: stamp,
      id: answer,
      caseId: id,
      entryId: q.id,
      base: entry.version,
      text: 'Release two. Contact test@example.test',
    });
    assert.equal(
      (await raw('checkCaseAnswer', { context: stamp, id: answer })).ok,
      false,
    );
    await running.close();
    running = undefined;
    await boot('owner');
    stamp = await context();
    await invoke('getCollaboration', { context: stamp });
    await invoke('checkCaseAnswer', { context: stamp, id: answer });
    c = (await invoke('getCases', stamp)).cases.find((c) => c.id === id);
    assert.equal(c.entries.find((e) => e.id === q.id).pill, 'Answered');
    assert(
      !c.entries
        .find((e) => e.id === q.id)
        .answer.includes('test@example.test'),
    );
    await running.close();
    running = undefined;
    await boot('person');
    stamp = await context();
    await command('remove');
    const denied = await raw('resolveCaseLink', { context: stamp, id });
    assert.equal(denied.ok, false);
    assert.equal(
      denied.error,
      'This case is unavailable or you no longer have access.',
    );
    assert.equal((await raw('getCollaboration', { context: stamp })).ok, false);
    assert.equal((await invoke('getCases', stamp)).cases.length, 0);
    console.log(
      'PASS packaged collaboration: two accounts, real HTTP/PostgreSQL and OS encryption, Bring in replay, owner handoff, notification routing/read/settings/restart, viewer-only masked answer, removal and inaccessible links. Native banners use an injected delivery sink.',
    );
  } catch (e) {
    console.error(e);
    if (running) {
      console.error(
        'RENDERER',
        await running.window.webContents.executeJavaScript(
          'document.body.innerText',
        ),
      );
      try {
        console.error('DIRECT', await running.sync.collaboration());
      } catch (e) {
        console.error('DIRECT ERROR', e);
      }
    }
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    if (running) await running.close();
    if (cloud) {
      const exited = new Promise((r) => cloud.once('exit', r));
      cloud.disconnect();
      await exited;
    }
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    app.exit(process.exitCode ?? 0);
  }
});
