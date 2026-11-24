import type { DatabaseSync } from 'node:sqlite';
import type { CaseRecord } from '../../../contracts/cases';
import type {
  DocumentMatch,
  DocumentSearch,
  PlaybookRecord,
} from '../../../contracts/playbooks';
import { rankDocuments, searchTerms, words } from './search.ts';

export const LOOKUP_KINDS = [
  'case_number',
  'ticket_reference',
  'playbook_title',
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];
type Kind = 'case' | 'playbook';
export type SavedWorkReference = { id: string; title: string; number?: number };
type Metadata = {
  kind: Kind;
  id: string;
  title: string;
  updatedAt: string;
  searchable: boolean;
  number?: number;
  ticket?: string;
  issue?: string;
  customer?: CaseRecord['customer'];
  draftTitle?: string;
  version?: number;
  managementUpdatedAt?: string;
  order?: number;
};
export type SearchDocument = Metadata & { description: string; body: string };
type TextRow = { id: string; title: string; updatedAt: string; source: string };
export function lookupCaseNumber(text: string) {
  const number = Number(normalizeLookup(text).match(/^#?(\d+)$/)?.[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
export const normalizeLookup = (text: string) =>
  text.normalize('NFKC').toLowerCase().trim();

export function ticketKey(text: string) {
  const value = normalizeLookup(text);
  const zendesk =
    value.match(/^(?:zendesk(?:\s+ticket)?\s+|zd\s*)#?(\d+)$/) ??
    value.match(
      /^https:\/\/[a-z0-9-]+\.zendesk\.com\/(?:agent\/)?tickets\/(\d+)\/?$/,
    );
  if (zendesk) return `zendesk:${zendesk[1].replace(/^0+(?=\d)/, '')}`;
  const linear =
    value.match(
      /^(?:linear(?:\s+(?:issue|ticket))?\s+)?([a-z][a-z0-9]*-\d+)$/,
    ) ??
    value.match(
      /^https:\/\/linear\.app\/[a-z0-9-]+\/issue\/([a-z][a-z0-9]*-\d+)(?:\/[^/?#]+)?\/?$/,
    );
  if (linear) return `linear:${linear[1]}`;
}

function shortDescription(text: string, limit = 280) {
  const end = text.slice(0, limit);
  if (text.length <= limit || /\s/.test(text[limit])) return end.trim();
  return end.replace(/\s+\S*$/, '').trim();
}

export function caseSearchDocument(record: CaseRecord): SearchDocument {
  const { id, number, title, ticket, issue, customer, status, updatedAt } =
    record;
  const searchable = status === 'done';
  const entries = searchable ? record.entries : [];
  const sections = ['summary', 'problem']
    .map((section) =>
      entries
        .filter((entry) => entry.section === section)
        .map((entry) => entry.text.trim())
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean);
  const description =
    sections.length === 2
      ? sections
          .map((text, i) =>
            shortDescription(text, 279 - Math.min(140, sections[1 - i].length)),
          )
          .join('\n')
      : shortDescription(sections[0] ?? '');
  return {
    kind: 'case',
    id,
    number,
    title,
    ticket,
    issue,
    customer,
    updatedAt,
    searchable,
    description,
    body: entries
      .map((entry) =>
        [entry.label, entry.text, entry.detail].filter(Boolean).join(' '),
      )
      .join('\n'),
  };
}

function introduction(markdown: string) {
  let fenced = false;
  let paragraph: string[] = [];
  for (const line of markdown.split('\n')) {
    const text = line.trim();
    if (/^(?:```|~~~)/.test(text)) fenced = !fenced;
    if (fenced || !text || /^(?:[#>|<]|~~~|```|[-+*]\s|\d+[.)]\s)/.test(text)) {
      if (paragraph.length) break;
      continue;
    }
    if (/\p{L}/u.test(text)) paragraph.push(text);
  }
  return shortDescription(paragraph.join('\n'));
}

export function playbookSearchDocument(
  record: PlaybookRecord,
  order?: number,
): SearchDocument {
  const { id, draft, published, version, updatedAt, publishedAt } = record;
  const body = published?.markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '') ?? '';
  return {
    kind: 'playbook',
    id,
    title: published?.title ?? '',
    draftTitle: draft?.title,
    version,
    order,
    managementUpdatedAt: updatedAt,
    updatedAt: publishedAt ?? updatedAt,
    searchable: !!published,
    description: introduction(body),
    body,
  };
}

// Coordinates derived writes with the canonical transaction when there is one.
export function searchTransaction<T>(db: DatabaseSync, run: () => T): T {
  if (db.isTransaction) return run();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export class SearchIndex {
  private readonly db: DatabaseSync;
  readonly fts: boolean;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.fts = this.initialize();
  }

  private initialize() {
    const db = this.db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS saved_work_metadata (
        kind TEXT NOT NULL, id TEXT NOT NULL, number INTEGER, title_key TEXT,
        updated_at TEXT NOT NULL, position INTEGER, value TEXT NOT NULL, PRIMARY KEY (kind, id)
      );
      CREATE TABLE IF NOT EXISTS saved_work_tickets (
        key TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (key, id)
      );
      CREATE INDEX IF NOT EXISTS saved_work_ticket_id ON saved_work_tickets(id);
      CREATE INDEX IF NOT EXISTS saved_work_number ON saved_work_metadata(kind, number);
      CREATE INDEX IF NOT EXISTS saved_work_title ON saved_work_metadata(kind, title_key);
    `);
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS saved_work_fts USING fts5(
          title, description, body, source UNINDEXED, tokenize = 'unicode61 remove_diacritics 0'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS saved_work_vocab USING fts5vocab(saved_work_fts, 'row');
      `);
      // IF NOT EXISTS does not probe an existing virtual table's module.
      db.prepare('SELECT rowid FROM saved_work_fts LIMIT 0').all();
      return true;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/no such module: fts5/.test(error.message)
      )
        throw error;
      db.exec(
        'CREATE TABLE IF NOT EXISTS saved_work_fallback (source TEXT NOT NULL)',
      );
      return false;
    }
  }

  upsert(document: SearchDocument) {
    const {
      kind,
      id,
      number,
      title,
      updatedAt,
      order,
      searchable,
      body,
      description,
    } = document;
    const { body: _body, description: _description, ...metadata } = document;
    searchTransaction(this.db, () => {
      this.remove(kind, id);
      const rowid = this.db
        .prepare(`
        INSERT INTO saved_work_metadata(kind,id,number,title_key,updated_at,position,value)
        VALUES (?,?,?,?,?,?,?)
      `)
        .run(
          kind,
          id,
          number || null,
          searchable && kind === 'playbook' ? normalizeLookup(title) : null,
          updatedAt,
          order ?? null,
          JSON.stringify(metadata),
        ).lastInsertRowid;
      if (searchable) {
        if (this.fts)
          this.db
            .prepare(
              'INSERT INTO saved_work_fts(rowid,title,description,body,source) VALUES (?,?,?,?,?)',
            )
            .run(
              rowid,
              words(title).join(' '),
              words(description).join(' '),
              words(body).join(' '),
              body,
            );
        else
          this.db
            .prepare(
              'INSERT INTO saved_work_fallback(rowid,source) VALUES (?,?)',
            )
            .run(rowid, body);
      }
      for (const key of new Set([
        ticketKey(document.ticket ?? ''),
        ticketKey(document.issue ?? ''),
      ])) {
        if (kind === 'case' && key)
          this.db
            .prepare('INSERT INTO saved_work_tickets VALUES (?,?)')
            .run(key, id);
      }
    });
  }

  clear() {
    this.db.exec(
      `DELETE FROM ${this.textTable}; DELETE FROM saved_work_tickets; DELETE FROM saved_work_metadata;`,
    );
  }

  remove(kind: Kind, id: string) {
    searchTransaction(this.db, () => {
      this.db
        .prepare(
          `DELETE FROM ${this.textTable} WHERE rowid = (SELECT rowid FROM saved_work_metadata WHERE kind=? AND id=?)`,
        )
        .run(kind, id);
      this.db
        .prepare('DELETE FROM saved_work_metadata WHERE kind=? AND id=?')
        .run(kind, id);
      if (kind === 'case')
        this.db.prepare('DELETE FROM saved_work_tickets WHERE id=?').run(id);
    });
  }

  private get textTable() {
    return this.fts ? 'saved_work_fts' : 'saved_work_fallback';
  }

  metadata(kind: 'case'): (Metadata & {
    number: number;
    ticket: string;
    customer: CaseRecord['customer'];
  })[];
  metadata(kind: 'playbook'): Metadata[];
  metadata(kind: Kind): Metadata[] {
    return this.db
      .prepare(`
      SELECT value FROM saved_work_metadata WHERE kind=? ORDER BY
      position DESC, updated_at DESC, id
    `)
      .all(kind)
      .map((row) => JSON.parse(String(row.value)));
  }

  lookup(kind: LookupKind, query: string): SavedWorkReference[] {
    const value = normalizeLookup(query);
    let rows;
    const order = 'ORDER BY m.updated_at DESC, m.id LIMIT 11';
    switch (kind) {
      case 'case_number': {
        const number = lookupCaseNumber(value);
        if (number === undefined) return [];
        rows = this.db
          .prepare(
            `SELECT m.value FROM saved_work_metadata m WHERE m.kind='case' AND m.number=? ${order}`,
          )
          .all(number);
        break;
      }
      case 'ticket_reference': {
        const key = ticketKey(value);
        if (!key) return [];
        rows = this.db
          .prepare(
            `SELECT m.value FROM saved_work_tickets t JOIN saved_work_metadata m ON m.kind='case' AND m.id=t.id WHERE t.key=? ${order}`,
          )
          .all(key);
        break;
      }
      case 'playbook_title':
        rows = this.db
          .prepare(
            `SELECT m.value FROM saved_work_metadata m WHERE m.kind='playbook' AND m.title_key=? ${order}`,
          )
          .all(value);
    }
    return rows.map((row) => {
      const { id, title, number } = JSON.parse(String(row.value)) as Metadata;
      return { id, title, ...(number ? { number } : {}) };
    });
  }

  search(
    query: string,
    { excludeCaseId }: { excludeCaseId?: string } = {},
  ): DocumentSearch {
    const terms = searchTerms(query);
    if (!terms.length) return { cases: [], playbooks: [] };
    const match = terms.map((term) => `"${term}"`).join(' OR ');
    const frequency = this.fts
      ? this.db.prepare('SELECT doc FROM saved_work_vocab WHERE term=?')
      : undefined;
    const rare = this.fts
      ? terms
          .map((term) => ({
            term,
            count: Number(frequency!.get(term)?.doc ?? Infinity),
          }))
          .sort((a, b) => a.count - b.count)
          .map(({ term }) => term)
      : terms;
    const find = (kind: Kind): DocumentMatch[] => {
      const sql = `
        SELECT m.id, json_extract(m.value,'$.title') AS title, m.number,
          m.updated_at AS updatedAt, f.source
        FROM ${this.textTable} f JOIN saved_work_metadata m ON m.rowid=f.rowid
        WHERE m.kind=? AND m.id<>?
      `;
      const excluded = kind === 'case' ? (excludeCaseId ?? '') : '';
      const rows = (
        this.fts
          ? this.db
              .prepare(
                `${sql} AND saved_work_fts MATCH ? ORDER BY bm25(saved_work_fts,4,2,1), m.updated_at DESC, m.id LIMIT 5`,
              )
              .all(kind, excluded, match)
          : this.db.prepare(sql).all(kind, excluded)
      ) as (TextRow & { number: number | null })[];
      const documents = rows.map(
        ({ id, title, number, updatedAt, source }) => ({
          id,
          title: number ? `#${number} · ${title}` : title,
          updatedAt,
          excerpt: source,
        }),
      );
      if (!this.fts) return rankDocuments(query, documents);
      return documents.map(({ excerpt, ...doc }) => {
        const offsets = new Map<string, number>();
        for (const word of excerpt.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
          for (const token of words(word[0]))
            if (!offsets.has(token)) offsets.set(token, word.index);
        }
        const title = new Set(words(doc.title));
        const start = Math.max(
          0,
          (offsets.get(rare.find((term) => offsets.has(term)) ?? '') ?? 0) - 80,
        );
        return {
          ...doc,
          excerpt: excerpt.slice(start, start + 240),
          matchedTerms: terms.filter(
            (term) => title.has(term) || offsets.has(term),
          ),
        };
      });
    };
    return { cases: find('case'), playbooks: find('playbook') };
  }
}
