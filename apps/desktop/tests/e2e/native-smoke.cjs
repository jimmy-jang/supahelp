// Run in Electron after packaging; never sends a model request.
process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, nativeTheme } = require('electron');

const root = path.resolve(__dirname, '../..');
const profile = mkdtempSync(path.join(tmpdir(), 'supahelp-smoke-'));
app.setPath('userData', profile);
require('../support/skip-quick-tour.cjs')(profile);
const development = process.env.SUPAHELP_SMOKE_MODE === 'development';
const largeLibrary = process.argv.includes('--saved-work-large');
const entry = development
  ? path.join(root, '.vite/build/main.cjs')
  : path.join(
      root,
      `out/Supahelp-${process.platform}-${process.arch}`,
      process.platform === 'darwin'
        ? 'Supahelp.app/Contents/Resources'
        : 'resources',
      'app.asar/.vite/build/main.cjs',
    );
let failures = 0;
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', () => failures++);
  contents.on('render-process-gone', () => failures++);
});
const timer = setTimeout(() => {
  console.error('Native smoke timed out');
  app.exit(1);
}, 60000);
app.on('quit', () => {
  clearTimeout(timer);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 2 });
  } catch (error) {
    // Windows can still hold a temporary profile file while Electron exits.
    if (
      process.platform !== 'win32' ||
      !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code)
    )
      throw error;
  }
});

// Regression: the SDK's import.meta.url must remain usable in the CJS bundle.
const sdkChunk = readFileSync(entry, 'utf8').match(/sdk-[\w-]+\.cjs/)?.[0];
assert.ok(sdkChunk, 'main references its bundled SDK chunk');
assert.equal(
  typeof require(path.join(path.dirname(entry), sdkChunk)).query,
  'function',
);
const loaded = (async () => {
  const fixture = new DatabaseSync(':memory:');
  try {
    fixture.exec('CREATE VIRTUAL TABLE probe USING fts5(title)');
  } finally {
    fixture.close();
  }
  const { CaseStore } = await import(
    pathToFileURL(path.join(root, 'src/main/features/cases/store.ts')).href
  );
  const directory = path.join(profile, 'personal', 'guest');
  mkdirSync(directory, { recursive: true });
  const store = new CaseStore(path.join(directory, 'cases.db'));
  store.ready = true;
  try {
    for (const [id, title] of [
      ['saved-work-source', 'Investigating database timeout'],
      ['saved-work-target', 'Resolved database timeout'],
    ]) {
      store.insertCase({
        id,
        title,
        workspaceId: 'personal',
        ownerId: 'local',
        ticket: '',
        chatId: id,
        at: '2026-11-25',
      });
    }
    store.setResolved('saved-work-target', true, '2026-11-25');
    store.books.savePlaybook(
      {
        id: 'saved-work-book',
        ownerId: 'local',
        workspaceId: 'personal',
        version: 1,
        updatedAt: '2026-11-25',
        publishedAt: '2026-11-25',
        published: {
          title: 'Database recovery',
          markdown: 'Review timeout settings.\n\nLook for error WINQZX-7902.',
        },
      },
      0,
    );
    if (largeLibrary) {
      store.transaction(() => {
        for (let i = 0; i < 9997; i++) {
          const id = `saved-work-fixture-${i}`;
          store.insertCase({
            id,
            workspaceId: 'personal',
            ownerId: 'local',
            title: `Synthetic reference ${i}`,
            ticket: '',
            chatId: id,
            at: '2026-11-25',
          });
          store.setResolved(id, true, '2026-11-25');
        }
      });
    }
  } finally {
    store.close();
  }
  require(entry);
})();

