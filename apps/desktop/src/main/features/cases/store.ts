import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import type {
  CaseChange,
  CaseEntry,
  CaseRecord,
  EntryValue,
} from '../../../contracts/cases';
import type { PilotReport } from '../../../contracts/pilot-metrics';
import { PILOT_COUNT_KEYS } from '../../../contracts/pilot-metrics.ts';
import type { ResolutionDraft } from '../../../contracts/playbooks';
import type { Encryption } from '../../platform/auth-store';
import { PlaybookStore } from '../playbooks/store.ts';

// The personal workspace inside one account or guest database.
export const PERSONAL = 'personal';

function markdownPlaybook(input: unknown) {
  if (!input || typeof input !== 'object') throw Error('invalid-entry');
  const c = input as { title?: unknown; what?: unknown; steps?: unknown };
  if (
    typeof c.title !== 'string' ||
    typeof c.what !== 'string' ||
    !Array.isArray(c.steps)
  )
    throw Error('invalid-entry');
  const steps = c.steps.map((step, i) => {
    if (
      !step ||
      typeof step.text !== 'string' ||
      (step.screenshotId !== undefined &&
        !/^[a-zA-Z0-9-]{1,100}$/.test(step.screenshotId))
    )
      throw Error('invalid-entry');
    return `${i + 1}. ${step.text.replace(/\n/g, '\n   ')}${step.screenshotId ? `\n\n   ![Reviewed screenshot](playbook-image:${step.screenshotId})` : ''}`;
  });
  return {
    title: c.title,
    markdown: `## What is this\n\n${c.what}\n\n## How to fix it\n\n${steps.join('\n\n')}`,
  };
}

// Version 2 means every text value, including deleted rows/history, passed masking.
const SCHEMA = `
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, org_id TEXT, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'team'))
);
CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  number INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
  owner_id TEXT NOT NULL, ticket TEXT NOT NULL, issue TEXT,
  customer_name TEXT NOT NULL, customer_ref TEXT,
  customer_confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  UNIQUE (workspace_id, number)
);
CREATE TABLE entries (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id),
  section TEXT NOT NULL, kind TEXT NOT NULL, label TEXT, text TEXT NOT NULL,
  detail TEXT, pill TEXT, position INTEGER NOT NULL, version INTEGER NOT NULL,
  author_id TEXT NOT NULL, on_behalf_of TEXT, updated_at TEXT NOT NULL,
  deleted_at TEXT, system_owned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE changes (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id),
  entry_id TEXT NOT NULL, before TEXT, after TEXT, by TEXT NOT NULL,
  on_behalf_of TEXT, at TEXT NOT NULL, undone_at TEXT, applied_version INTEGER
);
CREATE TABLE chat_links (
  chat_id TEXT NOT NULL, case_id TEXT NOT NULL REFERENCES cases(id),
  attached_at TEXT NOT NULL, PRIMARY KEY (chat_id, case_id)
);
CREATE INDEX entries_case ON entries(case_id);
CREATE INDEX changes_case ON changes(case_id);
`;

type Row = Record<string, string | number | null>;
export type PilotState =
  | {
      definitionVersion: 1;
      state: 'collecting';
      caseNumberFloor: number;
      created: number;
      updated: number;
    }
  | { definitionVersion: 1; state: 'finished'; report: PilotReport };
