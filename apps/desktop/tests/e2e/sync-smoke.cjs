process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const assert = require('node:assert/strict');
const { app, nativeImage } = require('electron');
const { fork } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const root = resolve(__dirname, '../..'),
  directory = mkdtempSync(join(tmpdir(), 'supahelp-sync-native-'));
app.setPath('userData', join(directory, 'runner'));
app.on('window-all-closed', () => {});
let cloud, running;
const waiting = new Map();
let serial = 0;
const timer = setTimeout(() => {
  console.error('Sync native smoke timed out');
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
      console.log(`Opening independent ${token} profile`);
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
    const invoke = async (method, input) => {
      const r = await evaluate(
        `window.supahelp[${JSON.stringify(method)}](${JSON.stringify(input)})`,
      );
      assert.equal(r.ok, true, `${method}: ${r.error}`);
      return r.value;
    };
    const context = async () => (await invoke('getAccount')).context;
    await boot('owner');
    let stamp = await context();
    assert.equal(await evaluate('typeof window.require'), 'undefined');
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate('document.body.textContent.includes("Synced")')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(
      await evaluate('document.body.textContent.includes("Synced")'),
      true,
      'opening the workspace syncs automatically',
    );
    assert(
      await evaluate(
        `document.querySelector('main h1')?.textContent.startsWith('Good ')`,
      ),
    );
    assert(
      await evaluate(`!document.body.textContent.includes('Shared workspace')`),
    );
    const click = (label) =>
      evaluate(
        `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`,
      );
    const waitFor = async (expression) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail(`Timed out: ${expression}`);
    };
    const teamHome = `document.querySelector('main h1')?.textContent.startsWith('Good ') && document.body.textContent.includes('New personal chat')`;
    const composer = `!!document.querySelector('main textarea[placeholder="Ask anything, or paste a ticket link…"]')`;
    // Personal chat works inside a team workspace.
    await waitFor(teamHome);
    await waitFor(composer);
    assert.equal((await context()).context.kind, 'team');
    await evaluate(
      `document.querySelector('button[title="Switch workspace"]').click()`,
    );
    await click('Workspace settings');
    await waitFor(
      `document.querySelector('[data-settings-scroll] h1')?.textContent === 'Workspace'`,
    );
    await click('Open');
    await waitFor(teamHome);
    stamp = await context();
    await evaluate(
      `document.querySelector('aside button[aria-label$="Sync now"]').click()`,
    );
    await waitFor(
      `document.querySelector('aside button[aria-label$="Sync now"] [role="status"]')?.textContent === 'Synced'`,
    );
    await click('New shared case');
    let id;
    for (let attempt = 0; attempt < 200 && !id; attempt++) {
      id = (await invoke('getCases', stamp)).cases[0]?.id;
      if (!id) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert(id, 'the team home creates a shared case through its header');
    await invoke('editCaseEntry', {
      context: stamp,
      caseId: id,
      requestId: randomUUID(),
      action: 'add',
      value: {
        section: 'summary',
        kind: 'text',
        text: 'PACKAGED_PRIVATE_MARKER',
      },
    });
    await invoke('syncNow', stamp);
    const resolveButton = (label) =>
      `[...document.querySelectorAll('section[aria-label="Resolve and Playbooks"] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled)`;
    await waitFor(`!!${resolveButton('Draft Resolution')}`);
    await evaluate(`${resolveButton('Draft Resolution')}.click()`);
    const resolutionAlert = `document.querySelector('section[aria-label="Resolve and Playbooks"] [role="alert"]')`;
    await waitFor(
      `!!(${resolveButton('Confirm Resolve')} || ${resolutionAlert})`,
    );
    assert.equal(await evaluate(`${resolutionAlert}?.textContent`), undefined);
    assert.equal((await invoke('getCases', stamp)).cases[0].status, 'inv');
    await evaluate(`${resolveButton('Confirm Resolve')}.click()`);
    await waitFor(`!!${resolveButton('Reopen case')}`);
    const book = await invoke('savePlaybookDraft', {
      context: stamp,
      version: 0,
      content: {
        title: 'Shared packaged Playbook',
        markdown: '## Tested steps\n\nUse the confirmed screenshot.',
      },
    });
    const pixels = Buffer.from([0, 0, 0, 255]);
    const staged = running.screenshots.stage(
      book.id,
      nativeImage.createFromBitmap(pixels, { width: 1, height: 1 }).toPNG(),
    );
    const confirmed = await invoke('confirmPlaybookScreenshot', {
      context: stamp,
      id: book.id,
      version: book.version,
      screenshotId: staged.id,
    });
    await invoke('publishPlaybook', {
      context: stamp,
      id: book.id,
      version: confirmed.version,
    });
    await invoke('syncNow', stamp);
    assert.equal(
      (
        await invoke('searchDocuments', {
          context: stamp,
          text: 'confirmed screenshot',
        })
      ).playbooks[0].id,
      book.id,
    );
    assert.equal(
      (
        await invoke('searchDocuments', {
          context: stamp,
          text: 'PACKAGED_PRIVATE_MARKER',
        })
      ).cases[0].id,
      (await invoke('getCases', stamp)).cases[0].id,
    );
    const ownerId = stamp.accountId;
    await running.close();
    running = undefined;
    await boot('person');
    stamp = await context();
    const cases = await invoke('getCases', stamp);
    assert.equal(cases.cases[0].id, id);
    assert.equal(cases.cases[0].entries[0].text, 'PACKAGED_PRIVATE_MARKER');
    assert.equal(cases.cases[0].status, 'done');
    assert.equal(
      cases.cases[0].entries.find((e) => e.section === 'resolution').text,
      'Corrected the duplicate retry.',
    );
    assert.equal(
      (await invoke('getPlaybooks', { context: stamp })).resolutions.length,
      0,
    );
    await evaluate(
      `document.querySelector('button[title="Filter cases"]').click()`,
    );
    await click('All cases');
    const sharedCase = `[...document.querySelectorAll('section[aria-label="Cases"] button')].find(b => b.textContent.includes('Untitled case'))`;
    await waitFor(`!!${sharedCase}`);
    await evaluate(`${sharedCase}.click()`);
    await waitFor(
      `document.body.textContent.includes('The case owner can resolve or reopen this shared case.')`,
    );
    assert.equal(await evaluate(`!!${resolveButton('Reopen case')}`), false);
    const books = await invoke('getPlaybooks', { context: stamp });
    assert.equal(books.playbooks[0].id, book.id);
    assert.equal(books.playbooks[0].draft, undefined);
    const shot = await invoke('getPlaybookScreenshot', {
      context: stamp,
      id: book.id,
      screenshotId: staged.id,
    });
    assert.equal(shot.confirmed, true);
    await running.close();
    running = undefined;
    await boot('owner');
    stamp = await context();
    assert.equal(
      (await invoke('getCases', stamp)).cases[0].entries[0].text,
      'PACKAGED_PRIVATE_MARKER',
    );
    for (const file of readdirSync(
      join(directory, 'owner', 'team', ownerId, config.workspaceId),
    ))
      if (file !== 'key.enc')
        assert(
          !readFileSync(
            join(directory, 'owner', 'team', ownerId, config.workspaceId, file),
          ).includes(Buffer.from('PACKAGED_PRIVATE_MARKER')),
        );
    const hidden = await invoke('flagSharedDocument', {
      context: stamp,
      id: book.id,
    });
    assert(hidden.hidden.includes(book.id));
    assert.deepEqual(
      (
        await invoke('searchDocuments', {
          context: stamp,
          text: 'confirmed screenshot',
        })
      ).playbooks,
      [],
    );
    await invoke('correctSharedDocument', {
      context: stamp,
      id: book.id,
      title: 'Reviewed correction',
      text: 'Reviewed replacement without images',
    });
    const corrected = (
      await invoke('getPlaybooks', { context: stamp })
    ).playbooks.find((p) => p.id === book.id);
    assert.equal(
      corrected.published.markdown,
      'Reviewed replacement without images',
    );
    assert.equal(corrected.history.length, 0);
    assert.deepEqual(
      (
        await invoke('searchDocuments', {
          context: stamp,
          text: 'confirmed screenshot',
        })
      ).playbooks,
      [],
    );
    assert.equal(
      (
        await invoke('searchDocuments', {
          context: stamp,
          text: 'Reviewed replacement',
        })
      ).playbooks[0].id,
      book.id,
    );
    const removedImage = await evaluate(
      `window.supahelp.getPlaybookScreenshot(${JSON.stringify({ context: stamp, id: book.id, screenshotId: staged.id })})`,
    );
    assert.equal(removedImage.ok, false);
    await command('expire');
    // A search may already have started a poll using the previous lease.
    await invoke('syncNow', stamp);
    await invoke('syncNow', stamp);
    const denied = await evaluate(
      `window.supahelp.createTeamCase(${JSON.stringify(stamp)})`,
    );
    assert.equal(denied.ok, false);
    assert.equal(
      (
        await invoke('searchDocuments', {
          context: stamp,
          text: 'Reviewed replacement',
        })
      ).playbooks[0].id,
      book.id,
    );
    await running.close();
    running = undefined;
    await boot('person');
    stamp = await context();
    await command('remove');
    await invoke('syncNow', stamp);
    assert.equal((await invoke('getCases', stamp)).cases.length, 0);
    console.log(
      'PASS packaged renderer/preload: two profiles, masked shared case, shared resolution, explicit Playbook Publish, private confirmed screenshot, OS-encrypted restart, expiry and removal',
    );
  } catch (e) {
    console.error(e);
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