async function waitFor(run) {
  for (let i = 0; i < 200; i++) {
    const result = await run();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Native smoke condition timed out');
}

app.whenReady().then(async () => {
  try {
    await loaded;
    const window = await waitFor(() => BrowserWindow.getAllWindows()[0]);
    const evaluate = (expression) =>
      window.webContents.executeJavaScript(expression);
    await waitFor(() => evaluate('!!window.supahelp').catch(() => false));
    assert.equal(
      window.webContents.getURL().startsWith(development ? 'http:' : 'file:'),
      true,
    );
    assert.equal(await evaluate('typeof window.require'), 'undefined');
    assert.equal(await evaluate('typeof window.process'), 'undefined');
    const preferences = window.webContents.getLastWebPreferences();
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.nodeIntegration, false);
    await waitFor(() =>
      evaluate(
        '[...document.querySelectorAll("button")].some(button=>button.textContent.includes("Ask first"))',
      ),
    );
    const verifySavedWork = async () => {
      const search = (text) =>
        evaluate(
          `window.supahelp.getAccount().then((account) => window.supahelp.searchDocuments({context: account.value.context, text: ${JSON.stringify(text)}}))`,
        );
      const pending = search('database timeout');
      if (largeLibrary) {
        let done = false;
        void pending.finally(() => {
          done = true;
        });
        const composer = await evaluate(`(() => {
          const field = document.querySelector('textarea');
          field.focus();
          return document.activeElement === field && !field.disabled;
        })()`);
        assert.equal(composer, true, 'the composer takes focus while indexing');
        assert.equal(
          done,
          false,
          'the renderer took focus before the backfill finished',
        );
      }
      const related = await pending;
      assert.equal(related.ok, true, related.error);
      assert.equal(related.value.cases[0].id, 'saved-work-target');
      const errorCode = await search('WINQZX-7902');
      assert.equal(errorCode.value.playbooks[0].id, 'saved-work-book');
      assert.deepEqual((await search('savedworknomatch')).value, {
        cases: [],
        playbooks: [],
      });
      await evaluate(
        `[...document.querySelectorAll('section[aria-label="Cases"] button')].find((button) => button.textContent.includes('Investigating database timeout')).click()`,
      );
      await waitFor(() =>
        evaluate(
          `document.querySelector('aside[aria-label^="Case"]')?.textContent.includes('Resolved database timeout')`,
        ),
      );
    };
    if (process.argv.includes('--saved-work-only')) {
      await verifySavedWork();
      console.log(
        `Packaged saved-work smoke passed on ${process.platform}/${process.arch}: FTS5, IPC, and Seen before search.`,
      );
      app.exit(0);
      return;
    }
    const checkAttachmentPickers = async (screen) => {
      for (const kind of ['case', 'playbook']) {
        await evaluate(
          '[...document.querySelectorAll("button")].find(button=>button.textContent.includes("Attach files")).click()',
        );
        await evaluate(
          `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Add a ${kind}').click()`,
        );
        await waitFor(() =>
          evaluate('!!document.querySelector("dialog[open]")'),
        );
        assert.equal(
          await evaluate(`document.querySelector('dialog h2').textContent`),
          `Add a ${kind}`,
          `${screen} exposes the ${kind} picker`,
        );
        assert.equal(await evaluate('document.activeElement.tagName'), 'INPUT');
        await evaluate(
          `[...document.querySelectorAll('dialog button')].find(button=>button.textContent.trim()==='Cancel').click()`,
        );
        await waitFor(() =>
          evaluate('!document.querySelector("dialog[open]")'),
        );
      }
    };
    await checkAttachmentPickers('New chat');
    await evaluate(
      '[...document.querySelectorAll("button")].find(button=>button.textContent.includes("Ask first")).click()',
    );
    assert.equal(
      await evaluate(
        'document.querySelector(":popover-open").textContent.includes("Skip confirmation")',
      ),
      true,
    );
    await evaluate(
      '[...document.querySelectorAll(":popover-open button")].find(button=>button.textContent.includes("Skip confirmation")).click()',
    );
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("button")].some(button=>button.textContent.includes("Skip confirmation"))',
      ),
      true,
    );
    await evaluate(
      '[...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="Project").click()',
    );
    assert.equal(
      await evaluate(
        'document.querySelector(":popover-open").textContent.includes("Use an existing folder")',
      ),
      true,
    );
    assert.equal(
      await evaluate(
        'document.querySelector(":popover-open").textContent.includes("Start from scratch")',
      ),
      false,
    );
    await evaluate('document.querySelector(":popover-open").hidePopover()');
    await evaluate(
      '[...document.querySelectorAll("button")].find(button=>button.textContent.includes("Attach files")).click()',
    );
    assert.equal(
      await evaluate(
        'document.querySelector(":popover-open").textContent.includes("Upload photos & files")',
      ),
      true,
    );
    await evaluate('document.querySelector(":popover-open").hidePopover()');
    for (const appearance of ['light', 'dark']) {
      nativeTheme.themeSource = appearance;
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        await evaluate(
          `(() => {
            const headings = [...document.querySelectorAll('h1')].filter(el => el.checkVisibility());
            const composer = document.querySelector('textarea[placeholder="Ask anything, or paste a ticket link…"]');
            return headings.length === 1 && /^Good (morning|afternoon|evening)$/.test(headings[0].textContent.trim())
              && !!composer?.checkVisibility() && !composer.disabled
              && matchMedia('(prefers-color-scheme: dark)').matches === ${appearance === 'dark'};
          })()`,
        ),
        true,
        `Home greeting and composer render in ${appearance} mode`,
      );
      writeFileSync(
        path.join(tmpdir(), `supahelp-composer-${appearance}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    const state = await evaluate('window.supahelp.getChats()');
    assert.equal(
      await evaluate('typeof window.supahelp.editCaseEntry'),
      'function',
    );
    assert.equal(
      await evaluate('typeof window.supahelp.cancelCaseEdit'),
      'function',
    );
    assert.equal(
      (await evaluate('window.supahelp.editCaseEntry({})')).ok,
      false,
    );
    const pilot = (name) =>
      evaluate(
        `window.supahelp.getAccount().then(a=>window.supahelp[${JSON.stringify(name)}]({context:a.value.context}))`,
      );
    await evaluate(
      'window.supahelp.getAccount().then(a=>window.supahelp.getCases(a.value.context))',
    );
    assert.equal((await pilot('getPilotMetrics')).value.state, 'off');
    assert.equal((await pilot('startPilotMetrics')).value.state, 'collecting');
    assert.equal((await pilot('finishPilotMetrics')).value.state, 'finished');
    const pilotDialog = require('electron').dialog,
      originalSaveDialog = pilotDialog.showSaveDialog;
    const exported = path.join(profile, 'pilot-counts.json');
    try {
      pilotDialog.showSaveDialog = async () => ({ canceled: true });
      assert.equal((await pilot('exportPilotMetrics')).value, 'cancelled');
      writeFileSync(exported, 'previous file');
      pilotDialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: exported,
      });
      assert.equal((await pilot('exportPilotMetrics')).value, 'saved');
      const report = JSON.parse(readFileSync(exported, 'utf8'));
      assert.equal(Object.keys(report.counts).length, 10);
      assert.ok(Object.values(report.counts).every((n) => n === 0));
      assert.equal(require('node:fs').statSync(exported).mode & 0o777, 0o600);
      assert.ok(
        !require('node:fs')
          .readdirSync(profile)
          .some((n) => n.endsWith('.tmp')),
      );
      pilotDialog.showSaveDialog = async () => {
        await pilot('deletePilotMetrics');
        return { canceled: false, filePath: exported };
      };
      assert.equal((await pilot('exportPilotMetrics')).ok, false);
      assert.deepEqual(JSON.parse(readFileSync(exported, 'utf8')), report);
    } finally {
      pilotDialog.showSaveDialog = originalSaveDialog;
    }
    assert.equal((await pilot('getPilotMetrics')).value.state, 'off');
    const connections = await evaluate('window.supahelp.getConnections()');
    assert.equal(connections.ok, true, connections.error);
    assert.equal(connections.value.connections.length, 31);
    assert.deepEqual(connections.value.pendingReview, [
      'zendesk',
      'intercom',
      'teams',
      'front',
      'stripe',
    ]);
    assert.ok(
      connections.value.connections.every(
        (connection) => connection.state === 'disconnected',
      ),
    );
    assert.equal(
      (
        await evaluate(
          'window.supahelp.connectConnection({id:"invented",access:"read",values:{}})',
        )
      ).ok,
      false,
    );
    const zendesk = await evaluate('window.supahelp.getZendesk()');
    assert.equal(zendesk.ok, true, zendesk.error);
    assert.equal(zendesk.value.state, 'disconnected');
    assert.deepEqual(zendesk.value.scopes, []);
    assert.equal(
      (
        await evaluate(
          'window.supahelp.connectZendesk({site:"https://evil.example",clientId:"invalid",access:"read"})',
        )
      ).ok,
      false,
    );
    assert.equal(state.ok, true, state.error);
    assert.deepEqual(state.value.chats, []);
    const status = await evaluate('window.supahelp.getClaudeStatus()');
    assert.equal(status.ok, true);
    const models = await evaluate('window.supahelp.getModelsSettings()');
    assert.equal(models.ok, true, models.error);
    assert.deepEqual(
      models.value.providers.map((provider) => provider.id),
      ['claude', 'chatgpt'],
    );
    for (const expression of [
      'window.supahelp.connectProvider("invalid")',
      'window.supahelp.disconnectProvider("invalid")',
      'window.supahelp.setDefaultModel({provider:"chatgpt",model:"invalid/model"})',
    ])
      assert.equal((await evaluate(expression)).ok, false);
    assert.ok(
      ['ready', 'missing', 'signed-out', 'unsupported', 'error'].includes(
        status.value.state,
      ),
    );
    assert.equal(
      await evaluate(
        'window.supahelp.sendMessage({chatId:"fixture",text:"hello"})',
      ).then((result) => result.ok),
      false,
    );
    assert.equal(
      await evaluate('window.supahelp.setClaudeModel("invalid")').then(
        (result) => result.ok,
      ),
      false,
    );
    await evaluate('window.supahelp.setClaudeModel("haiku")');
    assert.equal(
      JSON.parse(readFileSync(path.join(profile, 'claude.json'), 'utf8')).model,
      'haiku',
    );
    await evaluate(
      'window.dispatchEvent(new KeyboardEvent("keydown", {key:",",metaKey:true}))',
    );
    await waitFor(() =>
      evaluate(
        '[...document.querySelectorAll("button")].some(button=>button.textContent.trim()==="Models")',
      ),
    );
    await evaluate(
      '[...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="Models").click()',
    );
    await waitFor(() =>
      evaluate(
        `!document.querySelector('[aria-label="Claude options"]').disabled`,
      ),
    );
    assert.equal(
      await evaluate(
        `!!document.querySelector('select[aria-label="Model for new chats"]')`,
      ),
      false,
    );
    await evaluate(
      `document.querySelector('[aria-label="Claude options"]').click()`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('#provider-claude').matches(':popover-open')`,
      ),
      true,
    );
    const position = await evaluate(
      `(() => {const r=document.querySelector('#provider-claude').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};})()`,
    );
    assert.ok(
      position.x >= 0 &&
        position.y > 0 &&
        position.right < 1440 &&
        position.bottom < 900,
    );
    await evaluate(`document.querySelector('#provider-claude').hidePopover()`);
    // Normal Models setup: draft cancellation, paid billing disclosure, encrypted save and disconnect.
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Set up').click()`,
    );
    await waitFor(() =>
      evaluate(
        `!!document.querySelector('input[aria-label="Personal API key"]')`,
      ),
    );
    assert.equal(
      await evaluate(
        `document.querySelector('input[aria-label="Personal API key"]').type`,
      ),
      'password',
    );
    assert.equal(
      await evaluate(`document.body.textContent.includes('Paid API usage')`),
      true,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('select[aria-label="Authentication and billing"]').options.length`,
      ),
      2,
    );
    const fillKey = async () =>
      evaluate(`(() => {
      const input = document.querySelector('input[aria-label="Personal API key"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'synthetic-personal-api-key-smoke');
      input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await evaluate(
      `(() => {const s=document.querySelector('select[aria-label="Authentication and billing"]');s.value='Claude subscription';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await waitFor(() =>
      evaluate(
        `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Continue with Claude')`,
      ),
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continue with Claude').click()`,
    );
    await waitFor(() =>
      evaluate(
        `document.querySelector('[role="alert"]')?.textContent.includes('disabled for automated tests')`,
      ),
    );
    await evaluate(
      `(() => {const s=document.querySelector('select[aria-label="Authentication and billing"]');s.value='API key';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await fillKey();
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Close').click()`,
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Set up').click()`,
    );
    await waitFor(() =>
      evaluate(
        `document.querySelector('input[aria-label="Personal API key"]')?.value === ''`,
      ),
    );
    await fillKey();
    await waitFor(() =>
      evaluate(
        `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Save API key' && !b.disabled)`,
      ),
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save API key').click()`,
    );
    await waitFor(() =>
      evaluate(`document.body.textContent.includes('API key saved.')`),
    );
    const encrypted = readFileSync(
      path.join(profile, 'model-credentials/claude.enc'),
    );
    assert.equal(
      encrypted.includes(Buffer.from('synthetic-personal-api-key-smoke')),
      false,
    );
    const { safeStorage } = require('electron');
    const stored = JSON.parse(
      (await safeStorage.decryptStringAsync(encrypted)).result,
    );
    assert.equal(stored.key, 'synthetic-personal-api-key-smoke');
    const keySettings = await evaluate('window.supahelp.getModelsSettings()');
    assert.equal(keySettings.ok, true);
    assert.equal(keySettings.value.providers[0].authentication, 'api-key');
    assert.equal(JSON.stringify(keySettings).includes(stored.key), false);
    await waitFor(() =>
      evaluate(
        `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Disconnect' && !b.disabled)`,
      ),
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Disconnect').click()`,
    );
    await waitFor(async () => {
      const bytes = readFileSync(
        path.join(profile, 'model-credentials/claude.enc'),
      );
      return (
        JSON.parse((await safeStorage.decryptStringAsync(bytes)).result)
          .mode === 'disconnected'
      );
    });
    const disconnected = JSON.parse(
      (
        await safeStorage.decryptStringAsync(
          readFileSync(path.join(profile, 'model-credentials/claude.enc')),
        )
      ).result,
    );
    assert.equal(disconnected.key, undefined);
    await waitFor(() =>
      evaluate(
        `!document.querySelector('[aria-label="ChatGPT options"]').disabled`,
      ),
    );
    await evaluate(
      `[...document.querySelector('[aria-label="ChatGPT options"]').parentElement.children].find(b => b.textContent.trim() === 'Set up').click()`,
    );
    await waitFor(() =>
      evaluate(
        `document.querySelector('select[aria-label="Authentication and billing"]')?.options.length === 2`,
      ),
    );
    await evaluate(
      `(() => { const select=document.querySelector('select[aria-label="Authentication and billing"]'); select.value='ChatGPT subscription'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
    );
    await waitFor(() =>
      evaluate(
        `document.body.textContent.includes('does not permit this mechanism for commercial or hosted services')`,
      ),
    );
    assert.equal(
      await evaluate(
        `!!document.querySelector('input[aria-label="Personal API key"]')`,
      ),
      false,
    );
    await evaluate(
      `(() => { const select=document.querySelector('select[aria-label="Authentication and billing"]'); select.value='API key'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`,
    );
    await fillKey();
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save API key').click()`,
    );
    await waitFor(async () => {
      const result = await evaluate('window.supahelp.getModelsSettings()');
      return (
        result.ok && result.value.providers[1].authentication === 'api-key'
      );
    });
    assert.equal(
      readFileSync(
        path.join(profile, 'model-credentials/chatgpt.enc'),
      ).includes(Buffer.from(stored.key)),
      false,
    );
    await waitFor(() =>
      evaluate(
        `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Disconnect' && !b.disabled)`,
      ),
    );
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Disconnect').click()`,
    );
    await waitFor(
      async () =>
        JSON.parse(
          (
            await safeStorage.decryptStringAsync(
              readFileSync(path.join(profile, 'model-credentials/chatgpt.enc')),
            )
          ).result,
        ).mode === 'disconnected',
    );
    for (const appearance of ['light', 'dark']) {
      nativeTheme.themeSource = appearance;
      await new Promise((resolve) => setTimeout(resolve, 150));
      writeFileSync(
        path.join(
          tmpdir(),
          `supahelp-models-${development ? 'development' : 'packaged'}-${appearance}.png`,
        ),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    // Fixture catalog exercises selection without making a paid model request.
    const { ipcMain, dialog } = require('electron');
    const accountContext = (await evaluate('window.supahelp.getAccount()'))
      .value.context;
    ipcMain.removeHandler('models:settings');
    ipcMain.handle('models:settings', () => ({
      ok: true,
      value: {
        context: accountContext,
        providers: [
          { id: 'claude', state: 'ready' },
          { id: 'chatgpt', state: 'ready' },
        ],
        models: [
          {
            provider: 'claude',
            model: 'sonnet',
            label: 'Test Sonnet',
            efforts: ['low', 'medium', 'high'],
          },
          {
            provider: 'chatgpt',
            model: 'gpt-test',
            label: 'Test GPT',
            efforts: ['medium', 'high'],
          },
        ],
        selected: { provider: 'claude', model: 'sonnet' },
      },
    }));
    await evaluate('window.location.reload()');
    await waitFor(() =>
      evaluate(
        '[...document.querySelectorAll("button")].some(button=>button.textContent.includes("Test Sonnet"))',
      ).catch(() => false),
    );
    await evaluate(
      '[...document.querySelectorAll("button")].find(button=>button.textContent.includes("Test Sonnet")).click()',
    );
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll(":popover-open button")].some(button=>button.textContent.includes("Default"))',
      ),
      false,
    );
    const bounds = await evaluate(
      '(() => { const r = document.querySelector(":popover-open").getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:innerWidth, height:innerHeight }; })()',
    );
    assert.ok(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.right <= bounds.width &&
        bounds.bottom <= bounds.height,
    );
    writeFileSync(
      path.join(tmpdir(), 'supahelp-model-picker.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    await evaluate(
      '[...document.querySelectorAll(":popover-open button")].find(button=>button.textContent.includes("Test GPT")).click()',
    );
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("button")].some(button=>button.textContent.trim()==="medium")',
      ),
      true,
    );
    await evaluate(
      '[...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="medium").click()',
    );
    await evaluate(
      '[...document.querySelectorAll(":popover-open button")].find(button=>button.textContent.trim()==="high").click()',
    );
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("button")].some(button=>button.textContent.trim()==="high")',
      ),
      true,
    );
    const note = path.join(profile, 'context.txt');
    writeFileSync(note, 'fixture context');
    const originalDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [note],
    });
    await evaluate(
      '[...document.querySelectorAll("button")].find(button=>button.textContent.includes("Attach files")).click()',
    );
    await evaluate(
      '[...document.querySelectorAll(":popover-open button")].find(button=>button.textContent.includes("Upload photos")).click()',
    );
    await waitFor(() =>
      evaluate(`!!document.querySelector('[aria-label="Remove context.txt"]')`),
    );
    assert.equal(
      await evaluate(`document.querySelector('[aria-label="Send"]').disabled`),
      false,
    );
    await evaluate(
      `document.querySelector('[aria-label="Remove context.txt"]').click()`,
    );
    dialog.showOpenDialog = originalDialog;
    let submitted;
    ipcMain.removeHandler('chat:send');
    ipcMain.handle('chat:send', (_event, request) => {
      const message = request.input;
      submitted = message;
      window.webContents.send('chat:changed', {
        context: accountContext,
        revision: message.chatId ? 102 : 100,
        chats: [
          {
            id: 'gpt-chat',
            title: 'GPT reply test',
            status: 'running',
            model: 'gpt-test',
            options: message.options,
            messages: [
              { role: 'user', text: message.text },
              { role: 'assistant', text: '' },
            ],
          },
        ],
      });
      return { ok: true, value: 'gpt-chat' };
    });
    const checkPromptFormatting = async (text) => {
      await evaluate(`document.querySelector('textarea').focus()`);
      await window.webContents.insertText(text);
      assert.equal(
        await evaluate(`document.querySelector('textarea').value`),
        text,
      );
      await waitFor(() =>
        evaluate(`!document.querySelector('[aria-label="Send"]').disabled`),
      );
      await evaluate(`document.querySelector('[aria-label="Send"]').click()`);
      await waitFor(() => submitted?.text === text);
      await waitFor(() =>
        evaluate(`[...document.querySelectorAll('div.select-text')].some(
          el => el.textContent === ${JSON.stringify(text)} && getComputedStyle(el).whiteSpace === 'pre-wrap'
        )`),
      );
    };
    await checkPromptFormatting(
      '  Hello GPT\n\n1. Check the saved view\n   - Verify Date\n',
    );
    await waitFor(() =>
      evaluate(`!!document.querySelector('[role="status"]')`),
    );
    assert.deepEqual(submitted.options.selection, {
      provider: 'chatgpt',
      model: 'gpt-test',
    });
    assert.equal(
      await evaluate(`document.querySelector('[role="status"]').textContent`),
      'ChatGPT is replying…',
    );
    assert.equal(
      await evaluate(`document.body.textContent.includes('Model settings')`),
      false,
    );
    window.webContents.send('chat:changed', {
      context: accountContext,
      revision: 101,
      chats: [
        {
          id: 'gpt-chat',
          title: 'GPT reply test',
          status: 'idle',
          model: 'gpt-test',
          options: submitted.options,
          messages: [
            { role: 'user', text: submitted.text },
            { role: 'assistant', text: 'Fixture reply' },
          ],
        },
      ],
    });
    await waitFor(() =>
      evaluate(`!document.querySelector('[aria-label="Stop reply"]')`),
    );
    await checkAttachmentPickers('Existing chat');
    await checkPromptFormatting(
      '  Follow-up\n\n1. Export again\n   - Verify the result\n',
    );
    assert.equal(submitted.chatId, 'gpt-chat');
    const history = Array.from(
      { length: 80 },
      (_, i) => `Conversation history line ${i + 1}`,
    ).join('\n');
    const publishHistory = (revision, title, text, status = 'idle') =>
      window.webContents.send('chat:changed', {
        context: accountContext,
        revision,
        chats: [
          {
            id: 'gpt-chat',
            title,
            status,
            model: 'gpt-test',
            options: submitted.options,
            messages: [
              { role: 'user', text: submitted.text },
              { role: 'assistant', text },
            ],
          },
        ],
      });
    const transcript = `document.querySelector('p.select-text').closest('.overflow-y-auto')`;
    const scrollPosition = () => evaluate(`${transcript}.scrollTop`);
    const distanceFromLatest = () =>
      evaluate(`(() => {
        const el = ${transcript};
        return el.scrollHeight - el.clientHeight - el.scrollTop;
      })()`);
    publishHistory(103, 'GPT reply test', history);
    await waitFor(() =>
      evaluate(
        `document.body.textContent.includes('Conversation history line 80')`,
      ),
    );
    await waitFor(async () => (await distanceFromLatest()) <= 24);
    const readingPosition = await evaluate(`(async () => {
      const el = ${transcript};
      el.scrollTop = 10;
      await new Promise(requestAnimationFrame);
      return el.scrollTop;
    })()`);
    assert.equal(readingPosition, 10, 'the chat has scrollable history');
    publishHistory(104, 'Renamed GPT reply test', history);
    await waitFor(() =>
      evaluate(`document.body.textContent.includes('Renamed GPT reply test')`),
    );
    assert.equal(
      await scrollPosition(),
      readingPosition,
      'an idle chat update preserves the reading position',
    );
    const partialReply = `${history}\nA reply is arriving`;
    publishHistory(105, 'Renamed GPT reply test', partialReply, 'running');
    await waitFor(() =>
      evaluate(`document.body.textContent.includes('A reply is arriving')`),
    );
    assert.equal(
      await scrollPosition(),
      readingPosition,
      'an incoming reply preserves the reading position',
    );
    await evaluate(`(async () => {
      const el = ${transcript};
      el.scrollTop = el.scrollHeight;
      await new Promise(requestAnimationFrame);
    })()`);
    publishHistory(
      106,
      'Renamed GPT reply test',
      `${partialReply}\nThe reply is complete`,
    );
    await waitFor(() =>
      evaluate(`document.body.textContent.includes('The reply is complete')`),
    );
    await waitFor(async () => (await distanceFromLatest()) <= 1);
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true }))`,
    );
    assert.equal(
      await evaluate(
        `document.body.textContent.includes('Connect a model provider')`,
      ),
      false,
    );
    await verifySavedWork();
    // macOS keeps the primary process alive after its last window closes.
    if (process.platform === 'darwin') {
      window.close();
      await waitFor(() => BrowserWindow.getAllWindows().length === 0);
      app.emit('second-instance', {}, []);
      const reopened = await waitFor(() => BrowserWindow.getAllWindows()[0]);
      await waitFor(() =>
        reopened.webContents
          .executeJavaScript(
            '!!window.supahelp && !!document.querySelector("textarea")',
          )
          .catch(() => false),
      );
      assert.equal(reopened.isVisible(), true);
      assert.equal(
        (
          await reopened.webContents.executeJavaScript(
            'window.supahelp.getChats()',
          )
        ).ok,
        true,
      );
    }
    assert.equal(failures, 0);
    console.log(
      `Native ${development ? 'development' : 'packaged'} smoke passed: SDK, preload, isolation, IPC, settings and renderer, and FTS5 Seen before search.`,
    );
    app.quit();
  } catch (error) {
    console.error(error.stack);
    app.exit(1);
  }
});
