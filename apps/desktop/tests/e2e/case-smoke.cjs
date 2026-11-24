process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
const assert = require('node:assert/strict');
const { app, nativeTheme } = require('electron');
const { spawn } = require('node:child_process');
const {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  chmodSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const restart = process.argv.includes('--verify-restart');
const profile = restart
  ? process.argv[process.argv.indexOf('--profile') + 1]
  : mkdtempSync(join(tmpdir(), 'supahelp-case-ui-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const timer = setTimeout(() => {
  console.error('Case E2E timed out');
  app.exit(1);
}, 90000);
let running;

app.whenReady().then(async () => {
  try {
    const executable = join(root, 'tests/support/case-codex.mjs');
    chmodSync(executable, 0o700);
    if (!restart)
      writeFileSync(
        join(profile, 'models.json'),
        JSON.stringify({
          selected: { provider: 'chatgpt', model: 'fixture-model' },
        }),
      );
    running = await require(join(tmpdir(), 'supahelp-case-e2e/app.cjs')).boot(
      profile,
      join(
        root,
        `out/Supahelp-${process.platform}-${process.arch}/Supahelp.app/Contents/Resources/app.asar`,
      ),
      executable,
    );
    const evaluate = async (expression) => {
      try {
        return await running.window.webContents.executeJavaScript(
          expression,
          true,
        );
      } catch (error) {
        throw Error(`Case renderer check failed: ${expression.slice(0, 180)}`, {
          cause: error,
        });
      }
    };
    const waitFor = async (condition) => {
      for (let i = 0; i < 300; i++) {
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      throw Error('Case E2E condition timed out');
    };
    const state = async () => {
      const reply = await evaluate(
        'window.supahelp.getAccount().then(r => window.supahelp.getCases(r.value.context))',
      );
      assert.equal(reply.ok, true, reply.error);
      return reply.value;
    };
    const itemAction = (title, action) =>
      evaluate(`(()=>{
      [...document.querySelectorAll('button[popovertarget]')].find(b=>b.title===${JSON.stringify('Actions for ' + title)}).click();
      [...document.querySelectorAll(':popover-open button')].find(b=>b.textContent.trim()===${JSON.stringify(action)}).click();
    })()`);
    const titleEdit = async (label, value, key) => {
      await waitFor(() =>
        evaluate(`!!document.querySelector('input[aria-label="${label}"]')`),
      );
      await evaluate(`(()=>{
        const el=document.querySelector('input[aria-label="${label}"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});
        el.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await evaluate(
        `document.querySelector('input[aria-label="${label}"]').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`,
      );
    };
    const confirmRemove = (label) =>
      evaluate(`(()=>{
      [...document.querySelectorAll('dialog button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click();
    })()`);
    await waitFor(() =>
      evaluate('!!window.supahelp && !!document.querySelector("textarea")'),
    );
    await waitFor(async () => !(await state()).maskingRequired);
    if (restart) {
      const saved = (await state()).cases;
      assert.equal(saved.length, 1);
      assert.equal(saved[0].ownerId, 'local');
      assert.equal(saved[0].title, 'Double invoice investigation');
      assert.equal(saved[0].workspaceId, 'personal');
      assert.equal(saved[0].ticket, 'ZD #123');
      assert.equal(saved[0].entries.length, 2);
      assert.ok(saved[0].entries.some((e) => e.text === 'Restart correction'));
      assert.equal(saved[0].changes.length, 14);
      assert.equal(
        saved[0].changes.filter((change) => change.undoneAt).length,
        3,
      );
      assert.equal(
        (await evaluate('window.supahelp.getChats()')).value.chats.length,
        0,
      );
      await evaluate(
        "[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Double invoice investigation')).click()",
      );
      await waitFor(() =>
        evaluate("document.body.textContent.includes('Later checked finding')"),
      );
      await evaluate("document.querySelector('summary').click()");
      assert.ok(
        await evaluate("document.body.textContent.includes('Change log')"),
      );
      const human = (await state()).cases[0].changes.find(
        (c) => c.after?.text === 'Restart correction',
      );
      await evaluate(
        `document.querySelector('button[aria-label="Undo change ${human.id}"]').click()`,
      );
      await waitFor(async () =>
        (await state()).cases[0].entries.some(
          (e) => e.text === 'Human corrected summary',
        ),
      );
      await itemAction('Double invoice investigation', 'Remove');
      await waitFor(() => evaluate('!!document.querySelector("dialog[open]")'));
      await confirmRemove('Remove case');
      await waitFor(async () => (await state()).cases.length === 0);
      await waitFor(() =>
        evaluate('!document.querySelector("aside[aria-label^=Case]")'),
      );
      const resumed = (await evaluate('window.supahelp.getChats()')).value
        .chats[0];
      assert.equal(resumed.title, 'Continue case');
      await itemAction(resumed.title, 'Remove');
      await waitFor(() => evaluate('!!document.querySelector("dialog[open]")'));
      await confirmRemove('Remove chat');
      await waitFor(
        async () =>
          (await evaluate('window.supahelp.getChats()')).value.chats.length ===
          0,
      );
      console.log(
        'PASS: a separate Electron process reopened the saved case and masked change history with local ownership intact.',
      );
    } else {
      const send = async (text, wait = true) => {
        await waitFor(() =>
          evaluate(
            `!!document.querySelector('textarea') && !document.querySelector('button[aria-label="Stop reply"]')`,
          ),
        );
        await evaluate(
          `(()=>{const el=document.querySelector('textarea');el.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
        await waitFor(() =>
          evaluate(
            '!document.querySelector("button[aria-label=Send]").disabled',
          ),
        );
        await evaluate(
          "document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))",
        );
        if (wait)
          await waitFor(async () => {
            const chat = (await evaluate('window.supahelp.getChats()')).value
              .chats[0];
            return (
              chat?.status === 'idle' &&
              chat.messages.some(
                (message) => message.role === 'user' && message.text === text,
              )
            );
          });
      };
      const click = (text) =>
        evaluate(
          `[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
        );
      const undo = (index) =>
        evaluate(
          `[...document.querySelectorAll('button')].filter(button=>button.textContent.trim()==='Undo')[${index}].click()`,
        );
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('aside button')].some(b => b.textContent.trim() === 'Customers')",
        ),
        false,
      );
      await send('Ticket #123 needs investigation');
      await waitFor(() =>
        evaluate(
          "[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Create case')",
        ),
      );
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('aside button')].some(button => button.textContent.trim() === 'New case' && !button.disabled && button.getBoundingClientRect().width > 0)",
        ),
        true,
        'New case in the sidebar is available alongside the chat suggestion',
      );
      await click('Create case');
      await waitFor(async () => (await state()).cases.length === 1);
      await waitFor(() =>
        evaluate("document.body.textContent.includes('Case #1 · Ticket #123')"),
      );
      await evaluate(
        'document.querySelector(\'button[aria-label="Rename chat title"]\').click()',
      );
      await titleEdit('Chat title', 'Canceled name', 'Escape');
      assert.equal(
        (await evaluate('window.supahelp.getChats()')).value.chats[0].title,
        'Ticket #123 needs investigation',
      );
      await itemAction('Ticket #123 needs investigation', 'Rename');
      await titleEdit('Sidebar chat title', 'Invoice chat', 'Enter');
      await waitFor(() =>
        evaluate(
          'document.querySelector(\'button[aria-label="Rename chat title"]\')?.textContent.trim()==="Invoice chat"',
        ),
      );
      assert.equal(
        (await state()).cases[0].title,
        'Ticket #123 needs investigation',
      );
      await itemAction('Ticket #123 needs investigation', 'Rename');
      await titleEdit(
        'Sidebar case title',
        'Double invoice investigation',
        'Enter',
      );
      await waitFor(
        async () =>
          (await state()).cases[0].title === 'Double invoice investigation',
      );
      await waitFor(() =>
        evaluate(
          'document.querySelector(\'button[aria-label="Rename case title"]\')?.textContent.trim()==="Double invoice investigation"',
        ),
      );
      await itemAction('Double invoice investigation', 'Remove');
      await waitFor(() => evaluate('!!document.querySelector("dialog[open]")'));
      await confirmRemove('Cancel');
      assert.equal((await state()).cases.length, 1);
      await evaluate(
        'document.querySelector(\'aside[aria-label^="Case"] button[aria-label="Close"]\').click()',
      );
      await waitFor(() =>
        evaluate('!document.querySelector(\'aside[aria-label^="Case"]\')'),
      );
      await send('Add finding and hold reply', false);
      await waitFor(async () =>
        existsSync(join(profile, 'codex/case-reply-waiting')),
      );
      assert.equal(
        (await evaluate('window.supahelp.getChats()')).value.chats[0].status,
        'running',
      );
      assert.equal(
        await evaluate(
          '!!document.querySelector(\'aside[aria-label^="Case"]\')',
        ),
        false,
        'saved entries do not open the case before the reply finishes',
      );
      writeFileSync(join(profile, 'codex/case-reply-release'), 'release');
      await waitFor(
        async () =>
          (await evaluate('window.supahelp.getChats()')).value.chats[0]
            .status === 'idle',
      );
      await waitFor(() =>
        evaluate('!!document.querySelector(\'aside[aria-label^="Case"]\')'),
      );
      await waitFor(async () => (await state()).cases[0].entries.length === 1);
      let saved = (await state()).cases[0];
      assert.equal(
        saved.entries[0].text,
        'Alex Example at 12 Example Road; [EMAIL] reported two invoices.',
      );
      assert.equal(saved.entries[0].pill, 'Confirmed');
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('button')].filter(button=>button.textContent.trim()==='Undo').length",
        ),
        1,
      );
      await evaluate(
        'document.querySelector(\'aside[aria-label^="Case"] button[aria-label="Close"]\').click()',
      );
      await send('Find saved ticket #123');
      await waitFor(() =>
        evaluate(
          "document.body.textContent.includes('Found saved ticket ZD #123.')",
        ),
      );
      await send(`Find exact case #${saved.number}`);
      await waitFor(() =>
        evaluate(
          `document.body.textContent.includes(${JSON.stringify(`Exact saved work: ${saved.title}`)})`,
        ),
      );
      await send('Read case only');
      assert.equal(
        await evaluate(
          '!!document.querySelector(\'aside[aria-label^="Case"]\')',
        ),
        false,
        'a read-only reply does not reopen the case for old changes',
      );
      running.window.focus();
      running.window.webContents.focus();
      // ⌘F find in the chat pane: highlights matches, Esc clears them.
      await evaluate('document.activeElement?.blur(); void 0');
      for (const type of ['keyDown', 'keyUp'])
        running.window.webContents.sendInputEvent({
          type,
          keyCode: 'F',
          modifiers: ['meta'],
        });
      await waitFor(() =>
        evaluate(
          "document.activeElement?.getAttribute('aria-label')==='Find in chat'",
        ),
      );
      await running.window.webContents.insertText('read case only');
      await waitFor(() => evaluate("CSS.highlights.get('find')?.size > 0"));
      assert.match(
        await evaluate(
          "document.querySelector('[data-find-bar] [role=status]').textContent",
        ),
        /^1\/\d+$/,
      );
      for (const type of ['keyDown', 'keyUp'])
        running.window.webContents.sendInputEvent({ type, keyCode: 'Escape' });
      await waitFor(() =>
        evaluate(
          "!document.querySelector('[data-find-bar]') && !CSS.highlights.has('find')",
        ),
      );
      await evaluate(`(()=>{
        window.__caseMatchMedia=window.matchMedia;
        window.matchMedia=query=>query==='(prefers-reduced-motion: reduce)'
          ? {matches:true} : window.__caseMatchMedia.call(window,query);
        window.__caseScroll=Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView=function(options){
          window.__caseScrollOptions=options;
          window.__caseScroll.call(this,options);
        };
        [...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='View').focus();
      })()`);
      running.window.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: 'Enter',
      });
      // Electron requires the character event for native Enter activation.
      running.window.webContents.sendInputEvent({
        type: 'char',
        keyCode: '\r',
      });
      running.window.webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: 'Enter',
      });
      await waitFor(() =>
        evaluate("document.activeElement?.id==='case-sec-findings'"),
      );
      assert.equal(
        await evaluate('window.__caseScrollOptions.behavior'),
        'instant',
      );
      await evaluate(`window.matchMedia=window.__caseMatchMedia;
        Element.prototype.scrollIntoView=window.__caseScroll; void 0;`);
      await undo(0);
      await waitFor(async () => (await state()).cases[0].entries.length === 0);
      await waitFor(() =>
        evaluate("document.body.textContent.includes('Undone')"),
      );
      await send('Add finding again');
      await send('Update finding');
      await undo(1);
      await waitFor(() =>
        evaluate(
          "document.body.textContent.includes('Changed since. Edit it instead.')",
        ),
      );
      assert.equal(
        (await state()).cases[0].entries[0].text,
        'Later checked finding',
      );
      await send('Remove finding');
      await waitFor(async () => (await state()).cases[0].entries.length === 0);
      await undo(3);
      await waitFor(async () => (await state()).cases[0].entries.length === 1);
      saved = (await state()).cases[0];
      assert.equal(saved.changes.length, 4);
      assert.equal(saved.changes.filter((change) => change.undoneAt).length, 2);

      // Capture the clipboard transport to avoid overwriting the user's actual clipboard.
      await evaluate(
        "Object.defineProperty(navigator.clipboard,'writeText',{value:async text=>{window.__caseMarkdown=text;},configurable:true})",
      );
      await evaluate(
        `document.querySelector('aside[aria-label^="Case #"] button[title="More"]').click()`,
      );
      await waitFor(() =>
        evaluate(
          "[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Copy as Markdown')",
        ),
      );
      await click('Copy as Markdown');
      await waitFor(() =>
        evaluate("document.body.textContent.includes('Copied')"),
      );
      const markdown = await evaluate('window.__caseMarkdown');
      assert.match(markdown, /## 5\. Findings/);
      assert.match(markdown, /Later checked finding/);
      // Masking is pattern-only: emails and secrets, not names or addresses.
      assert.doesNotMatch(markdown, /alex@example.test/);
      assert.equal(
        markdown,
        (
          await evaluate(
            `window.supahelp.getAccount().then(r=>window.supahelp.getCaseMarkdown({caseId:${JSON.stringify(saved.id)},context:r.value.context}))`,
          )
        ).value,
      );
      await evaluate(
        'document.querySelector(\'aside[aria-label^="Case"] button[aria-label="Close"]\').click()',
      );
      await click('View');
      await waitFor(() =>
        evaluate('!!document.querySelector(\'aside[aria-label^="Case"]\')'),
      );
      // Real renderer entry editing, cancellation, version conflicts and history.
      await evaluate(
        'document.querySelector("button[aria-label=\\\"Add entry to Summary\\\"]").click()',
      );
      await waitFor(() => evaluate('!!document.querySelector("dialog[open]")'));
      const fillEntry = (text) =>
        evaluate(
          `(()=>{const el=document.querySelector('textarea[aria-label="Entry text"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
        );
      await fillEntry('Alex Example human summary');
      await evaluate(
        `(()=>{const el=document.querySelector('input[aria-label="Entry detail"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Checked supporting context');el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await click('Cancel');
      await waitFor(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await evaluate(
        'document.querySelector("dialog form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))',
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.ok(
        await evaluate(
          '!!document.querySelector("dialog[open]")&&!document.querySelector("dialog").textContent.includes("Checking and saving")',
        ),
        'discard confirmation prevents implicit Save',
      );
      assert.equal((await state()).cases[0].changes.length, 4);
      assert.equal(
        await evaluate('document.activeElement.textContent'),
        'Keep editing',
      );
      for (let i = 0; i < 2; i++) {
        running.window.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: 'Tab',
        });
        running.window.webContents.sendInputEvent({
          type: 'keyUp',
          keyCode: 'Tab',
        });
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      assert.equal(
        await evaluate('document.activeElement.textContent'),
        'Keep editing',
      );
      running.window.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: 'Escape',
      });
      running.window.webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: 'Escape',
      });
      await waitFor(() =>
        evaluate('!document.querySelector("dialog[role=alertdialog]")'),
      );
      assert.equal(
        await evaluate(
          `document.querySelector('textarea[aria-label="Entry text"]').value`,
        ),
        'Alex Example human summary',
      );
      for (const theme of ['light', 'dark']) {
        nativeTheme.themeSource = theme;
        await new Promise((resolve) => setTimeout(resolve, 150));
        writeFileSync(
          join(tmpdir(), `supahelp-case-editor-${theme}.png`),
          (await running.window.webContents.capturePage()).toPNG(),
        );
      }
      running.window.setSize(1050, 800);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(
        await evaluate(
          '(()=>{const d=document.querySelector("dialog");return d.scrollWidth<=d.clientWidth&&d.getBoundingClientRect().width<=innerWidth;})()',
        ),
      );
      running.window.setSize(1440, 1000);
      const cancelledQuit = running.quitProbe();
      await waitFor(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await click('Keep editing');
      assert.equal(await cancelledQuit, 'stayed');
      assert.equal(running.window.isDestroyed(), false);
      await evaluate(
        'document.querySelector(\'button[aria-label="Save entry"]\').focus()',
      );
      for (const [type, keyCode] of [
        ['keyDown', 'Enter'],
        ['char', '\r'],
        ['keyUp', 'Enter'],
      ])
        running.window.webContents.sendInputEvent({ type, keyCode });
      await waitFor(async () =>
        (await state()).cases[0].entries.some(
          (e) => e.text === 'Alex Example human summary',
        ),
      );
      await waitFor(() => evaluate('!document.querySelector("dialog[open]")'));
      const humanEntry = (await state()).cases[0].entries.find(
        (e) => e.section === 'summary',
      );
      assert.equal(humanEntry.onBehalfOf, undefined);
      assert.equal(humanEntry.detail, 'Checked supporting context');
      await evaluate(
        `document.querySelector('aside[aria-label^="Case #"] button[title="More"]').click()`,
      );
      await waitFor(() =>
        evaluate(
          "[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Copy as Markdown')",
        ),
      );
      await click('Copy as Markdown');
      await waitFor(() =>
        evaluate(
          'window.__caseMarkdown.includes("Checked supporting context")',
        ),
      );
      await evaluate(
        `document.querySelector('button[aria-label="Edit entry ${humanEntry.id}"]').click()`,
      );
      await fillEntry('Candidate kept during conflict');
      await running.cases.edit(
        saved.id,
        humanEntry.id,
        { section: 'summary', kind: 'text', text: 'Concurrent human summary' },
        {
          context: running.accounts.snapshot().context,
          signal: new AbortController().signal,
          selection: { provider: 'chatgpt', model: 'fixture-model' },
          humanEditRequestId: require('node:crypto').randomUUID(),
        },
        1,
      );
      await waitFor(() =>
        evaluate('document.body.textContent.includes("This entry changed")'),
      );
      assert.equal(
        await evaluate(
          'document.querySelector("textarea[aria-label=\\\"Entry text\\\"]").value',
        ),
        'Candidate kept during conflict',
      );
      await click('Load current entry');
      await waitFor(() =>
        evaluate(
          'document.querySelector(\'textarea[aria-label="Entry text"]\').value==="Concurrent human summary"',
        ),
      );
      await fillEntry('Human corrected summary');
      await click('Save entry');
      await waitFor(() => evaluate('!document.querySelector("dialog[open]")'));
      const humanChange = (await state()).cases[0].changes.find(
        (c) => c.after?.text === 'Concurrent human summary',
      );
      const staleHumanUndo = await evaluate(
        `window.supahelp.getAccount().then(r=>window.supahelp.undoCaseChange({caseId:${JSON.stringify(saved.id)},changeId:${JSON.stringify(humanChange.id)},context:r.value.context}))`,
      );
      assert.equal(staleHumanUndo.ok, false);
      // Remove and restore the latest manual entry through the existing guarded Undo.
      const corrected = (await state()).cases[0].entries.find(
        (e) => e.id === humanEntry.id,
      );
      await evaluate(
        `document.querySelector('button[aria-label="Edit entry ${corrected.id}"]').click()`,
      );
      await waitFor(() => evaluate('!!document.querySelector("dialog[open]")'));
      await click('Remove entry');
      await waitFor(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await evaluate(
        'document.querySelector("dialog[role=alertdialog] button").click()',
      );
      assert.ok(
        (await state()).cases[0].entries.some((e) => e.id === corrected.id),
      );
      await click('Remove entry');
      await waitFor(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await evaluate(
        '[...document.querySelectorAll("dialog[role=alertdialog] button")].at(-1).click()',
      );
      await waitFor(
        async () =>
          !(await state()).cases[0].entries.some((e) => e.id === corrected.id),
      );
      await waitFor(() => evaluate('!document.querySelector("dialog[open]")'));
      const removed = (await state()).cases[0].changes[0];
      await evaluate(
        `window.supahelp.getAccount().then(r=>window.supahelp.undoCaseChange({caseId:${JSON.stringify(saved.id)},changeId:${JSON.stringify(removed.id)},context:r.value.context}))`,
      );
      const restored = (await state()).cases[0].entries.find(
        (e) => e.id === corrected.id,
      );
      const openLookup = (property) =>
        evaluate(
          `document.querySelector('aside[aria-label^="Case"] button[title="Look up ${property}"]').click()`,
        );
      for (const property of [
        'status',
        'owner',
        'contributors',
        'ticket',
        'playbook',
      ]) {
        await openLookup(property);
        await waitFor(() =>
          evaluate(
            `document.activeElement?.matches(':popover-open input[aria-label="Search ${property}"]')`,
          ),
        );
        await evaluate('document.querySelector(":popover-open").hidePopover()');
      }
      assert.equal(
        await evaluate(
          `!!document.querySelector('aside[aria-label^="Case"] button[title="Look up updated"]')`,
        ),
        false,
      );
      assert.equal(
        await evaluate(
          `document.querySelector('aside[aria-label^="Case"] dl').textContent.includes('Unconfirmed')`,
        ),
        false,
      );
      await openLookup('contributors');
      await evaluate(
        `[...document.querySelectorAll(':popover-open button')].find(b=>b.textContent.includes('You')).click()`,
      );
      await waitFor(async () =>
        (await state()).cases[0].contributorIds?.includes('local'),
      );
      assert.equal(
        await evaluate(
          "[...document.querySelectorAll('dt')].find(d=>d.textContent==='Contributors').nextElementSibling.textContent.includes('You')",
        ),
        true,
      );
      assert.equal(
        await evaluate(
          `!!document.querySelector('button[title="Look up customer"]')`,
        ),
        false,
      );
      const caseEdit = (command) =>
        evaluate(
          `window.supahelp.getAccount().then(r=>window.supahelp.editCaseEntry({...${JSON.stringify(command)},caseId:${JSON.stringify(saved.id)},requestId:crypto.randomUUID(),context:r.value.context}))`,
        );
      const rows = [];
      for (const text of ['First row', 'Second row']) {
        const r = await caseEdit({
          action: 'add',
          value: { section: 'problem', kind: 'row', label: 'Observed', text },
        });
        assert.equal(r.ok, true);
        rows.push(r.value.entryId);
      }
      await waitFor(() =>
        evaluate(
          `!!document.querySelector('button[aria-label="Edit entry ${rows[1]}"]')`,
        ),
      );
      await evaluate(
        `document.querySelector('button[aria-label="Edit entry ${rows[1]}"]').click()`,
      );
      await fillEntry('Corrected second row');
      await click('Save entry');
      await waitFor(() => evaluate('!document.querySelector("dialog[open]")'));
      const rowState = (await state()).cases[0].entries;
      assert.equal(rowState.find((e) => e.id === rows[0]).text, 'First row');
      assert.equal(
        rowState.find((e) => e.id === rows[1]).text,
        'Corrected second row',
      );
      for (const entryId of rows) {
        const row = rowState.find((e) => e.id === entryId);
        assert.equal(
          (await caseEdit({ action: 'remove', entryId, version: row.version }))
            .ok,
          true,
        );
      }
      assert.equal(
        (
          await evaluate(
            `window.supahelp.getAccount().then(r=>window.supahelp.editCaseEntry({action:'update',caseId:${JSON.stringify(saved.id)},entryId:${JSON.stringify(restored.id)},version:${restored.version},value:{section:'summary',kind:'text',text:'Restart correction'},requestId:crypto.randomUUID(),context:r.value.context}))`,
          )
        ).ok,
        true,
      );
      for (const theme of ['light', 'dark']) {
        nativeTheme.themeSource = theme;
        await new Promise((resolve) => setTimeout(resolve, 100));
        writeFileSync(
          join(tmpdir(), `supahelp-cases-${theme}.png`),
          (await running.window.webContents.capturePage()).toPNG(),
        );
      }
      const existingChatCount = (await evaluate('window.supahelp.getChats()'))
        .value.chats.length;
      await click('New chat');
      await send('Find exact ticket Zendesk ticket 123');
      await waitFor(() =>
        evaluate(
          "document.body.textContent.includes('Exact saved work: Double invoice investigation')",
        ),
      );
      await itemAction('Find exact ticket Zendesk ticket 123', 'Remove');
      await waitFor(() => evaluate('!!document.querySelector("dialog[open]")'));
      await confirmRemove('Remove chat');
      await waitFor(
        async () =>
          (await evaluate('window.supahelp.getChats()')).value.chats.length ===
          existingChatCount,
      );
      const old = await evaluate('window.supahelp.getAccount()');
      await running.accounts.select({ kind: 'personal' });
      const stale = await evaluate(
        `window.supahelp.getCaseMarkdown({caseId:${JSON.stringify(saved.id)},context:${JSON.stringify(old.value.context)}})`,
      );
      assert.equal(stale.ok, false);
      assert.equal((await state()).cases[0].ownerId, 'local');
      await waitFor(() =>
        evaluate(
          "[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Double invoice investigation'))",
        ),
      );
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Double invoice investigation')).click()",
      );
      await waitFor(() =>
        evaluate(
          `!!document.querySelector('button[aria-label="Edit entry ${restored.id}"]')`,
        ),
      );
      await evaluate(
        `document.querySelector('button[aria-label="Edit entry ${restored.id}"]').click()`,
      );
      await fillEntry('Uncommitted after context switch');
      await running.accounts.select({ kind: 'personal' });
      await waitFor(() => evaluate('!document.querySelector("dialog[open]")'));
      await waitFor(() =>
        evaluate(
          "[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Double invoice investigation'))",
        ),
      );
      await evaluate(
        "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Double invoice investigation')).click()",
      );
      await waitFor(() =>
        evaluate(
          `!!document.querySelector('button[aria-label="Edit entry ${restored.id}"]')`,
        ),
      );
      await evaluate(
        `document.querySelector('button[aria-label="Edit entry ${restored.id}"]').click()`,
      );
      await fillEntry('Discard on close');
      const acceptedQuit = running.quitProbe();
      await waitFor(() =>
        evaluate('!!document.querySelector("dialog[role=alertdialog]")'),
      );
      await click('Discard and close');
      assert.equal(await acceptedQuit, 'closed');
      await running.close();
      running = undefined;
      for (const name of readdirSync(profile).filter((name) =>
        name.startsWith('cases.db'),
      )) {
        const bytes = readFileSync(join(profile, name));
        for (const secret of ['alex@example.test'])
          assert.equal(
            bytes.includes(Buffer.from(secret)),
            false,
            `No raw draft in ${name}`,
          );
      }
      await new Promise((resolveChild, reject) => {
        const child = spawn(
          process.execPath,
          [__filename, '--verify-restart', '--profile', profile],
          { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let output = '';
        child.stdout.on('data', (chunk) => {
          output += chunk;
        });
        child.stderr.on('data', () => {});
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0
            ? (process.stdout.write(output), resolveChild())
            : reject(Error('Case restart verification failed')),
        );
      });
      console.log(
        'PASS: masked model tools and human entry editing, native keyboard Save, conflict review, remove/Undo, restart/history Undo, dirty quit veto/discard, context invalidation, light/dark/narrow layout and database/journal scans. Controlled model, close-choice and clipboard transports; no real inference or external business writes.',
      );
    }
    if (running) await running.close();
    clearTimeout(timer);
    if (!restart) rmSync(profile, { recursive: true, force: true });
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(timer);
    if (running) await running.close().catch(() => {});
    if (!restart) rmSync(profile, { recursive: true, force: true });
    app.exit(1);
  }
});
