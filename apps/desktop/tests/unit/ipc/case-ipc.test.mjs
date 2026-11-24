import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../../../src/main/features/cases/store.ts';
import {
  CaseService,
  CHANGED_SINCE,
} from '../../../src/main/features/cases/service.ts';
import { registerCasesIpc } from '../../../src/main/features/cases/ipc.ts';
import {
  caseEnvironment,
  caseOperation,
} from '../../support/case-environment.mjs';

const finding = (text) => ({
  section: 'findings',
  kind: 'item',
  text,
  pill: 'Guess',
});
async function setup(t) {
  const home = await mkdtemp(join(tmpdir(), 'supahelp-case-ipc-')),
    state = caseEnvironment();
  const cases = new CaseService(
    new CaseStore(join(home, 'cases.db')),
    () => {},
    state.environment,
  );
  const handlers = new Map(),
    frame = {},
    webContents = { mainFrame: frame, getURL: () => 'file:///app/index.html' };
  const event = { sender: webContents, senderFrame: frame };
  const chat = {
    id: 'chat-a',
    title: 'Alex Example alex@example.test',
    status: 'idle',
    messages: [{ role: 'user', text: 'Ticket #123' }],
  };
  let selections = 0,
    refreshed = 0,
    undone = 0;
  let removalBlocked = false;
  registerCasesIpc(
    { handle: (name, run) => handlers.set(name, run) },
    () => ({ webContents }),
    'file:///app/index.html',
    cases,
    {
      snapshot: () => ({ chats: [chat] }),
      refreshTools: (id) => {
        assert.equal(id, chat.id);
        refreshed++;
      },
      caseUndone: () => {
        undone++;
      },
    },
    async () => {
      selections++;
      return { provider: 'claude', model: 'fixture-model' };
    },
    () => removalBlocked,
  );
  t.after(async () => {
    cases.close();
    await rm(home, { recursive: true, force: true });
  });
  return {
    ...state,
    cases,
    handlers,
    event,
    chat,
    context: () => state.environment.context(),
    op: () => caseOperation(state.environment.context()),
    selections: () => selections,
    refreshed: () => refreshed,
    undone: () => undone,
    blockRemoval: (value) => {
      removalBlocked = value;
    },
    call: (name, args) => handlers.get(`cases:${name}`)(event, args),
  };
}

test('case IPC validates sender, exact arguments and origin before model access', async (t) => {
  const s = await setup(t),
    context = s.context();
  const wrong = await s.handlers.get('cases:create')(
    { ...s.event, senderFrame: {} },
    { chatId: 'chat-a', context },
  );
  assert.equal(wrong.ok, false);
  for (const args of [
    undefined,
    'chat-a',
    { chatId: 'chat-a' },
    { chatId: 'chat-a', context, actor: 'other' },
    { chatId: 'chat-a', context: { ...context, generation: 0 } },
  ])
    assert.equal((await s.call('create', args)).ok, false);
  assert.equal(s.selections(), 0);
  assert.deepEqual(s.cases.snapshot().cases, []);
});

test('rename IPC rejects untrusted, malformed and stale requests before masking', async (t) => {
  const s = await setup(t),
    context = s.context();
  const id = await s.cases.create(s.chat, s.op());
  const expectedTitle = s.cases.read(id, s.op()).title;
  const args = { context, caseId: id, title: 'Clear title', expectedTitle };
  for (const value of [
    undefined,
    { ...args, extra: true },
    { ...args, title: '' },
    { ...args, expectedTitle: 'old' },
    { ...args, context: { ...context, generation: 0 } },
  ])
    assert.equal((await s.call('rename', value)).ok, false);
  assert.equal(
    (
      await s.handlers.get('cases:rename')(
        { ...s.event, senderFrame: {} },
        args,
      )
    ).ok,
    false,
  );
  assert.equal(s.selections(), 0);
  const result = await s.call('rename', args);
  assert.deepEqual(result, { ok: true, value: 'Clear title' });
  assert.equal(s.cases.read(id, s.op()).title, 'Clear title');
});

