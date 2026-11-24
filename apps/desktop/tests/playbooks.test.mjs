import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CaseStore } from '../src/main/features/cases/store.ts';
import { CaseService } from '../src/main/features/cases/service.ts';
import { caseEnvironment, caseOperation } from './support/case-environment.mjs';
import { PlaybookService } from '../src/main/features/playbooks/service.ts';
import { ResolveService } from '../src/main/features/cases/resolve.ts';
import { caseAgent } from '../src/main/features/cases/agent.ts';
import { playbookAgent } from '../src/main/features/playbooks/agent.ts';
import { DatabaseSync } from 'node:sqlite';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'playbooks-service-'));
  const state = caseEnvironment(),
    store = new CaseStore(join(dir, 'cases.db'));
  const cases = new CaseService(store, () => {}, state.environment);
  t.after(async () => {
    cases.close();
    await rm(dir, { recursive: true, force: true });
  });
  await cases.prepare(caseOperation());
  const books = new PlaybookService(cases, cases.store.books, () => {});
  const resolve = new ResolveService(cases, books, () => false);
  return { state, cases, books, resolve, op: () => caseOperation(), store };
}
const content = (text = 'Check result') => ({
  title: 'Retries',
  markdown: `Safe retries\n\n${text}`,
});

test('chat drafts are masked, versioned and isolated, with confirmation-only publication', async (t) => {
  const s = await setup(t);
  const op = s.op();
  let controller = new AbortController();
  let focus, receipt;
  let userText = 'Are you able to create a sample Playbook?';
  const agent = playbookAgent(
    s.books,
    [],
    {
      ...op,
      get signal() {
        return controller.signal;
      },
    },
    {
      focus: () => focus,
      caseId: () => undefined,
      userText: () => userText,
      offer(action) {
        receipt = action;
        if (action.kind === 'saved') focus = action.playbookId;
      },
    },
  );
  const call = async (name, args) => {
    const result = await agent.call(name, args);
    assert.equal(result.isError, undefined, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const sample = {
    title: 'Review CSV export',
    markdown: 'Alex Example hid the Date column.',
  };
  const [created, retried] = await Promise.all([
    call('save_playbook_draft', sample),
    call('save_playbook_draft', sample),
  ]);
  assert.equal(created.id, retried.id);
  assert.equal(s.books.list(op).length, 1);
  assert.equal(receipt.kind, 'saved');
  controller = new AbortController();
  userText = 'Add a verification step';
  const current = await call('read_playbook_for_editing', {});
  const update = {
    id: current.id,
    version: current.version,
    ...current.draft,
    markdown: 'Verify that Date has values.',
  };
  assert.equal((await call('save_playbook_draft', update)).saved, true);
  assert.equal((await agent.call('save_playbook_draft', update)).isError, true);
  assert.equal(s.books.read(created.id, op).draft.markdown, update.markdown);
  const proposed = await call('request_playbook_action', { action: 'publish' });
  assert.equal(proposed.awaitingUser, true);
  assert.equal(receipt.kind, 'publish');
  assert.equal(s.books.read(created.id, op).published, undefined);
  assert.equal(
    (await agent.call('publish_playbook', { id: created.id })).isError,
    true,
  );
  const other = await s.books.save(undefined, 0, content(), op);
  assert.equal(
    (await call('read_playbook_for_editing', { id: other.id }))
      .selectionRequired,
    true,
  );
  userText = 'Show the Playbook called Retries';
  assert.equal(
    (await call('read_playbook_for_editing', {})).selectionRequired,
    true,
  );
  assert.equal(
    (await call('read_playbook_for_editing', { id: other.id })).id,
    other.id,
  );
  userText = '';
  assert.equal((await agent.call('save_playbook_draft', sample)).isError, true);
  userText = 'Create another sample Playbook';
  s.state.switchContext();
  assert.equal((await agent.call('save_playbook_draft', sample)).isError, true);
});

test('removing a published Playbook requires its latest version and keeps other Playbooks', async (t) => {
  const s = await setup(t),
    p = await s.books.save(undefined, 0, content(), s.op());
  const published = s.books.publish(p.id, p.version, s.op());
  const other = await s.books.save(undefined, 0, content('Keep'), s.op());
  assert.throws(() => s.books.remove(p.id, p.version, s.op()), /case-changed/);
  s.books.remove(p.id, published.version, s.op());
  assert.deepEqual(
    s.books.list(s.op()).map((book) => book.id),
    [other.id],
  );
  assert.throws(() => s.books.read(p.id, s.op()), /unknown-playbook/);
});

test('a full-size Markdown body passes the isolated masking boundary without splitting text', async (t) => {
  const s = await setup(t);
  const document = { title: 'Long procedure', markdown: 'a'.repeat(32000) };
  const saved = await s.books.save(undefined, 0, document, s.op());
  assert.deepEqual(saved.draft, document);
});

test('discarding a never-published Playbook removes the abandoned document', async (t) => {
  const s = await setup(t),
    p = await s.books.save(undefined, 0, content(), s.op());
  s.books.discard(p.id, p.version, s.op());
  assert.equal(s.books.list(s.op()).length, 0);
});

test('case Playbook lookup supports legacy drafts and never replaces their content', async (t) => {
  const s = await setup(t);
  const first = await s.books.save(undefined, 0, content(), s.op(), 'case-a');
  s.store.books.savePlaybook(
    { ...first, sourceCaseId: undefined, version: first.version + 1 },
    first.version,
  );
  const legacy = s.books.fromCase('case-a', s.op());
  assert.equal(legacy.id, first.id);
  const retried = await s.books.save(
    undefined,
    0,
    content('Do not overwrite'),
    s.op(),
    'case-a',
  );
  assert.deepEqual(retried, legacy);
  const other = await s.books.save(undefined, 0, content(), s.op(), 'case-b');
  assert.notEqual(other.id, first.id);
  assert.equal(s.books.list(s.op()).length, 2);
  assert.equal(s.books.fromCase('missing', s.op()), undefined);
});

test('an interrupted additive upgrade rolls back without changing v2 cases', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playbook-migrate-')),
    file = join(dir, 'cases.db'),
    store = new CaseStore(file),
    state = caseEnvironment();
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const cases = new CaseService(store, () => {}, state.environment);
  await cases.create(
    { id: 'chat', title: 'Retain me', messages: [] },
    caseOperation(),
  );
  const before = store.cases(),
    db = new DatabaseSync(file);
  db.exec('CREATE TABLE resolutions (unexpected TEXT)');
  assert.throws(() => store.preparePlaybooks());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='playbooks'")
      .get().n,
    0,
  );
  assert.deepEqual(store.cases(), before);
  db.exec('DROP TABLE resolutions');
  store.preparePlaybooks();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  db.close();
});

