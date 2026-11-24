import type { DatabaseSync } from 'node:sqlite';
import type {
  PlaybookRecord,
  ResolutionDraft,
} from '../../../contracts/playbooks';

export class PlaybookStore {
  private database: () => DatabaseSync;
  private get db() {
    return this.database();
  }
  private preparePlaybooks: () => void;
  readonly transaction: <T>(run: () => T) => T;
  readonly countPublication: (
    caseId: string | undefined,
    updated: boolean,
  ) => void;
  constructor(
    database: () => DatabaseSync,
    preparePlaybooks: () => void,
    transaction: <T>(run: () => T) => T,
    countPublication: (caseId: string | undefined, updated: boolean) => void,
  ) {
    this.database = database;
    this.preparePlaybooks = preparePlaybooks;
    this.transaction = transaction;
    this.countPublication = countPublication;
  }
  playbooks(): PlaybookRecord[] {
    this.preparePlaybooks();
    return this.db
      .prepare('SELECT value FROM playbooks ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(String(r.value)));
  }
  playbook(id: string): PlaybookRecord | undefined {
    this.preparePlaybooks();
    const row = this.db
      .prepare('SELECT value FROM playbooks WHERE id=?')
      .get(id);
    return row ? JSON.parse(String(row.value)) : undefined;
  }
  savePlaybook(value: PlaybookRecord, expected: number) {
    this.preparePlaybooks();
    this.transaction(() => {
      const current = this.db
        .prepare('SELECT version FROM playbooks WHERE id = ?')
        .get(value.id);
      if (Number(current?.version ?? 0) !== expected)
        throw Error('case-changed');
      this.db
        .prepare(
          'INSERT INTO playbooks (id, version, value) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, value = excluded.value',
        )
        .run(value.id, value.version, JSON.stringify(value));
    });
  }
  removeUnpublishedPlaybook(id: string, version: number) {
    const result = this.db
      .prepare(
        "DELETE FROM playbooks WHERE id = ? AND version = ? AND json_extract(value,'$.published') IS NULL",
      )
      .run(id, version);
    if (result.changes !== 1) throw Error('case-changed');
  }
  resolutions(): ResolutionDraft[] {
    this.preparePlaybooks();
    return this.db
      .prepare('SELECT value FROM resolutions ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(String(r.value)));
  }

  removePlaybook(id: string, version: number) {
    const result = this.db
      .prepare('DELETE FROM playbooks WHERE id = ? AND version = ?')
      .run(id, version);
    if (result.changes !== 1) throw Error('case-changed');
  }
  saveResolution(value: ResolutionDraft) {
    this.preparePlaybooks();
    this.db
      .prepare(
        'INSERT INTO resolutions (id, case_id, value) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
      )
      .run(value.id, value.caseId, JSON.stringify(value));
  }
}
