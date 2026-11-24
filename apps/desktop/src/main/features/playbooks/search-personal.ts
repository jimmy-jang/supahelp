import type { DatabaseSync } from 'node:sqlite';
import type { CaseStore } from '../cases/store';
import {
  caseSearchDocument,
  playbookSearchDocument,
  SearchIndex,
  searchTransaction,
} from './search-index.ts';

const batchSize = 64;
const version = 1;
type Kind = 'case' | 'playbook';
type Dirty = { kind: Kind; id: string };

export class PersonalSearchIndex {
  private readonly db: DatabaseSync;
  private readonly store: CaseStore;
  private readonly index: SearchIndex;
  private timer?: NodeJS.Immediate;

  constructor(db: DatabaseSync, store: CaseStore) {
    this.db = db;
    this.store = store;
    this.index = new SearchIndex(db);
    searchTransaction(db, () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS saved_work_state (
          id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, fts INTEGER NOT NULL,
          phase TEXT NOT NULL, cursor TEXT
        );
        CREATE TABLE IF NOT EXISTS saved_work_dirty (
          kind TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(kind, id)
        );
      `);
      for (const [table, kind, column] of [
        ['cases', 'case', 'id'],
        ['entries', 'case', 'case_id'],
        ['playbooks', 'playbook', 'id'],
      ]) {
        for (const [event, refs] of [
          ['insert', ['NEW']],
          ['update', ['NEW', 'OLD']],
          ['delete', ['OLD']],
        ] as const) {
          // Dirty rows are part of the canonical commit, including implicit transactions.
          db.exec(`
            CREATE TRIGGER IF NOT EXISTS saved_work_${table}_${event} AFTER ${event} ON ${table}
            BEGIN
              ${refs.map((ref) => `INSERT INTO saved_work_dirty VALUES ('${kind}', ${ref}.${column}) ON CONFLICT DO NOTHING;`).join('\n')}
            END;
          `);
        }
      }
      const state = db
        .prepare('SELECT version,fts FROM saved_work_state WHERE id=1')
        .get();
      if (state?.version !== version || state.fts !== Number(this.index.fts)) {
        this.index.clear();
        db.exec('DELETE FROM saved_work_dirty');
        db.prepare(`
          INSERT OR REPLACE INTO saved_work_state VALUES(1,?,?,'case',NULL)
        `).run(version, Number(this.index.fts));
      }
    });
  }

  private update({ kind, id }: Dirty) {
    if (kind === 'case') {
      const owner = this.store.owner(id);
      if (owner?.workspace_id === 'personal' && owner.owner_id === 'local') {
        const record = this.store.case(id, true);
        if (record) {
          this.index.upsert(caseSearchDocument(record));
          return;
        }
      }
    } else {
      const record = this.store.books.playbook(id);
      if (record?.workspaceId === 'personal' && record.ownerId === 'local') {
        const order = this.db
          .prepare('SELECT rowid FROM playbooks WHERE id=?')
          .get(id);
        this.index.upsert(playbookSearchDocument(record, Number(order?.rowid)));
        return;
      }
    }
    this.index.remove(kind, id);
  }

  private batch() {
    if (this.db.isTransaction) throw Error('search-preparing');
    return searchTransaction(this.db, () => {
      const state = this.db
        .prepare('SELECT phase,cursor FROM saved_work_state WHERE id=1')
        .get()!;
      if (state.phase !== 'ready') {
        const phase = state.phase === 'case' ? 'case' : 'playbook';
        const table = phase === 'case' ? 'cases' : 'playbooks';
        const select = `SELECT id FROM ${table}`;
        const rows =
          state.cursor === null
            ? this.db.prepare(`${select} ORDER BY id LIMIT ?`).all(batchSize)
            : this.db
                .prepare(`${select} WHERE id>? ORDER BY id LIMIT ?`)
                .all(state.cursor, batchSize);
        for (const row of rows)
          this.update({ kind: phase, id: String(row.id) });
        this.db
          .prepare('UPDATE saved_work_state SET phase=?,cursor=? WHERE id=1')
          .run(
            rows.length === batchSize
              ? phase
              : phase === 'case'
                ? 'playbook'
                : 'ready',
            rows.length === batchSize ? rows.at(-1)!.id : null,
          );
        return (
          rows.length < batchSize && phase === 'playbook' && !this.hasDirty()
        );
      }
      const dirty = this.db
        .prepare('SELECT kind,id FROM saved_work_dirty LIMIT ?')
        .all(batchSize) as Dirty[];
      const clear = this.db.prepare(
        'DELETE FROM saved_work_dirty WHERE kind=? AND id=?',
      );
      for (const record of dirty) {
        this.update(record);
        clear.run(record.kind, record.id);
      }
      return dirty.length < batchSize || !this.hasDirty();
    });
  }

  private hasDirty() {
    return !!this.db.prepare('SELECT 1 FROM saved_work_dirty LIMIT 1').get();
  }

  private continueBuild() {
    this.timer ??= setImmediate(() => {
      this.timer = undefined;
      try {
        if (!this.batch()) this.continueBuild();
      } catch {
        // The transaction rolls back. A later search retries the same batch.
      }
    });
  }

  current() {
    if (this.db.isTransaction) throw Error('search-preparing');
    const phase = this.db
      .prepare('SELECT phase FROM saved_work_state WHERE id=1')
      .get()?.phase;
    if (phase === 'ready' && !this.hasDirty()) return this.index;
    if (this.timer) throw Error('search-preparing');
    try {
      if (this.batch()) return this.index;
      // A small library can open on its first search without a loading round trip.
      if (
        phase === 'case' &&
        this.db.prepare('SELECT phase FROM saved_work_state WHERE id=1').get()
          ?.phase === 'playbook' &&
        this.batch()
      )
        return this.index;
      this.continueBuild();
    } catch (error) {
      throw new Error('search-unavailable', { cause: error });
    }
    throw Error('search-preparing');
  }

  close() {
    if (this.timer) clearImmediate(this.timer);
    this.timer = undefined;
  }
}