test('invalid content and cross-document screenshots cannot enter saved drafts', async (t) => {
  const s = await setup(t);
  await assert.rejects(
    s.books.save(
      undefined,
      0,
      { title: 'Foreign', markdown: '![](playbook-image:foreign-image)' },
      s.op(),
    ),
    /invalid-screenshot/,
  );
  await assert.rejects(
    s.books.save(undefined, 0, { ...content(), extra: 'invalid' }, s.op()),
    /invalid-entry/,
  );
  assert.equal(s.books.list(s.op()).length, 0);
});

test('masked drafts do not replace publication; stale updates save nothing', async (t) => {
  const s = await setup(t);
  const draft = await s.books.save(
    undefined,
    0,
    content('alex@example.test'),
    s.op(),
  );
  assert.ok(!JSON.stringify(draft).includes('alex@example.test'));
  const pub = s.books.publish(draft.id, draft.version, s.op());
  const edit = await s.books.save(
    pub.id,
    pub.version,
    content('New text'),
    s.op(),
  );
  assert.deepEqual(edit.published, pub.published);
  await assert.rejects(
    s.books.save(pub.id, pub.version, content(), s.op()),
    /case-changed/,
  );
  s.books.discard(pub.id, edit.version, s.op());
  assert.equal(s.books.read(pub.id, s.op()).draft, undefined);
});

