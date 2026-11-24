// Real inference is API-key only; subscription credentials never enter test profiles.
process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const assert = require('node:assert/strict');
const { app } = require('electron');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir, homedir } = require('node:os');
const { randomUUID } = require('node:crypto');
const restart = process.argv.includes('--verify-restart');
if (process.argv.includes('--claude-subscription'))
  throw Error('Subscription inference is disabled in automated tests.');
if (!restart && !process.argv.includes('--real-inference'))
  throw Error('Pass --real-inference to authorize bounded usage.');
const root = resolve(__dirname, '../..');
const profile = restart
  ? process.argv[process.argv.indexOf('--profile') + 1]
  : fs.mkdtempSync(join(tmpdir(), 'supahelp-live-provider-'));
assert.ok(
  profile && /\/supahelp-live-provider-[a-zA-Z0-9]+$/.test(profile),
  'Disposable profile required',
);
fs.chmodSync(profile, 0o700);
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const source = join(homedir(), 'Library/Application Support/Supahelp');
if (!restart) {
  if (fs.existsSync(join(source, 'model-credentials')))
    fs.cpSync(
      join(source, 'model-credentials'),
      join(profile, 'model-credentials'),
      { recursive: true },
    );
}
const report = { profile, requests: [], checks: [], results: {} };
let running;
const timer = setTimeout(() => {
  console.error('Live run timeout', profile);
  fs.rmSync(join(profile, 'codex/auth.json'), { force: true });
  fs.rmSync(join(profile, 'model-credentials'), {
    recursive: true,
    force: true,
  });
  app.exit(1);
}, 12 * 60000);
const record = (name, result) => {
  report.results[name] = result;
  console.log(name, JSON.stringify(result));
};
app.whenReady().then(async () => {
  try {
    const boot = () =>
      require(join(tmpdir(), 'supahelp-case-e2e/app.cjs')).boot(
        profile,
        join(
          root,
          `out/Supahelp-${process.platform}-${process.arch}/Supahelp.app/Contents/Resources/app.asar`,
        ),
        undefined,
        {
          realProviders: true,
          playbookExport: join(profile, 'playbook.md'),
        },
      );
    running = await boot();
    const evaluate = (code) =>
      running.window.webContents.executeJavaScript(code, true);
    const raw = (name, args = {}) =>
      evaluate(
        `window.supahelp.getAccount().then(a=>window.supahelp[${JSON.stringify(name)}]({...${JSON.stringify(args)},context:a.value.context}))`,
      );
    const api = async (name, args) => {
      const r = await raw(name, args);
      assert.equal(r.ok, true, `${name}: ${r.error}`);
      return r.value;
    };
    const wait = async (fn, ms = 120000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error('Condition timed out');
    };
    await wait(() => evaluate('!!window.supahelp'));
    if (restart) {
      const saved = await api('getPlaybooks');
      const cases = running.cases.snapshot().cases;
      assert.equal(cases.length, 1);
      assert.equal(cases[0].status, 'done');
      assert.ok(cases[0].changes.some((c) => c.undoneAt));
      assert.ok(saved.playbooks[0].published.markdown.includes('idempotency'));
      assert.equal(saved.playbooks[0].history.length, 1);
      assert.equal(saved.playbooks[0].draft, undefined);
      assert.equal(running.chats.snapshot().chats.length, 0);
      const documents = JSON.stringify({ cases, saved });
      for (const value of [
        'Mara Velliston',
        '47 Kowhai Crescent',
        'Velvet Otter Labs',
        'mara.velliston@example.test',
      ])
        assert.ok(!documents.includes(value));
      await wait(() =>
        evaluate(
          `[...document.querySelectorAll('button')].some(b => b.textContent.includes(${JSON.stringify(cases[0].title)}))`,
        ),
      );
      await evaluate(
        `[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(cases[0].title)})).click()`,
      );
      await wait(() =>
        evaluate("document.body.textContent.includes('HTTP 409')"),
      );
      await evaluate(
        `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(saved.playbooks[0].published.title)}).click()`,
      );
      await wait(() =>
        evaluate("document.body.textContent.includes('Unknowns')"),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      await wait(() =>
        evaluate(
          'document.documentElement.scrollWidth <= document.documentElement.clientWidth',
        ),
      );
      fs.writeFileSync(
        join(profile, 'published-ui.png'),
        (await running.window.webContents.capturePage()).toPNG(),
      );
      record('separate-process-restart', 'PASS');
      return;
    }
    const settings = await running.models.settings();
    record(
      'providers',
      settings.providers.map(({ id, state, message }) => ({
        id,
        state,
        message,
      })),
    );
    record('catalog', settings.models);
    for (const [id, provider] of [
      ['claude', running.models.claude],
      ['chatgpt', running.models.codex],
    ]) {
      const open = provider.open.bind(provider);
      provider.open = (...args) => {
        assert.ok(report.requests.length < 18, '18-session inference budget');
        const entry = {
          provider: id,
          model: args[0],
          purpose: args[3] ?? 'chat',
          started: new Date().toISOString(),
        };
        report.requests.push(entry);
        const session = open(...args),
          reply = session.reply.bind(session);
        session.reply = async function* (...input) {
          try {
            for await (const output of reply(...input)) {
              if (output.type === 'text')
                entry.output = (entry.output ?? '') + output.text;
              yield output;
            }
            entry.completed = true;
          } catch (e) {
            entry.error = e.message;
            throw e;
          } finally {
            entry.ended = new Date().toISOString();
          }
        };
        return session;
      };
    }
    const ready = settings.providers.filter(
      (p) => p.state === 'ready' && p.authentication === 'api-key',
    );
    assert.ok(ready.length, 'No already connected supported providers');
    for (const provider of ready) {
      const catalog = settings.models.filter((m) => m.provider === provider.id);
      const model =
        catalog.find((m) => m.model === 'gpt-5.4-mini') ??
        catalog.find((m) => m.model === 'sonnet') ??
        catalog[0];
      const selection = { provider: provider.id, model: model.model };
      await running.models.select(selection);
      const send = async (text, chatId) => {
        const r = await evaluate(
          `window.supahelp.sendMessage(${JSON.stringify({ text, chatId, options: { selection } })})`,
        );
        assert.equal(r.ok, true, r.error);
        await wait(
          () =>
            running.chats.snapshot().chats.find((c) => c.id === r.value)
              ?.status === 'idle',
        );
        const chat = running.chats
          .snapshot()
          .chats.find((c) => c.id === r.value);
        record('chat-' + report.requests.length, chat);
        assert.equal(chat.error, undefined, chat.error);
        assert.ok(
          !chat.messages.some((m) => m.role === 'error'),
          'Chat provider error',
        );
        return r.value;
      };
      const secrets = [
        'Mara Velliston',
        '47 Kowhai Crescent',
        'mara.velliston@example.test',
        '+64 21 555 0198',
        '4242 4242 4242 4242',
        'sk-test-synthetic-987654321',
        'Velvet Otter Labs',
      ];
      const customer = `Customer Mara Velliston of Velvet Otter Labs, 47 Kowhai Crescent, Dunedin 9016, New Zealand; mara.velliston@example.test; phone +64 21 555 0198; card 4242 4242 4242 4242; api_key=sk-test-synthetic-987654321.`;
      const chatId = await send(
        `Synthetic support exercise only. ${customer} Ticket ZD #731204. Duplicate invoice requests returned HTTP 409 after 30 seconds. A stale idempotency key was reused. In a synthetic test using a fresh key fixed the retry and returned HTTP 200. The customer was told to generate one key per operation and reuse that key only for retries of the same operation. Briefly summarize these supplied facts; do not claim you performed any checks or external action.`,
      );
      const caseId = await api('createCase', { chatId });
      await send(
        `Use the attached case tools now. Read the case and add exactly one summary text entry recording these supplied facts: ${customer} Duplicate invoice requests returned HTTP 409 after 30 seconds because a stale idempotency key was reused. A synthetic test with a fresh key returned HTTP 200. The customer was told to use one key per operation. Do not perform any external action.`,
        chatId,
      );
      let c = running.cases.snapshot().cases.find((c) => c.id === caseId);
      record('ai-case', c);
      assert.ok(c.entries.length > 0, 'AI did not write the attached case');
      const entry = c.entries.find((e) => e.section === 'summary');
      assert.ok(entry, 'AI summary entry missing');
      await api('editCaseEntry', {
        caseId,
        action: 'update',
        requestId: randomUUID(),
        entryId: entry.id,
        version: entry.version,
        value: {
          section: 'summary',
          kind: 'text',
          text: `${customer} Manual correction: timeout was 45 seconds, not 30. HTTP 409 reproduced with a stale idempotency key; a fresh key returned HTTP 200 in the synthetic test. Customer was told one key per operation.`,
        },
      });
      c = running.cases.snapshot().cases.find((c) => c.id === caseId);
      record('manual-case', c);
      const change = c.changes[0];
      await api('undoCaseChange', { caseId, changeId: change.id });
      c = running.cases.snapshot().cases.find((c) => c.id === caseId);
      record('undo-case', c);
      assert.ok(c.changes.some((h) => h.id === change.id && h.undoneAt));
      const resolution = await api('draftResolution', {
        caseId,
        chatId,
        requestId: randomUUID(),
      });
      record('resolution', resolution);
      assert.equal(
        running.cases.snapshot().cases.find((c) => c.id === caseId).status ===
          'done',
        false,
      );
      await api('confirmResolve', {
        id: resolution.id,
        version: resolution.version,
        chatId,
      });
      const book = await api('draftCasePlaybook', { id: resolution.id });
      record('playbook-draft', book);
      assert.ok(book.draft.markdown.length > 0 && !book.published);
      const published = await api('publishPlaybook', {
        id: book.id,
        version: book.version,
      });
      await api('exportPlaybook', { id: book.id, version: published.version });
      await api('savePlaybookDraft', {
        id: book.id,
        version: published.version,
        content: {
          title: published.published.title,
          markdown:
            published.published.markdown +
            `\n\nReviewed by Mara Velliston at 47 Kowhai Crescent. Contact mara.velliston@example.test. Keep ticket ZD #731204 and HTTP 409.`,
        },
      });
      let updated = (await api('getPlaybooks')).playbooks.find(
        (p) => p.id === book.id,
      );
      await api('publishPlaybook', {
        id: updated.id,
        version: updated.version,
      });
      await api('setChatPlaybooks', { chatId, playbookIds: [book.id] });
      await send(
        'Read the attached published Playbook using its tool, then quote the step that prevents duplicate retries. Do not update the case or perform any action.',
        chatId,
      );
      // Cancel a real masking operation after opening the provider session.
      const count = report.requests.length;
      const before = JSON.stringify(running.cases.snapshot().cases);
      const pending = raw('editCaseEntry', {
        caseId,
        action: 'update',
        requestId: randomUUID(),
        entryId: entry.id,
        version: running.cases
          .snapshot()
          .cases.find((c) => c.id === caseId)
          .entries.find((e) => e.id === entry.id).version,
        value: {
          section: 'summary',
          kind: 'text',
          text: 'Cancelled candidate: Mara Velliston at 47 Kowhai Crescent.',
        },
      });
      await wait(() => report.requests.length > count);
      await api('cancelDocumentWork');
      const cancelled = await pending;
      record('cancellation', cancelled);
      assert.equal(cancelled.ok, false);
      assert.equal(JSON.stringify(running.cases.snapshot().cases), before);
      // Real adapter launch failure, without modifying the connected auth store.
      if (provider.id === 'claude')
        await running.models.claude.configure({
          executable: join(profile, 'missing-claude'),
        });
      else running.models.codex.useExecutable(join(profile, 'missing-codex'));
      const failure = await raw('savePlaybookDraft', {
        version: 0,
        content: {
          title: 'Must not save',
          markdown: 'Mara Velliston failure candidate',
        },
      });
      record('provider-failure', failure);
      assert.equal(failure.ok, false);
      const documents = JSON.stringify({
        cases: running.cases.snapshot(),
        books: await api('getPlaybooks'),
      });
      record(
        'detection',
        secrets.map((value) => ({ value, leaked: documents.includes(value) })),
      );
      for (const value of secrets)
        assert.ok(!documents.includes(value), 'Saved document leak: ' + value);
      assert.ok(
        documents.includes('409') && documents.includes('731204'),
        'Technical facts lost',
      );
      report.checks.push(
        'chat, case tool write, manual correction, Undo, Resolve draft/confirm, Markdown draft/publish/update/history/export/tool read, cancellation, provider failure',
      );
    }
    const expectedCases = JSON.stringify(running.cases.snapshot().cases);
    const expectedBooks = JSON.stringify(
      (await raw('getPlaybooks')).value.playbooks,
    );
    await running.close();
    running = undefined;
    for (const file of fs
      .readdirSync(profile)
      .filter((n) => n.startsWith('cases.db') || n === 'playbook.md')) {
      const bytes = fs.readFileSync(join(profile, file));
      for (const value of [
        'Mara Velliston',
        '47 Kowhai Crescent',
        'mara.velliston@example.test',
        'Velvet Otter Labs',
        'sk-test-synthetic-987654321',
      ])
        assert.ok(
          !bytes.includes(Buffer.from(value)),
          file + ' contains ' + value,
        );
    }
    running = await boot();
    await wait(() => evaluate('!!window.supahelp'));
    await api('getPlaybooks');
    assert.equal(JSON.stringify(running.cases.snapshot().cases), expectedCases);
    assert.equal(
      JSON.stringify((await api('getPlaybooks')).playbooks),
      expectedBooks,
    );
    assert.equal(running.chats.snapshot().chats.length, 0);
    report.checks.push(
      'close/reopen database persistence and no chat persistence; raw SQLite/export scan',
    );
    record('outcome', 'PASS');
  } catch (e) {
    report.error = e.stack;
    console.error(e);
    process.exitCode = 1;
  } finally {
    await running?.close().catch(() => {});
    fs.writeFileSync(
      join(profile, restart ? 'restart-report.json' : 'report.json'),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    fs.rmSync(join(profile, 'codex/auth.json'), { force: true });
    fs.rmSync(join(profile, 'model-credentials'), {
      recursive: true,
      force: true,
    });
    clearTimeout(timer);
    console.log('REPORT', join(profile, 'report.json'));
    app.exit(process.exitCode ?? 0);
  }
});
