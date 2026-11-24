import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaseStore } from '../../../src/main/features/cases/store.ts';
import { CaseService } from '../../../src/main/features/cases/service.ts';
import { PlaybookService } from '../../../src/main/features/playbooks/service.ts';
import { ResolveService } from '../../../src/main/features/cases/resolve.ts';
import { registerPlaybooksIpc } from '../../../src/main/features/playbooks/ipc.ts';
import { PlaybookScreenshots } from '../../../src/main/platform/playbook-screenshots.ts';
import { ChatService } from '../../../src/main/features/chat/service.ts';
import {
  caseEnvironment,
  caseOperation,
} from '../../support/case-environment.mjs';

test('document IPC rejects hostile senders/fields and resumes a retained case without model authority', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playbook-ipc-')),
    state = caseEnvironment(),
    cases = new CaseService(
      new CaseStore(join(dir, 'cases.db')),
      () => {},
      state.environment,
    );
  const books = new PlaybookService(cases, cases.store.books, () => {}),
    resolve = new ResolveService(cases, books, () => false),
    chats = new ChatService(
      {
        open() {
          throw Error('No model');
        },
      },
      () => {},
    );
  const id = await cases.create(
    { id: 'old-chat', title: 'Case', messages: [] },
    caseOperation(),
  );
  const frame = {},
    webContents = { mainFrame: frame, getURL: () => 'file:///app/index.html' },
    event = { sender: webContents, senderFrame: frame },
    handlers = new Map();
  const models = {
    settings: async () => ({
      selected: { provider: 'claude', model: 'fixture-model' },
    }),
    configurePlaybooks() {},
    cancelMasking() {},
    attachPlaybooks() {},
  };
  const shots = new PlaybookScreenshots(join(dir, 'images'), {
    decode() {
      throw Error('No images');
    },
    encode() {
      throw Error('No images');
    },
  });
  let chooseExport = async () => undefined;
  const opened = [];
  registerPlaybooksIpc(
    { handle: (name, fn) => handlers.set(name, fn) },
    () => ({ webContents }),
    'file:///app/index.html',
    cases,
    books,
    resolve,
    models,
    chats,
    shots,
    async () => undefined,
    undefined,
    {
      chooseExport: (title) => chooseExport(title),
      openLink: async (url) => {
        opened.push(url);
      },
    },
  );
  t.after(async () => {
    await chats.close();
    cases.close();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (name, input, e = event) => handlers.get(name)(e, input),
    context = state.environment.context();
  assert.deepEqual(
    (await call('playbooks:search', { context, text: '' })).value,
    { cases: [], playbooks: [] },
  );
  for (const input of [
    { context, text: 42 },
    { context, text: 'x'.repeat(2001) },
    { context, text: 'Case', ownerId: 'other' },
    { context: { ...context, generation: 99 }, text: 'Case' },
  ])
    assert.equal((await call('playbooks:search', input)).ok, false);
  assert.equal(
    (
      await call(
        'playbooks:search',
        { context, text: 'Case' },
        { ...event, senderFrame: {} },
      )
    ).ok,
    false,
  );
  assert.equal(
    (await call('playbooks:list', { context }, { ...event, senderFrame: {} }))
      .ok,
    false,
  );
  assert.equal(
    (await call('playbooks:saveDraft', { context, ownerId: 'other' })).ok,
    false,
  );
  assert.equal(
    (await call('playbooks:list', { context: { ...context, generation: 99 } }))
      .ok,
    false,
  );
  const resumed = await call('cases:resume', { context, caseId: id });
  assert.equal(resumed.ok, true);
  assert.equal(cases.caseForChat(resumed.value), id);
  assert.equal(
    (await call('cases:resume', { context, caseId: id })).value,
    resumed.value,
  );
  const detach = { context, caseId: id, chatId: resumed.value };
  assert.equal(
    (await call('chat:detachCase', detach, { ...event, senderFrame: {} })).ok,
    false,
  );
  assert.equal(
    (
      await call('chat:detachCase', {
        ...detach,
        context: { ...context, generation: 99 },
      })
    ).ok,
    false,
  );
  assert.equal(
    (await call('chat:detachCase', { ...detach, chatId: 'unknown' })).ok,
    false,
  );
  assert.equal(cases.caseForChat(resumed.value), id);
  const beforeDetach = cases.read(id, caseOperation());
  const refreshTools = chats.refreshTools.bind(chats);
  let refreshed;
  chats.refreshTools = (chatId) => {
    refreshed = chatId;
    refreshTools(chatId);
  };
  assert.equal((await call('chat:detachCase', detach)).ok, true);
  assert.equal(refreshed, resumed.value);
  assert.equal(cases.caseForChat(resumed.value), undefined);
  assert.deepEqual(cases.read(id, caseOperation()), {
    ...beforeDetach,
    chatIds: beforeDetach.chatIds.filter((chatId) => chatId !== resumed.value),
  });
  const reopened = new CaseStore(join(dir, 'cases.db'));
  assert.equal(reopened.caseForChat(resumed.value), undefined);
  reopened.close();
  assert.equal((await call('chat:attachCase', detach)).ok, true);
  assert.equal(cases.caseForChat(resumed.value), id);
  const original = await cases.edit(
    id,
    undefined,
    { section: 'summary', kind: 'text', text: 'HTTP 409 after 30 seconds' },
    caseOperation(),
  );
  const correction = await cases.edit(
    id,
    original.entryId,
    { section: 'summary', kind: 'text', text: 'Incorrect 45 seconds' },
    caseOperation(),
    original.version,
  );
  cases.undo(id, correction.changeId, caseOperation());
  models.draftDocument = async (kind, data) => {
    assert.equal(kind, 'resolution');
    assert.equal(Object.hasOwn(data.case, 'changes'), false);
    assert.equal(data.case.entries[0].text, 'HTTP 409 after 30 seconds');
    assert.ok(!JSON.stringify(data).includes('45 seconds'));
    return { resolution: 'Current facts only' };
  };
  const resolution = await call('cases:draftResolution', {
    context,
    caseId: id,
    requestId: 'current-facts-regression',
  });
  assert.equal(resolution.ok, true, resolution.error);
  models.draftDocument = async () => ({ notes: 'wrong shape' });
  const unreadable = await call('cases:draftResolution', {
    context,
    caseId: id,
    chatId: resumed.value,
    requestId: 'unreadable-draft',
  });
  assert.equal(unreadable.ok, false);
  assert.match(unreadable.error, /could not read/);
  models.draftDocument = async () => ({ resolution: 'Extra ok', notes: 'x' });
  const extra = await call('cases:draftResolution', {
    context,
    caseId: id,
    chatId: resumed.value,
    requestId: 'extra-field-draft',
  });
  assert.equal(extra.ok, true, extra.error);
  resolve.confirm(extra.value.id, extra.value.version, caseOperation());
  let playbookDrafts = 0;
  models.draftDocument = async () => {
    playbookDrafts++;
    return { title: 'Case procedure', markdown: 'Use the retry guard.' };
  };
  const draftInput = { context, id: extra.value.id };
  const concurrent = await Promise.all([
    call('cases:draftPlaybook', draftInput),
    call('cases:draftPlaybook', draftInput),
  ]);
  for (const reply of concurrent) assert.equal(reply.ok, true, reply.error);
  const created = concurrent[0].value;
  assert.equal(concurrent[1].value.id, created.id);
  assert.equal(books.list(caseOperation()).length, 1);
  const generated = playbookDrafts;
  assert.deepEqual(await call('cases:draftPlaybook', draftInput), {
    ok: true,
    value: created,
  });
  assert.equal(playbookDrafts, generated);
  const caseBook = books.publish(created.id, created.version, caseOperation());
  assert.deepEqual(await call('cases:draftPlaybook', draftInput), {
    ok: true,
    value: books.read(caseBook.id, caseOperation()),
  });
  assert.equal(playbookDrafts, generated);
  const updated = await call('cases:draftPlaybook', {
    ...draftInput,
    playbookId: caseBook.id,
  });
  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.value.id, caseBook.id);
  assert.equal(updated.value.version, caseBook.version + 1);
  assert.equal(playbookDrafts, generated + 1);
  books.remove(caseBook.id, updated.value.version, caseOperation());
  const recreated = await call('cases:draftPlaybook', draftInput);
  assert.equal(recreated.ok, true, recreated.error);
  assert.notEqual(recreated.value.id, caseBook.id);
  const draft = await call('playbooks:saveDraft', {
    context,
    version: 0,
    content: { title: 'Safe', markdown: 'alex@example.test' },
  });
  assert.equal(draft.ok, true);
  assert.ok(!draft.value.draft.markdown.includes('alex@example.test'));
  const createInput = {
    context,
    text: 'Investigate billing',
    caseId: id,
    playbookIds: [draft.value.id],
  };
  const countBefore = chats.snapshot().chats.length;
  assert.equal((await call('chat:create', createInput)).ok, false);
  assert.equal(chats.snapshot().chats.length, countBefore);
  const published = books.publish(
    draft.value.id,
    draft.value.version,
    caseOperation(),
  );
  const fresh = await call('chat:create', createInput);
  assert.equal(fresh.ok, true, fresh.error);
  assert.equal(cases.caseForChat(fresh.value), id);
  const freshChat = chats
    .snapshot()
    .chats.find((chat) => chat.id === fresh.value);
  assert.deepEqual(freshChat.playbookIds, [published.id]);
  assert.equal(freshChat.title, 'Investigate billing');
  assert.deepEqual(freshChat.messages, []);
  assert.equal(
    (
      await call('chat:create', {
        ...createInput,
        playbookIds: [published.id, published.id],
      })
    ).ok,
    false,
  );
  assert.equal(
    (await call('chat:create', { ...createInput, caseId: 'unknown' })).ok,
    false,
  );
  assert.equal(
    (await call('chat:create', createInput, { ...event, senderFrame: {} })).ok,
    false,
  );
  assert.equal(chats.snapshot().chats.length, countBefore + 1);
  assert.equal(
    (await call('playbooks:openLink', { context, text: 'file:///etc/passwd' }))
      .ok,
    false,
  );
  assert.equal(
    (
      await call('playbooks:openLink', {
        context,
        text: 'https://example.com/help',
      })
    ).ok,
    true,
  );
  assert.deepEqual(opened, ['https://example.com/help']);
  const input = { context, id: published.id, version: published.version };
  assert.deepEqual(await call('playbooks:export', input), {
    ok: true,
    value: false,
  });
  assert.equal(
    (await call('playbooks:export', { ...input, version: 0 })).ok,
    false,
  );
  assert.equal(
    (await call('playbooks:export', { ...input, path: '/tmp/arbitrary' })).ok,
    false,
  );
  const path = join(dir, 'safe.md');
  chooseExport = async () => path;
  assert.equal((await call('playbooks:export', input)).ok, true);
  assert.ok(!(await readFile(path, 'utf8')).includes('alex@example.test'));
  chooseExport = async () => join(dir, 'missing-folder', 'guide.md');
  const failedExport = await call('playbooks:export', input);
  assert.equal(failedExport.ok, false);
  assert.match(failedExport.error, /could not be exported/);
  let finish;
  chooseExport = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = call('playbooks:export', input);
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  state.switchContext();
  finish(join(dir, 'stale.md'));
  assert.equal((await pending).ok, false);
  await assert.rejects(readFile(join(dir, 'stale.md')), { code: 'ENOENT' });
});