test('removing a case hides it and leaves its source chat available for a new case', async (t) => {
  const s = await setup(t),
    context = s.context();
  const id = await s.cases.create(s.chat, s.op());
  assert.equal(
    (
      await s.call('remove', {
        caseId: id,
        context: { ...context, generation: 0 },
      })
    ).ok,
    false,
  );
  assert.equal(s.cases.caseForChat(s.chat.id), id);
  s.blockRemoval(true);
  assert.match(
    (await s.call('remove', { caseId: id, context })).error,
    /Settle pending/,
  );
  s.blockRemoval(false);
  s.chat.status = 'running';
  assert.match(
    (await s.call('remove', { caseId: id, context })).error,
    /Stop the attached chat/,
  );
  s.chat.status = 'idle';
  assert.equal((await s.call('remove', { caseId: id, context })).ok, true);
  assert.deepEqual(s.cases.snapshot().cases, []);
  assert.equal(s.cases.caseForChat(s.chat.id), undefined);
  assert.throws(() => s.cases.read(id, s.op()), /unknown-case/);
  const replacement = await s.cases.create(s.chat, s.op());
  assert.notEqual(replacement, id);
  assert.equal(s.cases.read(replacement, s.op()).number, 2);
});

test('create, real stored Markdown and permitted Undo use the current personal context', async (t) => {
  const s = await setup(t),
    context = s.context();
  assert.equal((await s.call('list', { context })).ok, true);
  const created = await s.call('create', { chatId: 'chat-a', context });
  assert.equal(created.ok, true);
  assert.equal(s.refreshed(), 1);
  const change = await s.cases.edit(
    created.value,
    undefined,
    finding('Alex Example investigated'),
    s.op(),
  );
  const markdown = await s.call('markdown', { caseId: created.value, context });
  assert.equal(markdown.ok, true);
  assert.ok(markdown.value.includes('Alex Example'));
  assert.doesNotMatch(markdown.value, /alex@example.test/);
  assert.equal(
    (
      await s.call('undo', {
        caseId: created.value,
        changeId: change.changeId,
        context,
      })
    ).ok,
    true,
  );
  assert.equal(s.undone(), 1);
  assert.deepEqual(s.cases.read(created.value, s.op()).entries, []);
  const repeated = await s.call('undo', {
    caseId: created.value,
    changeId: change.changeId,
    context,
  });
  assert.equal(repeated.ok, false);
  assert.equal(repeated.error, 'Already undone.');
});

test('stale Undo and stale-context IPC cannot edit, read or copy saved records', async (t) => {
  const s = await setup(t),
    context = s.context();
  const { value: id } = await s.call('create', { chatId: 'chat-a', context });
  const first = await s.cases.edit(id, undefined, finding('First'), s.op());
  await s.cases.edit(id, first.entryId, finding('Later'), s.op());
  const undo = await s.call('undo', {
    caseId: id,
    changeId: first.changeId,
    context,
  });
  assert.equal(undo.ok, false);
  assert.equal(undo.error, CHANGED_SINCE);
  s.switchContext();
  for (const [name, args] of [
    ['list', { context }],
    ['create', { chatId: 'chat-a', context }],
    ['markdown', { caseId: id, context }],
    ['undo', { caseId: id, changeId: first.changeId, context }],
  ])
    assert.equal((await s.call(name, args)).ok, false);
  assert.equal(s.cases.read(id, s.op()).entries[0].text, 'Later');
});