test('case chat saves and offers one masked Resolution draft without resolving the case', async (t) => {
  const s = await setup(t);
  const op = s.op();
  const id = await s.cases.create(
    { id: 'chat', title: 'Retry', messages: [] },
    op,
  );
  let offered;
  const agent = caseAgent(s.cases, 'chat', op, {
    resolve: s.resolve,
    offer: (draft) => {
      offered = draft;
    },
  });
  const save = async (text, version) => {
    assert.equal((await agent.call('read_case', {})).isError, undefined);
    const reply = await agent.call('save_resolution_draft', { text, version });
    assert.equal(reply.isError, undefined, reply.content[0].text);
    return JSON.parse(reply.content[0].text);
  };
  const first = await save('Retry guard confirmed by alex@example.test', 0);
  assert.doesNotMatch(first.text, /alex@example\.test/);
  assert.equal(offered.id, first.id);
  const second = await save(
    'Added a retry guard and verified one invoice.',
    first.version,
  );
  assert.equal(second.id, first.id);
  assert.equal(second.version, 2);
  assert.equal(s.books.snapshot(op).resolutions.length, 1);
  assert.equal(s.cases.read(id, op).status, 'inv');
  assert.equal((await agent.call('confirm_resolve', {})).isError, true);
  assert.equal(
    (await agent.call('save_resolution_draft', { text: 'Stale', version: 1 }))
      .isError,
    true,
  );
  s.resolve.confirm(second.id, second.version, op);
  assert.equal(s.cases.read(id, op).status, 'done');
});

test('Resolve requires explicit confirmation, detects changed source, and retries do not duplicate history', async (t) => {
  const s = await setup(t);
  const id = await s.cases.create(
    { id: 'chat', title: 'Retry', messages: [] },
    s.op(),
  );
  const draft = await s.resolve.save(
    id,
    'request-a',
    'Fixed alex@example.test',
    undefined,
    s.op(),
  );
  assert.equal(s.cases.read(id, s.op()).status, 'inv');
  assert.ok(!draft.text.includes('alex@example.test'));
  s.resolve.confirm(draft.id, draft.version, s.op());
  s.resolve.confirm(draft.id, draft.version, s.op());
  assert.equal(s.cases.read(id, s.op()).status, 'done');
  assert.equal(s.cases.read(id, s.op()).changes.length, 1);
  const confirmed = s.cases.read(id, s.op()).changes[0];
  assert.throws(() => s.cases.undo(id, confirmed.id, s.op()), /reserved-field/);
  s.resolve.reopen(id, s.op());
  const stale = await s.resolve.save(
    id,
    'request-b',
    'Another fix',
    undefined,
    s.op(),
  );
  await s.cases.edit(
    id,
    undefined,
    { section: 'summary', kind: 'text', text: 'New fact' },
    s.op(),
  );
  assert.throws(
    () => s.resolve.confirm(stale.id, stale.version, s.op()),
    /case-changed/,
  );
  assert.equal(s.cases.read(id, s.op()).status, 'inv');
});

test('Playbook capabilities expose only explicitly attached published text and end on cancellation', async (t) => {
  const s = await setup(t),
    a = await s.books.save(undefined, 0, content(), s.op()),
    b = await s.books.save(undefined, 0, content('Private draft'), s.op());
  s.books.publish(a.id, a.version, s.op());
  const controller = new AbortController(),
    agent = playbookAgent(s.books, [a.id], {
      ...s.op(),
      signal: controller.signal,
    });
  assert.deepEqual(
    agent.tools.map((tool) => tool.name),
    ['lookup_saved_work', 'search_saved_work', 'read_playbook'],
  );
  assert.equal(
    (await agent.call('read_playbook', { id: a.id })).isError,
    undefined,
  );
  assert.equal((await agent.call('read_playbook', { id: b.id })).isError, true);
  assert.equal((await agent.call('publish', { id: a.id })).isError, true);
  controller.abort();
  assert.equal((await agent.call('read_playbook', { id: a.id })).isError, true);
});

