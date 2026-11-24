process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
// Packaged preload/React + production services; synthetic model, image and Zendesk transports only.
const assert = require('node:assert/strict');
const clickMenu = require('../support/click-menu.cjs');
const { app, nativeImage, nativeTheme } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const {
  mkdtempSync,
  existsSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  chmodSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const root = resolve(__dirname, '../..'),
  restart = process.argv.includes('--restart');
const profile = restart
  ? process.argv[process.argv.indexOf('--profile') + 1]
  : mkdtempSync(join(tmpdir(), 'supahelp-playbook-ui-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let running, fixture;
const timer = setTimeout(() => {
  console.error('Playbook acceptance timed out');
  app.exit(1);
}, 90000);
app.whenReady().then(async () => {
  try {
    const probe = new DatabaseSync(':memory:');
    try {
      probe.exec('CREATE VIRTUAL TABLE probe USING fts5(title)');
    } finally {
      probe.close();
    }
    const executable = join(root, 'tests/support/case-codex.mjs');
    chmodSync(executable, 0o700);
    if (!restart)
      writeFileSync(
        join(profile, 'models.json'),
        JSON.stringify({
          selected: { provider: 'chatgpt', model: 'fixture-model' },
        }),
      );
    const image = join(profile, 'source.png');
    if (!restart)
      writeFileSync(
        image,
        nativeImage
          .createFromBitmap(Buffer.alloc(16 * 16 * 4, 255), {
            width: 16,
            height: 16,
          })
          .toPNG(),
      );
    if (!restart)
      fixture = await (
        await import(
          pathToFileURL(join(root, 'tests/support/zendesk-server.mjs')).href
        )
      ).zendeskFixture();
    running = await require(join(tmpdir(), 'supahelp-case-e2e/app.cjs')).boot(
      profile,
      join(
        root,
        `out/Supahelp-${process.platform}-${process.arch}/Supahelp.app/Contents/Resources/app.asar`,
      ),
      executable,
      {
        image,
        zendeskOrigin: fixture?.origin,
        authorize: fixture?.authorize,
        playbookExport: join(profile, 'playbook.md'),
        copyMarkdown: (markdown) =>
          writeFileSync(join(profile, 'copied.md'), markdown),
      },
    );
    const evaluate = (code) =>
      running.window.webContents
        .executeJavaScript(code, true)
        .catch((error) => {
          throw Error(code.slice(0, 200) + ': ' + error.message);
        });
    const wait = async (fn) => {
      for (let i = 0; i < 350; i++) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw Error('Playbook condition timed out');
    };
    const api = async (name, args = {}) => {
      const reply = await evaluate(
        `window.supahelp.getAccount().then(a=>window.supahelp[${JSON.stringify(name)}]({...${JSON.stringify(args)},context:a.value.context}))`,
      );
      assert.equal(reply.ok, true, reply.error);
      return reply.value;
    };
    const snapshot = () => api('getPlaybooks');
    const cases = async () =>
      (
        await evaluate(
          'window.supahelp.getAccount().then(a=>window.supahelp.getCases(a.value.context))',
        )
      ).value.cases;
    const click = async (text) => {
      await wait(() =>
        evaluate(
          `[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(text)} && !b.disabled)`,
        ),
      );
      return evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
    };
    const setText = (label, text) =>
      evaluate(
        `(()=>{const el=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    // Grey sidebar row for a draft: [greyed, shows "Draft" label].
    const sidebarDraft = (section, title) =>
      evaluate(`(()=>{
      const b=[...document.querySelectorAll('section[aria-label=${JSON.stringify(section)}] button')].find(b=>b.textContent.includes(${JSON.stringify(title)}));
      return b ? [b.className.split(' ').includes('text-ink-3'), [...b.querySelectorAll('span')].some(s=>s.textContent.trim()==='Draft')] : null;
    })()`);
    const sidebarShot = async (name) =>
      process.env.SIDEBAR_SHOTS &&
      writeFileSync(
        join(process.env.SIDEBAR_SHOTS, name + '.png'),
        (await running.window.webContents.capturePage()).toPNG(),
      );
    const itemAction = (title, action) =>
      evaluate(`(()=>{
      [...document.querySelectorAll('button[popovertarget]')].find(b=>b.title===${JSON.stringify('Actions for ' + title)}).click();
      [...document.querySelectorAll(':popover-open button')].find(b=>b.textContent.trim()===${JSON.stringify(action)}).click();
    })()`);
    const openCreatedPlaybook = async (book) => {
      const record = (await cases()).find((c) => c.id === book.sourceCaseId);
      await evaluate(
        `[...document.querySelectorAll('section[aria-label="Cases"] button')].find(b => b.textContent.includes(${JSON.stringify(record.title)})).click()`,
      );
      await wait(() =>
        evaluate(
          `!!document.querySelector('aside[aria-label="Case #${record.number}"]')`,
        ),
      );
      const field = `document.querySelector('aside[aria-label="Case #${record.number}"]')`;
      assert.equal(
        await evaluate(
          `${field}.textContent.includes('Create Playbook from resolution')`,
        ),
        false,
      );
      const title = (book.draft ?? book.published).title;
      const link = `${field}.querySelector('dl').querySelectorAll('button')`;
      await wait(() =>
        evaluate(
          `[...${link}].some(b => b.textContent.includes(${JSON.stringify(title)}))`,
        ),
      );
      await evaluate(
        `Promise.all(${field}.getAnimations().map(a => a.finished))`,
      );
      writeFileSync(
        join(
          tmpdir(),
          `supahelp-case-created-playbook-${book.draft ? 'draft' : 'published'}.png`,
        ),
        (await running.window.webContents.capturePage()).toPNG(),
      );
      await evaluate(
        `${field}.querySelector('button[title="Look up playbook"]').click()`,
      );
      await evaluate(
        `[...${field}.querySelectorAll(':popover-open button')].find(b => b.textContent.includes(${JSON.stringify(title)})).click()`,
      );
      await wait(() =>
        evaluate(`!!document.querySelector('aside[aria-label^="Playbook:"]')`),
      );
      assert.equal((await snapshot()).playbooks.length, 1);
      assert.equal(
        (await cases()).find((c) => c.id === record.id).playbookId,
        undefined,
      );
    };
    await wait(() =>
      evaluate('!!window.supahelp && !!document.querySelector("textarea")'),
    );
    await snapshot();
    if (restart) {
      const saved = await snapshot(),
        p = saved.playbooks[0];
      assert.equal(p.published.title, 'Safe invoice retries');
      assert.equal(p.draft, undefined);
      assert.equal((await cases())[0].status, 'done');
      await openCreatedPlaybook(p);
      const matches = await api('searchDocuments', { text: 'invoice retry' });
      assert.equal(matches.playbooks[0].id, p.id);
      assert.equal(matches.cases[0].id, (await cases())[0].id);
      assert.deepEqual(
        await api('searchDocuments', { text: 'nomatchingword' }),
        {
          cases: [],
          playbooks: [],
        },
      );
      const shot = await api('getPlaybookScreenshot', {
        id: p.id,
        screenshotId: (/playbook-image:([a-zA-Z0-9-]+)/.exec(
          p.published.markdown,
        ) ?? [])[1],
      });
      assert.deepEqual(
        [...nativeImage.createFromDataURL(shot.data).toBitmap().subarray(0, 4)],
        [255, 255, 255, 255],
      );
      const resumed = await api('resumeCase', {
        caseId: (await cases())[0].id,
      });
      assert.ok(resumed);
      assert.equal(running.cases.caseForChat(resumed), (await cases())[0].id);
      console.log(
        'PASS: separate-process restart retains published Playbook, baked pixels, resolution and case continuation.',
      );
    } else {
      const chatActions = process.argv.includes('--chat-actions');
      if (chatActions) {
        const composer = 'textarea:not([aria-label])';
        const chats = async () =>
          (await evaluate('window.supahelp.getChats()')).value.chats;
        const sendFromComposer = async (text) => {
          const before = (await chats())
            .flatMap((chat) => chat.messages)
            .filter((m) => m.role === 'user').length;
          await evaluate(`(() => {
            const el = document.querySelector(${JSON.stringify(composer)});
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, ${JSON.stringify(text)});
            el.dispatchEvent(new Event('input', { bubbles: true }));
          })()`);
          await wait(() =>
            evaluate(
              `document.querySelector('button[aria-label="Send"]')?.disabled === false`,
            ),
          );
          await evaluate(
            `document.querySelector('button[aria-label="Send"]').click()`,
          );
          await wait(async () => {
            const current = await chats();
            return (
              current
                .flatMap((chat) => chat.messages)
                .filter((m) => m.role === 'user').length > before &&
              current.some(
                (chat) =>
                  chat.status === 'idle' &&
                  chat.messages.filter((m) => m.role === 'user').at(-1)
                    ?.text === text,
              )
            );
          });
          const chat = (await chats()).find((chat) =>
            chat.messages.some((m) => m.role === 'user' && m.text === text),
          );
          const reply = chat.messages
            .filter((m) => m.role === 'assistant')
            .at(-1).text;
          assert.ok(!reply.includes('Controlled Playbook tool failed'), reply);
        };
        const record = async () => (await snapshot()).playbooks[0];
        const clickAction = async (label) => {
          const button = `[...document.querySelectorAll('section[aria-label="Playbook action"] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
          await wait(() => evaluate(`!!(${button}) && !(${button}).disabled`));
          await evaluate(`(${button}).click()`);
        };
        await sendFromComposer('Are you able to create a sample playbook?');
        const created = await record();
        assert.equal((await snapshot()).playbooks.length, 1);
        assert.ok(created.draft.markdown.includes('selected columns'));
        await clickAction('Open draft');
        await wait(() =>
          evaluate(
            `document.querySelector('[aria-label="Playbook Markdown"]')?.value.includes('selected columns')`,
          ),
        );
        await sendFromComposer('Add a verification step');
        assert.equal((await record()).id, created.id);
        assert.ok(
          (await record()).draft.markdown.includes('Date column has values'),
        );

        await sendFromComposer('Publish it');
        const proposed = await record();
        assert.equal(proposed.published, undefined);
        await api('savePlaybookDraft', {
          id: proposed.id,
          version: proposed.version,
          content: {
            ...proposed.draft,
            markdown:
              proposed.draft.markdown + '\n4. Compare with the saved view.',
          },
        });
        await clickAction('Publish draft');
        await wait(() =>
          evaluate(
            `document.querySelector('section[aria-label="Playbook action"] [role="alert"]')?.textContent.includes('Changed since')`,
          ),
        );
        assert.equal((await record()).published, undefined);
        await clickAction('Cancel');
        await wait(() =>
          evaluate(
            `!document.querySelector('section[aria-label="Playbook action"]')`,
          ),
        );
        await sendFromComposer('Publish it');
        await clickAction('Publish draft');
        await wait(async () => !!(await record()).published);
        await wait(() =>
          evaluate(
            `document.querySelector('section[aria-label="Playbook action"]')?.textContent.includes('Playbook published')`,
          ),
        );
        await sendFromComposer('Add a screenshot to it');
        await clickAction('Choose screenshot');
        assert.ok(!(await record()).draft.markdown.includes('playbook-image:'));
        await clickAction('Insert screenshot');
        await wait(async () =>
          (await record()).draft.markdown.includes('playbook-image:'),
        );
        await sendFromComposer('Discard the Playbook draft');
        await clickAction('Discard draft');
        await wait(async () => !(await record()).draft);
        assert.ok((await record()).published.markdown.includes('Date column'));

        await sendFromComposer('Add a verification step');
        await sendFromComposer('Publish it');
        await clickAction('Publish draft');
        await wait(async () => !!(await record()).history?.length);
        await sendFromComposer('Show Playbook history');
        await sendFromComposer('Export the Playbook');
        await clickAction('Export Markdown');
        await wait(() => existsSync(join(profile, 'playbook.md')));
        assert.match(
          readFileSync(join(profile, 'playbook.md'), 'utf8'),
          /Date column has values/,
        );
        await sendFromComposer('Copy the Playbook');
        await clickAction('Copy Markdown');
        await wait(() => existsSync(join(profile, 'copied.md')));
        assert.match(
          readFileSync(join(profile, 'copied.md'), 'utf8'),
          /saved view/,
        );
        await sendFromComposer('Delete the Playbook');
        assert.equal((await snapshot()).playbooks.length, 1);
        await clickAction('Delete Playbook');
        await wait(async () => (await snapshot()).playbooks.length === 0);
        console.log(
          'PASS: new and existing chats create and edit a draft, reject stale publication, confirm current publication, insert a screenshot, discard, read history, export, copy, and delete.',
        );
        await running.close();
        running = undefined;
        await fixture.close();
        fixture = undefined;
        clearTimeout(timer);
        rmSync(profile, { recursive: true, force: true });
        app.exit(0);
        return;
      }
      const send = async (text, chatId) => {
        const reply = await evaluate(
          `window.supahelp.sendMessage(${JSON.stringify({ text, chatId })})`,
        );
        assert.equal(reply.ok, true, reply.error);
        await wait(
          async () =>
            (await evaluate('window.supahelp.getChats()')).value.chats.find(
              (c) => c.id === reply.value,
            )?.status === 'idle',
        );
        return reply.value;
      };
      await send(
        'Investigate duplicate invoices caused by retrying requests after HTTP 409.',
      );
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Investigate duplicate invoices')).click()`,
      );
      await click('New case');
      await wait(async () => (await cases()).length === 1);
      await api('removeCase', { caseId: (await cases())[0].id });
      await wait(async () => (await cases()).length === 0);
      console.log(
        'PASS: invoice chat without ticket keywords creates a case through the UI.',
      );
      const resolutionChat = await send('Duplicate invoice resolution fixture');
      const resolutionCase = await api('createCase', {
        chatId: resolutionChat,
      });
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Duplicate invoice resolution fixture')).click()`,
      );
      await wait(() =>
        evaluate(`!!document.querySelector('aside[aria-label^="Case #"]')`),
      );
      await api('detachCase', {
        caseId: resolutionCase,
        chatId: resolutionChat,
      });
      await wait(async () => (await cases())[0].chatIds.length === 0);
      await wait(() =>
        evaluate(
          `[...document.querySelectorAll('aside[aria-label^="Case #"] button')].some(b => b.textContent.trim() === 'Draft Resolution' && !b.disabled)`,
        ),
      );
      await api('attachCase', {
        caseId: resolutionCase,
        chatId: resolutionChat,
      });
      const review = `document.querySelector('section[aria-label="Review resolution"]')`;
      const resolutionButton = (label) =>
        evaluate(
          `[...${review}.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)}).click()`,
        );
      await send('Can you resolve this case?', resolutionChat);
      await wait(() => evaluate(`!!${review}`));
      const original = (await snapshot()).resolutions[0];
      assert.equal((await cases())[0].status, 'inv');
      await resolutionButton('Cancel');
      await wait(() => evaluate(`!${review}`));
      assert.equal((await snapshot()).resolutions[0].id, original.id);
      await send('Can you resolve this case?', resolutionChat);
      await wait(() => evaluate(`!!${review}`));
      await send(
        'Revise the resolution to mention testing three retries',
        resolutionChat,
      );
      await wait(() =>
        evaluate(`${review}?.textContent.includes('tested three retries')`),
      );
      const revised = (await snapshot()).resolutions[0];
      assert.equal(revised.id, original.id);
      assert.equal(revised.version, original.version + 1);
      await resolutionButton('Confirm Resolve');
      await wait(async () => (await cases())[0].status === 'done');
      assert.equal(
        (await cases())[0].entries.filter((e) => e.section === 'resolution')
          .length,
        1,
      );
      assert.equal((await snapshot()).resolutions[0].committed, true);
      console.log(
        'PASS: case chat drafts, cancels, reopens review, revises and confirms the same saved resolution.',
      );
      if (process.argv.includes('--resolution-chat')) {
        await running.close();
        running = undefined;
        await fixture.close();
        fixture = undefined;
        clearTimeout(timer);
        rmSync(profile, { recursive: true, force: true });
        app.exit(0);
        return;
      }
      await api('removeCase', { caseId: resolutionCase });
      await wait(async () => (await cases()).length === 0);
      const chatId = await send('Ticket #123 needs investigation');
      const caseId = await api('createCase', { chatId });
      await api('resumeCase', { caseId });
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Ticket #123 needs investigation')).click()`,
      );
      await wait(() =>
        evaluate(
          `!!document.querySelector('[aria-label="Resolve and Playbooks"]')`,
        ),
      );
      await click('Draft Resolution');
      await wait(async () => (await snapshot()).resolutions.length === 1);
      await wait(async () =>
        (await sidebarDraft('Cases', 'Ticket #123'))?.every(Boolean),
      );
      await sidebarShot('case-draft');
      console.log(
        'PASS: unconfirmed Resolve draft greys the sidebar case row.',
      );
      let draft = (await snapshot()).resolutions[0];
      // Masking is pattern-only: names stay; emails and secrets are masked.
      assert.ok(draft.text.includes('Alex Example'));
      assert.equal((await cases())[0].status, 'inv');
      await wait(() =>
        evaluate(`!!document.querySelector('[aria-label="Resolution draft"]')`),
      );
      await setText(
        'Resolution draft',
        'A retry guard fixed duplicate invoice requests.',
      );
      await click('Save Resolution draft');
      await wait(async () => (await snapshot()).resolutions[0].version === 2);
      await wait(() =>
        evaluate(
          "![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Confirm Resolve').disabled",
        ),
      );
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Confirm Resolve').focus()",
      );
      running.window.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: 'Enter',
      });
      running.window.webContents.sendInputEvent({
        type: 'char',
        keyCode: '\r',
      });
      running.window.webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: 'Enter',
      });
      await wait(async () => (await cases())[0].status === 'done');
      await wait(async () =>
        (await sidebarDraft('Cases', 'Ticket #123'))?.every((x) => !x),
      );
      await click('Create Playbook from resolution');
      await wait(async () => (await snapshot()).playbooks.length === 1);
      let p = (await snapshot()).playbooks[0];
      assert.equal(p.published, undefined);
      await wait(
        async () =>
          (await sidebarDraft('Playbooks', p.draft.title))?.[0] === true,
      );
      await sidebarShot('playbook-draft');
      console.log('PASS: draft Playbook row is greyed in the sidebar.');
      await wait(() =>
        evaluate(
          `!!document.querySelector('[aria-label="Playbook Markdown"]')`,
        ),
      );
      await openCreatedPlaybook(p);
      await evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true })); true`,
      );
      await wait(() =>
        evaluate(
          `document.body.textContent.includes('Supahelp follows your computer')`,
        ),
      );
      assert.equal(
        await evaluate(`document.body.textContent.includes('Jimmy Chang')`),
        false,
      );
      await click('Notifications');
      assert.equal(
        await evaluate(
          `!!document.querySelector('[aria-label="Desktop notification banners"]')`,
        ),
        true,
      );
      await click('Privacy & data');
      assert.equal(
        await evaluate(
          `document.body.textContent.includes('local document database is not encrypted by Supahelp')`,
        ),
        true,
      );
      assert.equal(
        await evaluate(
          `document.body.textContent.includes('pattern masking and a separate model check')`,
        ),
        true,
      );
      await click('Models');
      assert.equal(
        await evaluate(
          `document.querySelector('[data-settings-scroll] h1')?.textContent === 'Models'`,
        ),
        true,
      );
      await evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`,
      );
      await wait(() =>
        evaluate(
          `!!document.querySelector('[aria-label="Playbook Markdown"]')`,
        ),
      );
      await setText('Playbook Markdown', 'Unsaved local edit');
      await evaluate(
        `document.querySelector('aside[aria-label^="Playbook:"] button[aria-label="Close"]').click()`,
      );
      await wait(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await click('Keep editing');
      const cancelledQuit = running.quitProbe();
      await wait(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await click('Keep editing');
      assert.equal(await cancelledQuit, 'stayed');
      await click('New chat');
      await wait(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await click('Keep editing');
      assert.equal(
        await evaluate(
          `document.querySelector('[aria-label="Playbook Markdown"]').value`,
        ),
        'Unsaved local edit',
      );
      await click('New chat');
      await wait(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await click('Discard changes');
      await wait(() =>
        evaluate(`!document.querySelector('[aria-label="Playbook Markdown"]')`),
      );
      assert.notEqual(
        (await snapshot()).playbooks[0].draft.markdown,
        'Unsaved local edit',
      );
      await click('Safe invoice retries');
      await wait(() =>
        evaluate(
          `!!document.querySelector('[aria-label="Playbook Markdown"]')`,
        ),
      );
      await wait(() =>
        evaluate(
          `document.querySelector('header [aria-label="Rename chat title"]')?.textContent.trim() === 'Safe invoice retries'`,
        ),
      );
      assert.equal(
        await evaluate(
          `[...document.querySelectorAll('aside button')].some(b => b.textContent.trim() === 'New case' && !b.disabled)`,
        ),
        false,
        'Playbook chats must not offer to create another case',
      );
      await setText('Playbook Markdown', 'Unsaved conflict candidate');
      const previous = (await snapshot()).playbooks[0];
      await api('savePlaybookDraft', {
        id: previous.id,
        version: previous.version,
        content: { ...previous.draft, markdown: 'Changed elsewhere' },
      });
      await wait(() =>
        evaluate(
          `document.body.textContent.includes('This Playbook was saved somewhere else.')`,
        ),
      );
      assert.equal(
        await evaluate(
          `document.querySelector('[aria-label="Playbook Markdown"]').value`,
        ),
        'Unsaved conflict candidate',
      );
      assert.equal(
        await evaluate(
          `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save draft').disabled`,
        ),
        true,
      );
      await click('Load the newer version');
      await setText('Playbook Markdown', 'Retry invoice requests safely.');
      await click('Save draft');
      await wait(
        async () =>
          (await snapshot()).playbooks[0].draft.markdown ===
          'Retry invoice requests safely.',
      );
      await setText(
        'Playbook Markdown',
        '## Retry safely\n\n| Check | Result |\n| --- | --- |\n| Previous request | No duplicate |\n\n- [ ] Verify the result\n\n```sh\necho safe\n```\n\n![Blocked remote image](https://example.invalid/tracker.png)\n\n[Unsafe link](javascript:alert(1))\n\n<script>window.markdownInjected = true</script>',
      );
      await click('Preview');
      assert.equal(
        await evaluate(
          `!!document.querySelector('[aria-label="Playbook preview"] table')`,
        ),
        true,
      );
      assert.equal(
        await evaluate(
          `!!document.querySelector('[aria-label="Playbook preview"] pre code')`,
        ),
        true,
      );
      assert.equal(
        await evaluate(
          `!!document.querySelector('[aria-label="Playbook preview"] input[type="checkbox"]')`,
        ),
        true,
      );
      assert.equal(
        await evaluate(
          `!!document.querySelector('[aria-label="Playbook preview"] img')`,
        ),
        false,
      );
      assert.equal(await evaluate(`!!window.markdownInjected`), false);
      for (const theme of ['light', 'dark']) {
        nativeTheme.themeSource = theme;
        for (const expanded of [false, true]) {
          if (expanded)
            await evaluate(
              `document.querySelector('aside button[aria-label="Expand to full width"]').click()`,
            );
          await new Promise((r) => setTimeout(r, 200));
          assert.equal(
            await evaluate(
              `document.documentElement.scrollWidth <= document.documentElement.clientWidth`,
            ),
            true,
          );
          writeFileSync(
            join(
              tmpdir(),
              `supahelp-markdown-preview-${theme}-${expanded ? 'expanded' : 'side'}.png`,
            ),
            (await running.window.webContents.capturePage()).toPNG(),
          );
          if (expanded)
            await evaluate(
              `document.querySelector('aside button[aria-label="Back to side panel"]').click()`,
            );
        }
      }
      await click('Edit');
      for (const theme of ['light', 'dark']) {
        nativeTheme.themeSource = theme;
        await new Promise((r) => setTimeout(r, 200));
        writeFileSync(
          join(tmpdir(), `supahelp-markdown-editor-${theme}.png`),
          (await running.window.webContents.capturePage()).toPNG(),
        );
      }
      assert.ok(
        (
          await evaluate(
            `document.querySelector('[aria-label="Playbook Markdown"]').value`,
          )
        ).includes('## Retry safely'),
      );
      await click('Save draft');
      await wait(async () =>
        (await snapshot()).playbooks[0].draft.markdown.includes(
          '## Retry safely',
        ),
      );
      await wait(() =>
        evaluate(
          `!document.querySelector('[aria-label="Playbook Markdown"]').disabled`,
        ),
      );
      await wait(() =>
        evaluate(
          "!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Screenshot')",
        ),
      );
      await click('Screenshot');
      await wait(() =>
        evaluate("document.body.textContent.includes('Review screenshot')"),
      );
      assert.equal(
        readdirSync(join(profile, 'playbook-screenshots')).length,
        0,
      );
      for (const theme of ['light', 'dark']) {
        nativeTheme.themeSource = theme;
        await new Promise((r) => setTimeout(r, 350));
        assert.equal(
          await evaluate(
            'document.documentElement.scrollWidth <= document.documentElement.clientWidth',
          ),
          true,
        );
        writeFileSync(
          join(tmpdir(), `supahelp-playbook-review-${theme}.png`),
          (await running.window.webContents.capturePage()).toPNG(),
        );
      }
      await click('Insert screenshot');
      await wait(async () =>
        (await snapshot()).playbooks[0].draft.markdown.includes(
          'playbook-image:',
        ),
      );
      await wait(() =>
        evaluate(
          "![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Publish').disabled",
        ),
      );
      await click('Publish');
      await wait(async () => !!(await snapshot()).playbooks[0].published);
      p = (await snapshot()).playbooks[0];
      await openCreatedPlaybook(p);
      await clickMenu(
        running.window,
        'aside[aria-label^="Playbook:"]',
        'Export .md',
      );
      await wait(() => existsSync(join(profile, 'playbook.md')));
      const exported = readFileSync(join(profile, 'playbook.md'), 'utf8');
      assert.ok(exported.includes('## Retry safely'));
      assert.ok(!exported.includes('playbook-image:'));
      const exportedAssets = readdirSync(profile).find((name) =>
        name.includes('.assets-'),
      );
      assert.ok(exportedAssets);
      assert.equal(readdirSync(join(profile, exportedAssets)).length, 1);
      const shot = await api('getPlaybookScreenshot', {
        id: p.id,
        screenshotId: (/playbook-image:([a-zA-Z0-9-]+)/.exec(
          p.published.markdown,
        ) ?? [])[1],
      });
      assert.deepEqual(
        [...nativeImage.createFromDataURL(shot.data).toBitmap().subarray(0, 4)],
        [255, 255, 255, 255],
      );
      assert.deepEqual(
        [...nativeImage.createFromPath(image).toBitmap().subarray(0, 4)],
        [255, 255, 255, 255],
      );
      const matches = await api('searchDocuments', { text: 'invoice retry' });
      assert.equal(matches.playbooks[0].id, p.id);
      assert.equal(matches.cases[0].id, caseId);
      assert.equal((await cases())[0].playbookId, undefined);
      const transcript = async () =>
        (await evaluate('window.supahelp.getChats()')).value.chats
          .find((chat) => chat.id === chatId)
          .messages.at(-1).text;
      await send(`Find exact Playbook ${p.published.title}`, chatId);
      assert.equal(
        await transcript(),
        `Exact saved work: ${p.published.title}`,
      );
      await send('Find related invoice retry', chatId);
      assert.equal(
        await transcript(),
        `Related saved work: ${p.published.title}`,
      );
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Ticket #123 needs investigation')).click()`,
      );
      await wait(() =>
        evaluate(
          `!!document.querySelector('input[type="search"][placeholder="Match this case, or type keywords…"]')`,
        ),
      );
      await evaluate(
        `(()=>{const el=document.querySelector('input[type="search"][placeholder="Match this case, or type keywords…"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'invoice retry');el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await wait(() =>
        evaluate(
          `document.body.textContent.includes('Suggested Playbooks') && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Attach Playbook')`,
        ),
      );
      await click('Attach Playbook');
      await wait(async () =>
        (await evaluate('window.supahelp.getChats()')).value.chats
          .find((c) => c.id === chatId)
          .playbookIds?.includes(p.id),
      );
      assert.equal((await cases())[0].playbookId, undefined);
      await evaluate(
        `(()=>{const el=document.querySelector('input[type="search"][placeholder="Match this case, or type keywords…"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'nomatchingword');el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await wait(() =>
        evaluate(
          `document.body.textContent.includes('No matching published Playbooks.') && document.body.textContent.includes('No matching resolved cases.')`,
        ),
      );
      await send('Read Playbook', chatId);
      assert.ok(
        (await evaluate('window.supahelp.getChats()')).value.chats
          .find((c) => c.id === chatId)
          .messages.some((m) =>
            m.text?.includes('Read published Playbook: Safe invoice retries'),
          ),
      );
      draft = (await snapshot()).resolutions[0];
      await api('proposeResolutionNote', { id: draft.id, chatId });
      await wait(() =>
        running.zendesk.snapshot().actions.some((a) => a.status === 'pending'),
      );
      assert.equal(fixture.writes.length, 0);
      let action = running.zendesk.snapshot().actions[0];
      await evaluate(
        `window.supahelp.decideZendeskAction(${JSON.stringify(action.id)},'deny')`,
      );
      await wait(
        () => running.zendesk.snapshot().actions[0].status === 'cancelled',
      );
      assert.equal(fixture.writes.length, 0);
      await api('proposeResolutionNote', { id: draft.id, chatId });
      await wait(
        () => running.zendesk.snapshot().actions[0].status === 'pending',
      );
      action = running.zendesk.snapshot().actions[0];
      assert.equal(action.arguments.ticket_id, 123);
      assert.equal(
        action.arguments.body,
        'What fixed it\n\nA retry guard fixed duplicate invoice requests.',
      );
      await evaluate(
        `window.supahelp.decideZendeskAction(${JSON.stringify(action.id)},'approve')`,
      );
      await wait(
        () => running.zendesk.snapshot().actions[0].status === 'verified',
      );
      assert.equal(fixture.writes.length, 1);
      assert.equal(fixture.comments[0].public, false);
      const duplicate = await evaluate(
        `window.supahelp.getAccount().then(a=>window.supahelp.proposeResolutionNote({context:a.value.context,id:${JSON.stringify(draft.id)},chatId:${JSON.stringify(chatId)}}))`,
      );
      assert.equal(duplicate.ok, false);
      assert.match(duplicate.error, /already has/);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(fixture.writes.length, 1);
      await api('savePlaybookDraft', {
        id: p.id,
        version: p.version,
        content: { ...p.published, markdown: 'Unpublished update' },
      });
      assert.equal(
        (await snapshot()).playbooks[0].published.markdown,
        p.published.markdown,
      );
      const latest = (await snapshot()).playbooks[0];
      await api('discardPlaybookDraft', { id: p.id, version: latest.version });
      await itemAction('Safe invoice retries', 'Rename');
      await wait(() =>
        evaluate(
          `!!document.querySelector('input[aria-label="Sidebar Playbook title"]')`,
        ),
      );
      await setText('Sidebar Playbook title', 'Revised invoice procedure');
      await evaluate(
        `document.querySelector('input[aria-label="Sidebar Playbook title"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`,
      );
      await wait(
        async () =>
          (await snapshot()).playbooks[0].draft?.title ===
          'Revised invoice procedure',
      );
      const renamed = (await snapshot()).playbooks[0];
      assert.deepEqual(renamed.published, p.published);
      assert.equal(renamed.draft.markdown, p.published.markdown);
      await api('discardPlaybookDraft', { id: p.id, version: renamed.version });
      const temporary = await api('savePlaybookDraft', {
        version: 0,
        content: { title: 'Temporary draft', markdown: '' },
      });
      await wait(() =>
        evaluate(`document.body.textContent.includes('Temporary draft')`),
      );
      await click('Temporary draft');
      await wait(() =>
        evaluate(
          `!!document.querySelector('[aria-label="Playbook Markdown"]')`,
        ),
      );
      await setText('Playbook Markdown', 'Candidate after removal');
      await click('New chat');
      await wait(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await click('Keep editing');
      assert.equal(
        await evaluate(
          `document.querySelector('[aria-label="Playbook Markdown"]').value`,
        ),
        'Candidate after removal',
      );
      await evaluate(
        `document.querySelector('aside[aria-label^="Playbook:"] button[title="More"]').click()`,
      );
      await click('Discard draft');
      await wait(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await evaluate(
        'document.querySelector("dialog[role=alertdialog] button").click()',
      );
      assert.ok(
        (await snapshot()).playbooks.some((book) => book.id === temporary.id),
      );
      await api('discardPlaybookDraft', {
        id: temporary.id,
        version: temporary.version,
      });
      await wait(() =>
        evaluate(
          `document.body.textContent.includes('This Playbook was removed.')`,
        ),
      );
      assert.equal(
        await evaluate(
          `document.querySelector('[aria-label="Playbook Markdown"]').value`,
        ),
        'Candidate after removal',
      );
      assert.equal(
        await evaluate(
          `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save draft').disabled`,
        ),
        true,
      );
      await running.accounts.select({ kind: 'personal' });
      await wait(() =>
        evaluate(`!document.querySelector('[aria-label="Playbook Markdown"]')`),
      );
      assert.ok((await snapshot()).playbooks.some((book) => book.id === p.id));
      assert.equal(
        await evaluate(
          `getComputedStyle([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'New Playbook')).cursor`,
        ),
        'pointer',
      );
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith('Hide sidebar')).click()`,
      );
      await click('New Playbook');
      await wait(() =>
        evaluate(
          `!!document.querySelector('[aria-label="Playbook Markdown"]')`,
        ),
      );
      const empty = (await snapshot()).playbooks.find(
        (book) => book.draft?.title === 'Untitled Playbook',
      );
      assert.ok(empty);
      assert.equal(
        await evaluate(
          `document.querySelector('[aria-label="Playbook Markdown"]').value`,
        ),
        '',
      );
      assert.equal(
        await evaluate(
          `!!document.querySelector('[aria-label="What is this"]')`,
        ),
        false,
      );
      assert.equal(
        await evaluate(`!!document.querySelector('[aria-label="Step 1"]')`),
        false,
      );
      await new Promise((r) => setTimeout(r, 250));
      writeFileSync(
        join(tmpdir(), 'supahelp-markdown-new.png'),
        (await running.window.webContents.capturePage()).toPNG(),
      );
      await evaluate(
        `[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith('Show sidebar')).click()`,
      );
      await itemAction('Untitled Playbook', 'Remove');
      await wait(() => evaluate('!!document.querySelector("dialog[open]")'));
      await click('Remove Playbook');
      await wait(
        async () =>
          !(await snapshot()).playbooks.some((book) => book.id === empty.id),
      );
      await wait(() =>
        evaluate(`!document.querySelector('aside[aria-label^="Playbook:"]')`),
      );
      for (const theme of ['light', 'dark']) {
        nativeTheme.themeSource = theme;
        await new Promise((r) => setTimeout(r, 350));
        writeFileSync(
          join(tmpdir(), `supahelp-playbooks-${theme}.png`),
          (await running.window.webContents.capturePage()).toPNG(),
        );
      }
      await running.close();
      running = undefined;
      await fixture.close();
      fixture = undefined;
      for (const name of readdirSync(profile).filter((n) =>
        n.startsWith('cases.db'),
      )) {
        const bytes = readFileSync(join(profile, name));
        assert.ok(!bytes.includes(Buffer.from('alex@example.test')));
      }
      await new Promise((resolveChild, reject) => {
        const child = spawn(
          process.execPath,
          [__filename, '--restart', '--profile', profile],
          {
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let stderr = '';
        child.stdout.on('data', (b) => process.stdout.write(b));
        child.stderr.on('data', (b) => (stderr += b));
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0
            ? resolveChild()
            : reject(Error('Restart failed: ' + stderr)),
        );
      });
      console.log(
        'PASS: packaged Resolve review/confirmation → masked Playbook draft → actual PNG confirmation → Publish → MCP published-text read → approved private Zendesk note/audit; denial, duplicate suppression, draft isolation and restart. Controlled transports only.',
      );
    }
    await running?.close();
    await fixture?.close();
    clearTimeout(timer);
    if (!restart)
      rmSync(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(timer);
    await running?.close().catch(() => {});
    await fixture?.close().catch(() => {});
    if (!restart) {
      try {
        rmSync(profile, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      } catch {}
    }
    app.exit(1);
  }
});