test('human edit IPC validates exact inputs and saves checked human-attributed entries', async (t) => {
  const s = await setup(t),
    context = s.context();
  assert.ok(s.handlers.has('cases:edit'), 'human edit operation is registered');
  const { value: caseId } = await s.call('create', {
    chatId: 'chat-a',
    context,
  });
  const input = {
    action: 'add',
    caseId,
    requestId: randomUUID(),
    context,
    value: finding('Alex Example checked'),
  };
  const before = s.selections();
  for (const bad of [
    { ...input, actor: 'other' },
    { ...input, requestId: 'bad' },
    { ...input, action: 'publish' },
    { ...input, value: { ...input.value, systemOwned: true } },
    { ...input, context: { ...context, generation: 0 } },
  ])
    assert.equal((await s.call('edit', bad)).ok, false);
  assert.equal(
    (await s.handlers.get('cases:edit')({ ...s.event, senderFrame: {} }, input))
      .ok,
    false,
  );
  assert.equal(s.selections(), before);
  const result = await s.call('edit', input);
  assert.equal(result.ok, true, result.error);
  assert.equal(
    s.cases.read(caseId, s.op()).entries[0].text,
    'Alex Example checked',
  );
  assert.equal(s.cases.read(caseId, s.op()).changes[0].onBehalfOf, undefined);
  assert.equal((await s.call('edit', input)).ok, false);
  const update = {
    action: 'update',
    caseId,
    entryId: result.value.entryId,
    version: 1,
    requestId: randomUUID(),
    context,
    value: finding('Corrected'),
  };
  assert.equal((await s.call('edit', update)).ok, true);
  assert.equal(
    (await s.call('edit', { ...update, requestId: randomUUID() })).ok,
    false,
  );
  assert.equal(
    (
      await s.call('edit', {
        action: 'remove',
        caseId,
        entryId: result.value.entryId,
        version: 2,
        requestId: randomUUID(),
        context,
      })
    ).ok,
    true,
  );
});

test('late Cancel never rolls back a commit', async (t) => {
  const s = await setup(t),
    context = s.context();
  const { value: caseId } = await s.call('create', {
    chatId: 'chat-a',
    context,
  });
  const requestId = randomUUID();
  assert.equal(
    (
      await s.call('edit', {
        action: 'add',
        caseId,
        requestId,
        context,
        value: finding('Committed'),
      })
    ).ok,
    true,
  );
  assert.equal((await s.call('cancelEdit', { requestId, context })).ok, true);
  assert.equal(s.cases.read(caseId, s.op()).entries.length, 1);
});

test('stored Markdown retains optional details from human text and row entries', async (t) => {
  const s = await setup(t),
    context = s.context();
  const { value: caseId } = await s.call('create', {
    chatId: 'chat-a',
    context,
  });
  for (const value of [
    {
      section: 'summary',
      kind: 'text',
      text: 'Summary',
      detail: 'Additional context',
    },
    {
      section: 'problem',
      kind: 'row',
      label: 'Observed',
      text: 'Two invoices',
      detail: 'Checked in billing',
    },
  ])
    assert.equal(
      (
        await s.call('edit', {
          action: 'add',
          caseId,
          context,
          requestId: randomUUID(),
          value,
        })
      ).ok,
      true,
    );
  const markdown = await s.call('markdown', { caseId, context });
  assert.match(markdown.value, /Summary — Additional context/);
  assert.match(markdown.value, /Two invoices — Checked in billing/);
});

test('manual case assignment validates the frame, context, target and fields without model inference', async (t) => {
  const s = await setup(t);
  const id = await s.cases.create(s.chat, s.op());
  const args = {
    caseId: id,
    context: s.context(),
    action: 'bring-in',
    recipientId: 'local',
    ownerRevision: 0,
  };
  assert.equal(
    (
      await s.handlers.get('cases:assign')(
        { ...s.event, senderFrame: {} },
        args,
      )
    ).ok,
    false,
  );
  for (const input of [
    { ...args, recipientId: 'other' },
    { ...args, ownerRevision: 1 },
    { ...args, extra: true },
    { ...args, context: { ...s.context(), generation: 99 } },
  ])
    assert.equal((await s.call('assign', input)).ok, false);
  assert.deepEqual(s.cases.read(id, s.op()).contributorIds, []);
  assert.equal((await s.call('assign', args)).ok, true);
  assert.deepEqual(s.cases.read(id, s.op()).contributorIds, ['local']);
  assert.equal(s.selections(), 0);
});