test('Resolve blocks known actions', async (t) => {
  const s = await setup(t),
    id = await s.cases.create(
      { id: 'chat', title: 'Test', messages: [] },
      s.op(),
    );
  const resolve = new ResolveService(s.cases, s.books, () => true),
    draft = await resolve.save(id, 'request', 'Fixed', undefined, s.op());
  assert.throws(
    () => resolve.confirm(draft.id, draft.version, s.op()),
    /resolve-actions/,
  );
});

test('a retained Resolution draft stays confirmable when a new chat resumes the unchanged case', async (t) => {
  const s = await setup(t),
    id = await s.cases.create(
      { id: 'old-chat', title: 'Retain', messages: [] },
      s.op(),
    );
  const draft = await s.resolve.save(
    id,
    'retained-draft',
    'Fixed safely',
    undefined,
    s.op(),
  );
  s.store.linkChat(id, 'new-chat', new Date().toISOString());
  s.resolve.confirm(draft.id, draft.version, s.op());
  assert.equal(s.cases.read(id, s.op()).status, 'done');
});

test('v3 adds durable versioned Playbooks without changing case records', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'playbooks-'));
  let store = new CaseStore(join(dir, 'cases.db'));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const state = caseEnvironment();
  const cases = new CaseService(store, () => {}, state.environment);
  const id = await cases.create(
    { id: 'chat', title: 'Test', messages: [] },
    caseOperation(),
  );
  assert.equal(typeof store.preparePlaybooks, 'function');
  store.preparePlaybooks();
  const original = cases.snapshot().cases[0];
  const doc = {
    title: 'Retry',
    markdown: 'Safe retries\n\nCheck result',
  };
  store.books.savePlaybook(
    {
      id: 'pb',
      workspaceId: 'personal',
      ownerId: 'local',
      version: 1,
      draft: doc,
      updatedAt: 'now',
    },
    0,
  );
  assert.throws(
    () => store.books.savePlaybook({ id: 'pb', version: 2 }, 0),
    /case-changed/,
  );
  store.close();
  store = new CaseStore(join(dir, 'cases.db'));
  await store.recover(state.environment.encryption, () => {});
  store.preparePlaybooks();
  assert.deepEqual(store.books.playbooks()[0].draft, doc);
  assert.deepEqual(
    store.cases().find((c) => c.id === id),
    original,
  );
});

test('a Playbook drafted from a case still returns that case after publish', async (t) => {
  const s = await setup(t),
    caseId = await s.cases.create(
      { id: 'chat-src', title: 'Duplicate invoices', messages: [] },
      s.op(),
    ),
    c = s.cases.read(caseId, s.op()),
    p = await s.books.save(undefined, 0, content(), s.op(), c.id),
    published = s.books.publish(p.id, p.version, s.op());
  assert.equal(published.sourceCaseId, c.id);
  const agent = playbookAgent(s.books, [p.id], s.op()),
    result = await agent.call('read_playbook', { id: p.id }),
    read = JSON.parse(result.content[0].text);
  assert.equal(read.sourceCase.number, c.number);
  assert.equal(read.sourceCase.title, c.title);
  const plain = await s.books.save(undefined, 0, content(), s.op()),
    other = playbookAgent(s.books, [plain.id], s.op()),
    none = JSON.parse(
      (await other.call('read_playbook', { id: plain.id })).content[0].text,
    );
  assert.equal(none.sourceCase, undefined);
});
