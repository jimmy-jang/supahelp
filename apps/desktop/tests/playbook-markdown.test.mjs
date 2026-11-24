import { documentContent } from '../src/main/features/playbooks/validation.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CaseStore } from '../src/main/features/cases/store.ts';

import { caseEnvironment } from './support/case-environment.mjs';

test('freeform Markdown retains tables, code and arbitrary sections without a step limit', () => {
  const content = {
    title: 'Team procedure',
    markdown:
      '# Context\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```sh\necho safe\n```\n' +
      '- [ ] Check\n'.repeat(20),
  };
  assert.deepEqual(documentContent(content), content);
  assert.throws(
    () => documentContent({ ...content, markdown: 'a'.repeat(32001) }),
    /invalid-entry/,
  );
  assert.throws(
    () => documentContent({ ...content, steps: [] }),
    /invalid-entry/,
  );
});

test('legacy drafts, publications and history migrate once with versions and images intact', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-migration-'));
  const file = join(dir, 'cases.db');
  let store = new CaseStore(file);
  store.close();
  const db = new DatabaseSync(file);
  db.exec(
    'CREATE TABLE playbooks (id TEXT PRIMARY KEY, version INTEGER NOT NULL, value TEXT NOT NULL); CREATE TABLE resolutions (id TEXT PRIMARY KEY, case_id TEXT, value TEXT NOT NULL); PRAGMA user_version = 3;',
  );
  const old = {
    title: 'Keep me',
    what: 'Line one\nLine two',
    steps: [
      { id: 'one', text: 'Check\ncarefully', screenshotId: 'image-1' },
      { id: 'two', text: 'Verify' },
    ],
  };
  const record = {
    id: 'book',
    version: 7,
    updatedAt: 'before',
    publishedAt: 'earlier',
    draft: old,
    published: old,
    history: [{ at: 'old', content: old }],
  };
  db.prepare('INSERT INTO playbooks VALUES (?, ?, ?)').run(
    'book',
    7,
    JSON.stringify(record),
  );
  store = new CaseStore(file);
  t.after(async () => {
    store.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  await store.recover(caseEnvironment().environment.encryption, () => {});
  const migrated = store.books.playbooks()[0];
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  assert.equal(migrated.version, 7);
  assert.equal(migrated.updatedAt, 'before');
  assert.match(migrated.draft.markdown, /Line one\nLine two/);
  assert.match(migrated.draft.markdown, /playbook-image:image-1/);
  assert.ok(
    migrated.draft.markdown.indexOf('Check') <
      migrated.draft.markdown.indexOf('Verify'),
  );
  assert.deepEqual(migrated.history[0].content, migrated.published);
  assert.deepEqual(store.books.playbooks()[0], migrated);
  store.startPilot();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
});

test('malformed legacy content rolls back migration without partial conversion', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-rollback-'));
  const file = join(dir, 'cases.db');
  let store = new CaseStore(file);
  store.close();
  const db = new DatabaseSync(file);
  db.exec(
    'CREATE TABLE playbooks (id TEXT PRIMARY KEY, version INTEGER NOT NULL, value TEXT NOT NULL); CREATE TABLE resolutions (id TEXT PRIMARY KEY, case_id TEXT, value TEXT NOT NULL); PRAGMA user_version = 3;',
  );
  const raw = JSON.stringify({
    id: 'bad',
    draft: { title: 'Bad', what: 'Retain', steps: null },
  });
  db.prepare('INSERT INTO playbooks VALUES (?, ?, ?)').run('bad', 1, raw);
  store = new CaseStore(file);
  t.after(async () => {
    store.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  await store.recover(caseEnvironment().environment.encryption, () => {});
  assert.throws(() => store.books.playbooks());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(db.prepare('SELECT value FROM playbooks').get().value, raw);
});