const COLUMNS = {
  workspaces: ['id', 'org_id', 'name', 'kind'],
  cases: [
    'id',
    'workspace_id',
    'number',
    'title',
    'status',
    'owner_id',
    'contributor_ids',
    'ticket',
    'issue',
    'customer_name',
    'customer_ref',
    'customer_confirmed',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  entries: [
    'id',
    'case_id',
    'section',
    'kind',
    'label',
    'text',
    'detail',
    'pill',
    'position',
    'version',
    'author_id',
    'on_behalf_of',
    'updated_at',
    'deleted_at',
    'system_owned',
  ],
  changes: [
    'id',
    'case_id',
    'entry_id',
    'before',
    'after',
    'by',
    'on_behalf_of',
    'at',
    'undone_at',
    'applied_version',
  ],
  chat_links: ['chat_id', 'case_id', 'attached_at'],
} as const;
export type CaseRows = { [K in keyof typeof COLUMNS]: Row[] };
const opt = (v: unknown) => (v == null ? undefined : String(v));

function entry(r: Row): CaseEntry {
  return {
    id: String(r.id),
    section: r.section as CaseEntry['section'],
    kind: r.kind as CaseEntry['kind'],
    label: opt(r.label),
    text: String(r.text),
    detail: opt(r.detail),
    pill: opt(r.pill),
    position: Number(r.position),
    version: Number(r.version),
    authorId: String(r.author_id),
    onBehalfOf: opt(r.on_behalf_of),
    updatedAt: String(r.updated_at),
    systemOwned: !!r.system_owned,
  };
}

const json = (v: unknown) =>
  v == null ? undefined : (JSON.parse(String(v)) as EntryValue);

// ponytail: synchronous SQLite on the main thread. Local case counts keep
// each query well under a millisecond; move to a worker if one shows up in
// profiles.
export class CaseStore {
  private db: DatabaseSync;
  readonly books: PlaybookStore;
  private file: string;
  private schemaVersion: number;
  ready = false;

  constructor(file: string) {
    this.file = file;
    this.db = new DatabaseSync(file);
    this.books = new PlaybookStore(
      () => this.db,
      () => this.preparePlaybooks(),
      (run) => this.transaction(run),
      (id, updated) => this.countPilotPublication(id, updated),
    );
    this.configure();
    const { user_version } = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (user_version === 0)
      this.transaction(() => {
        this.db.exec(SCHEMA);
        this.db
          .prepare(
            "INSERT INTO workspaces (id, org_id, name, kind) VALUES (?, NULL, 'Personal', 'personal')",
          )
          .run(PERSONAL);
        this.db.exec('PRAGMA user_version = 2');
      });
    else if (user_version > 5)
      throw Error('This case database is from a newer Supahelp.');
    this.schemaVersion = user_version || 2;
    if (
      !this.db
        .prepare('PRAGMA table_info(cases)')
        .all()
        .some((c) => c.name === 'contributor_ids')
    )
      this.db.exec(
        "ALTER TABLE cases ADD COLUMN contributor_ids TEXT NOT NULL DEFAULT '[]'",
      );
  }

  async activate(file: string) {
    if (file === this.file && this.db.isOpen) return;
    this.ready = false;
    if (this.db.isOpen) {
      const checkpoint = this.db
        .prepare('PRAGMA wal_checkpoint(TRUNCATE)')
        .get();
      if (checkpoint?.busy) throw Error('case-recovery');
      this.db.close();
    }
    const replacement = new CaseStore(file);
    this.db = replacement.db;
    this.file = file;
    this.schemaVersion = replacement.schemaVersion;
  }

  get legacy() {
    return this.schemaVersion === 1;
  }

  private configure() {
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;',
    );
  }

  private valid() {
    if (
      this.db.prepare('PRAGMA integrity_check').get()?.integrity_check !==
        'ok' ||
      this.db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw Error('case-recovery');
  }

  rows(): CaseRows {
    return Object.fromEntries(
      Object.keys(COLUMNS).map((table) => [
        table,
        this.db.prepare(`SELECT * FROM ${table}`).all(),
      ]),
    ) as CaseRows;
  }

  private sameRecords(original: CaseRows) {
    const current = this.rows();
    for (const table of Object.keys(COLUMNS) as (keyof CaseRows)[]) {
      const identities = (rows: Row[]) =>
        rows
          .map((row) =>
            table === 'chat_links'
              ? `${row.chat_id}:${row.case_id}`
              : String(row.id),
          )
          .sort();
      if (
        JSON.stringify(identities(current[table])) !==
        JSON.stringify(identities(original[table]))
      )
        throw Error('case-recovery');
    }
  }

  async recover(encryption: Encryption, guard: () => void) {
    guard();
    let bytes: Buffer;
    try {
      bytes = await readFile(`${this.file}.recovery.enc`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw Error('case-recovery');
      guard();
      this.ready = !this.legacy;
      return;
    }
    if (!(await encryption.isEncryptionAvailable()))
      throw Error('case-recovery');
    const original = JSON.parse(
      await encryption.decryptString(bytes),
    ) as CaseRows;
    guard();
    this.valid();
    this.sameRecords(original);
    if (!this.legacy) {
      await rm(`${this.file}.recovery.enc`);
      guard();
      this.ready = true;
    }
  }

  async upgrade(rows: CaseRows, encryption: Encryption, guard: () => void) {
    guard();
    if (!this.legacy || this.ready) throw Error('case-recovery');
    if (!(await encryption.isEncryptionAvailable()))
      throw Error('case-recovery');
    const original = this.rows();
    const encrypted = await encryption.encryptString(JSON.stringify(original));
    guard();
    const recovery = `${this.file}.recovery.enc`,
      next = `${this.file}.masked-next`;
    // A previous attempt is validated by recover() before reaching this path.
    await writeFile(`${recovery}.tmp`, encrypted, { mode: 0o600, flush: true });
    await rename(`${recovery}.tmp`, recovery);
    await chmod(recovery, 0o600);
    guard();
    await rm(next, { force: true });
    await rm(`${next}-wal`, { force: true });
    await rm(`${next}-shm`, { force: true });
    const replacement = new CaseStore(next);
    try {
      replacement.transaction(() => {
        replacement.db.exec('DELETE FROM workspaces');
        for (const table of Object.keys(COLUMNS) as (keyof CaseRows)[]) {
          const columns = COLUMNS[table];
          const insert = replacement.db.prepare(
            `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
          );
          for (const row of rows[table])
            insert.run(
              ...columns.map(
                (column) =>
                  row[column] ?? (column === 'system_owned' ? 0 : null),
              ),
            );
        }
      });
      replacement.valid();
      replacement.sameRecords(original);
      replacement.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
    } finally {
      replacement.close();
    }
    await chmod(next, 0o600);
    guard();
    const checkpoint = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (checkpoint?.busy) throw Error('case-recovery');
    this.db.close();
    try {
      await rm(`${this.file}-wal`, { force: true });
      await rm(`${this.file}-shm`, { force: true });
      guard();
      await rename(next, this.file);
    } finally {
      this.db = new DatabaseSync(this.file);
      this.configure();
      this.schemaVersion = Number(
        this.db.prepare('PRAGMA user_version').get()?.user_version,
      );
    }
    this.valid();
    this.sameRecords(original);
    guard();
    await rm(recovery);
    guard();
    this.ready = true;
  }

  close() {
    if (this.db.isOpen) this.db.close();
  }

  customerDb() {
    if (!this.ready) throw Error('case-masking-required');
    const tables = this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name IN ('customers', 'case_customers')",
      )
      .get();
    return tables?.count === 2 ? this.db : undefined;
  }

  transaction<T>(run: () => T): T {
    if (this.db.isTransaction) return run();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  preparePlaybooks() {
    if (!this.ready) throw Error('case-masking-required');
    if (this.schemaVersion >= 5) return;
    this.transaction(() => {
      if (this.schemaVersion < 3)
        this.db
          .exec(`CREATE TABLE playbooks (id TEXT PRIMARY KEY, version INTEGER NOT NULL, value TEXT NOT NULL);
        CREATE TABLE resolutions (id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), value TEXT NOT NULL);
        `);
      if (this.schemaVersion < 4)
        this.db.exec(
          'CREATE TABLE pilot_metrics (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)',
        );
      for (const row of this.db
        .prepare('SELECT id, value FROM playbooks')
        .all()) {
        const record = JSON.parse(String(row.value));
        if (record.draft) record.draft = markdownPlaybook(record.draft);
        if (record.published)
          record.published = markdownPlaybook(record.published);
        if (record.history)
          record.history = record.history.map(
            (h: { at: string; content: unknown }) => ({
              ...h,
              content: markdownPlaybook(h.content),
            }),
          );
        this.db
          .prepare('UPDATE playbooks SET value = ? WHERE id = ?')
          .run(JSON.stringify(record), row.id);
      }
      this.db.exec('PRAGMA user_version = 5');
    });
    this.schemaVersion = 5;
  }
  setResolved(caseId: string, done: boolean, at: string) {
    this.setStatus(caseId, done ? 'done' : 'inv', at);
  }
  setStatus(caseId: string, status: CaseRecord['status'], at: string) {
    this.db
      .prepare('UPDATE cases SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, at, caseId);
  }
  linkChat(caseId: string, chatId: string, at: string) {
    this.db
      .prepare(
        'INSERT INTO chat_links (chat_id, case_id, attached_at) VALUES (?, ?, ?)',
      )
      .run(chatId, caseId, at);
  }
  unlinkChat(caseId: string, chatId: string) {
    this.db
      .prepare('DELETE FROM chat_links WHERE case_id = ? AND chat_id = ?')
      .run(caseId, chatId);
  }

  pilot(): PilotState | undefined {
    if (!this.ready) throw Error('case-masking-required');
    if (this.schemaVersion < 4) return;
    const rows = this.db.prepare('SELECT id, value FROM pilot_metrics').all();
    if (!rows.length) return;
    if (rows.length !== 1 || rows[0].id !== 1) throw Error('pilot-state');
    let value: PilotState;
    try {
      value = JSON.parse(String(rows[0].value));
    } catch {
      throw Error('pilot-state');
    }
    const exact = (v: unknown, keys: readonly string[]) =>
      !!v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v).length === keys.length &&
      keys.every((k) => Object.hasOwn(v, k));
    const count = (n: unknown) =>
      typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
    if (!value || value.definitionVersion !== 1) throw Error('pilot-state');
    if (value.state === 'collecting') {
      if (
        !exact(value, [
          'definitionVersion',
          'state',
          'caseNumberFloor',
          'created',
          'updated',
        ]) ||
        ![value.caseNumberFloor, value.created, value.updated].every(count)
      )
        throw Error('pilot-state');
    } else if (value.state === 'finished') {
      const r = value.report;
      if (
        !exact(value, ['definitionVersion', 'state', 'report']) ||
        !exact(r, ['formatVersion', 'definitionVersion', 'counts']) ||
        r.formatVersion !== 1 ||
        r.definitionVersion !== 1 ||
        !exact(r.counts, PILOT_COUNT_KEYS) ||
        !Object.values(r.counts).every(count)
      )
        throw Error('pilot-state');
    } else throw Error('pilot-state');
    return value;
  }
  startPilot() {
    const existing = this.pilot();
    if (existing?.state === 'finished') throw Error('pilot-finished');
    if (existing) return;
    this.preparePlaybooks();
    this.transaction(() => {
      if (this.schemaVersion < 4)
        this.db.exec(
          'CREATE TABLE pilot_metrics (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL); PRAGMA user_version = 4;',
        );
      const floor = Number(
        this.db
          .prepare(
            'SELECT COALESCE(MAX(number), 0) AS n FROM cases WHERE workspace_id = ?',
          )
          .get(PERSONAL)!.n,
      );
      this.db
        .prepare('INSERT INTO pilot_metrics (id, value) VALUES (1, ?)')
        .run(
          JSON.stringify({
            definitionVersion: 1,
            state: 'collecting',
            caseNumberFloor: floor,
            created: 0,
            updated: 0,
          }),
        );
    });
    this.schemaVersion = Math.max(this.schemaVersion, 4);
  }
  savePilot(state: PilotState) {
    this.db
      .prepare('UPDATE pilot_metrics SET value = ? WHERE id = 1')
      .run(JSON.stringify(state));
  }
  deletePilot() {
    if (!this.ready) throw Error('case-masking-required');
    if (this.schemaVersion >= 4) this.db.exec('DELETE FROM pilot_metrics');
  }
  pilotSource(floor: number) {
    const cohort =
      "workspace_id = 'personal' AND owner_id = 'local' AND number > ?";
    const cases = this.db
      .prepare(`SELECT COUNT(*) AS created,
      COALESCE(SUM((SELECT COUNT(DISTINCT chat_id) FROM chat_links WHERE case_id = c.id) >= 2), 0) AS reused,
      COALESCE(SUM(EXISTS(SELECT 1 FROM resolutions WHERE case_id = c.id AND json_extract(value, '$.committed') = 1)), 0) AS resolved,
      COALESCE(SUM(status = 'done' AND EXISTS(SELECT 1 FROM resolutions WHERE case_id = c.id AND json_extract(value, '$.committed') = 1)), 0) AS done
      FROM cases c WHERE ${cohort}`)
      .get(floor) as {
      created: number;
      reused: number;
      resolved: number;
      done: number;
    };
    const changes = this.db
      .prepare(
        `SELECT at, undone_at FROM changes WHERE by = 'local' AND on_behalf_of = 'local' AND applied_version IS NOT NULL AND case_id IN (SELECT id FROM cases WHERE ${cohort})`,
      )
      .all(floor) as { at: string; undone_at: string | null }[];
    return { cases, changes };
  }
  countPilotPublication(caseId: string | undefined, updated: boolean) {
    const state = this.pilot();
    if (state?.state !== 'collecting' || !caseId) return;
    const source = this.db
      .prepare(
        "SELECT id FROM cases WHERE id = ? AND workspace_id = 'personal' AND owner_id = 'local' AND number > ? AND EXISTS(SELECT 1 FROM resolutions WHERE case_id = cases.id AND json_extract(value, '$.committed') = 1)",
      )
      .get(caseId, state.caseNumberFloor);
    if (!source) return;
    const key = updated ? 'updated' : 'created';
    if (!Number.isSafeInteger(state[key] + 1)) throw Error('pilot-state');
    state[key]++;
    this.savePilot(state);
  }

  cases(): CaseRecord[] {
    if (!this.ready) return [];
    const all = <T>(sql: string, ...args: string[]) =>
      this.db.prepare(sql).all(...args) as T[];
    const grouped = (sql: string) => {
      const groups = new Map<string, Row[]>();
      for (const row of all<Row>(sql)) {
        const id = String(row.case_id);
        const rows = groups.get(id) ?? [];
        rows.push(row);
        groups.set(id, rows);
      }
      return groups;
    };
    const links = grouped(
      'SELECT * FROM chat_links WHERE case_id IN (SELECT id FROM cases WHERE deleted_at IS NULL) ORDER BY attached_at',
    );
    const entries = grouped(
      'SELECT * FROM entries WHERE deleted_at IS NULL AND case_id IN (SELECT id FROM cases WHERE deleted_at IS NULL) ORDER BY position',
    );
    const changes = grouped(
      'SELECT * FROM changes WHERE case_id IN (SELECT id FROM cases WHERE deleted_at IS NULL) ORDER BY at DESC, rowid DESC',
    );
    const resolutions =
      this.schemaVersion >= 3
        ? grouped(
            'SELECT * FROM resolutions WHERE case_id IN (SELECT id FROM cases WHERE deleted_at IS NULL) ORDER BY rowid DESC',
          )
        : new Map<string, Row[]>();
    return all<Row>(
      'SELECT * FROM cases WHERE deleted_at IS NULL ORDER BY updated_at DESC',
    ).map((c) => {
      const id = String(c.id);
      return {
        id,
        playbookId: (resolutions.get(id) ?? [])
          .map((r) => JSON.parse(String(r.value)) as ResolutionDraft)
          .find((r) => r.committed)?.playbookId,
        workspaceId: String(c.workspace_id),
        number: Number(c.number),
        title: String(c.title),
        status: c.status as CaseRecord['status'],
        ownerId: String(c.owner_id),
        contributorIds: JSON.parse(String(c.contributor_ids ?? '[]')),
        ticket: String(c.ticket),
        issue: opt(c.issue),
        customer: {
          name: String(c.customer_name),
          reference: opt(c.customer_ref),
          confirmed: !!c.customer_confirmed,
        },
        chatIds: (links.get(id) ?? []).map((l) => String(l.chat_id)),
        createdAt: String(c.created_at),
        updatedAt: String(c.updated_at),
        entries: (entries.get(id) ?? []).map(entry),
        changes: (changes.get(id) ?? []).map(
          (r): CaseChange => ({
            id: String(r.id),
            entryId: String(r.entry_id),
            before: json(r.before),
            after: json(r.after),
            by: String(r.by),
            onBehalfOf: opt(r.on_behalf_of),
            at: String(r.at),
            undoneAt: opt(r.undone_at),
            version:
              r.applied_version == null ? undefined : Number(r.applied_version),
          }),
        ),
      };
    });
  }

  caseForChat(chatId: string): string | undefined {
    const row = this.db
      .prepare(
        'SELECT l.case_id FROM chat_links l JOIN cases c ON c.id = l.case_id WHERE l.chat_id = ? AND c.deleted_at IS NULL',
      )
      .get(chatId) as { case_id: string } | undefined;
    return row?.case_id;
  }

  // Inserts a case with the next number in its workspace and links the chat.
  insertCase(c: {
    id: string;
    workspaceId: string;
    title: string;
    ownerId: string;
    ticket: string;
    chatId: string;
    at: string;
  }): number {
    if (!this.ready) throw Error('case-masking-required');
    return this.transaction(() => {
      const { next } = this.db
        .prepare(
          'SELECT COALESCE(MAX(number), 0) + 1 AS next FROM cases WHERE workspace_id = ?',
        )
        .get(c.workspaceId) as { next: number };
      this.db
        .prepare(
          `INSERT INTO cases (id, workspace_id, number, title, status, owner_id,
            ticket, customer_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'inv', ?, ?, '', ?, ?)`,
        )
        .run(
          c.id,
          c.workspaceId,
          next,
          c.title,
          c.ownerId,
          c.ticket,
          c.at,
          c.at,
        );
      this.db
        .prepare(
          'INSERT INTO chat_links (chat_id, case_id, attached_at) VALUES (?, ?, ?)',
        )
        .run(c.chatId, c.id, c.at);
      return next;
    });
  }

  owner(id: string): { owner_id: string; workspace_id: string } | undefined {
    return this.db
      .prepare(
        'SELECT owner_id, workspace_id FROM cases WHERE id = ? AND deleted_at IS NULL',
      )
      .get(id) as { owner_id: string; workspace_id: string } | undefined;
  }

  addContributor(id: string, recipient: string, at: string) {
    this.transaction(() => {
      const row = this.db
        .prepare(
          'SELECT contributor_ids FROM cases WHERE id = ? AND deleted_at IS NULL',
        )
        .get(id);
      if (!row) throw Error('unknown-case');
      const ids: string[] = JSON.parse(String(row.contributor_ids));
      if (!ids.includes(recipient)) {
        ids.push(recipient);
        this.db
          .prepare(
            'UPDATE cases SET contributor_ids = ?, updated_at = ? WHERE id = ?',
          )
          .run(JSON.stringify(ids), at, id);
      }
    });
  }

  renameCase(id: string, expectedTitle: string, title: string, at: string) {
    if (!this.ready) throw Error('case-masking-required');
    const result = this.db
      .prepare(
        'UPDATE cases SET title = ?, updated_at = ? WHERE id = ? AND title = ? AND deleted_at IS NULL',
      )
      .run(title, at, id, expectedTitle);
    if (result.changes !== 1) throw Error('case-changed');
  }

  entry(caseId: string, id: string): CaseEntry | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM entries WHERE id = ? AND case_id = ? AND deleted_at IS NULL',
      )
      .get(id, caseId) as Row | undefined;
    return row && entry(row);
  }

  removeCase(id: string, at: string) {
    if (!this.ready) throw Error('case-masking-required');
    const result = this.db
      .prepare(
        'UPDATE cases SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL',
      )
      .run(at, id);
    if (result.changes !== 1) throw Error('unknown-case');
  }

  nextPosition(caseId: string, section: string): number {
    const { next } = this.db
      .prepare(
        'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM entries WHERE case_id = ? AND section = ?',
      )
      .get(caseId, section) as { next: number };
    return next;
  }

  change(
    caseId: string,
    id: string,
  ): (CaseChange & { systemOwned: boolean }) | undefined {
    const r = this.db
      .prepare('SELECT * FROM changes WHERE id = ? AND case_id = ?')
      .get(id, caseId) as Row | undefined;
    return (
      r && {
        id: String(r.id),
        entryId: String(r.entry_id),
        before: json(r.before),
        after: json(r.after),
        undoneAt: opt(r.undone_at),
        by: String(r.by),
        onBehalfOf: opt(r.on_behalf_of),
        at: String(r.at),
        version:
          r.applied_version == null ? undefined : Number(r.applied_version),
        systemOwned: !!this.db
          .prepare(
            'SELECT system_owned FROM entries WHERE id = ? AND case_id = ?',
          )
          .get(String(r.entry_id), caseId)?.system_owned,
      }
    );
  }

  // Writes the entry's new value (undefined = removed), one change record and
  // the case's updated time, all or nothing.
  writeEntry(w: {
    caseId: string;
    entryId: string;
    value?: EntryValue;
    position: number;
    version: number;
    by: string;
    onBehalfOf?: string;
    at: string;
    change?: { id: string; before?: EntryValue };
    undo?: string;
    expectedVersion: number;
  }) {
    if (!this.ready) throw Error('case-masking-required');
    this.transaction(() => {
      const existing = this.db
        .prepare('SELECT case_id FROM entries WHERE id = ?')
        .get(w.entryId);
      if (existing && existing.case_id !== w.caseId)
        throw Error('case-changed');
      if (this.version(w.caseId, w.entryId) !== w.expectedVersion)
        throw Error('case-changed');
      const v = w.value;
      if (v)
        this.db
          .prepare(
            `INSERT INTO entries (id, case_id, section, kind, label, text, detail,
              pill, position, version, author_id, on_behalf_of, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET section = excluded.section,
              kind = excluded.kind, label = excluded.label, text = excluded.text,
              detail = excluded.detail, pill = excluded.pill,
              version = excluded.version, author_id = excluded.author_id,
              on_behalf_of = excluded.on_behalf_of,
              updated_at = excluded.updated_at, deleted_at = NULL`,
          )
          .run(
            w.entryId,
            w.caseId,
            v.section,
            v.kind,
            v.label ?? null,
            v.text,
            v.detail ?? null,
            v.pill ?? null,
            w.position,
            w.version,
            w.by,
            w.onBehalfOf ?? null,
            w.at,
          );
      else
        this.db
          .prepare(
            'UPDATE entries SET deleted_at = ?, version = ? WHERE id = ? AND case_id = ?',
          )
          .run(w.at, w.version, w.entryId, w.caseId);
      if (w.change)
        this.db
          .prepare(
            `INSERT INTO changes (id, case_id, entry_id, before, after, by,
              on_behalf_of, at, applied_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            w.change.id,
            w.caseId,
            w.entryId,
            w.change.before ? JSON.stringify(w.change.before) : null,
            v ? JSON.stringify(v) : null,
            w.by,
            w.onBehalfOf ?? null,
            w.at,
            w.version,
          );
      if (w.undo)
        this.db
          .prepare('UPDATE changes SET undone_at = ? WHERE id = ?')
          .run(w.at, w.undo);
      this.db
        .prepare('UPDATE cases SET updated_at = ? WHERE id = ?')
        .run(w.at, w.caseId);
    });
  }

  // Version of an entry, including removed ones, so versions never repeat.
  version(caseId: string, id: string): number {
    const row = this.db
      .prepare('SELECT version FROM entries WHERE id = ? AND case_id = ?')
      .get(id, caseId) as { version: number } | undefined;
    return row?.version ?? 0;
  }

  position(caseId: string, id: string): number | undefined {
    const row = this.db
      .prepare('SELECT position FROM entries WHERE id = ? AND case_id = ?')
      .get(id, caseId) as { position: number } | undefined;
    return row?.position;
  }
}
