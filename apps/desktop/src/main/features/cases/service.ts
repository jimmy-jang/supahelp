import { normalizeLookup } from '../playbooks/search-index.ts';
import { randomUUID } from 'node:crypto';
import type { ContextStamp } from '../../../contracts/accounts';
import type {
  CaseRecord,
  CaseSnapshot,
  CaseStatus,
  CaseUpdate,
  Customer,
  CustomerDirectory,
  EntryValue,
  SectionKey,
} from '../../../contracts/cases';
import type { ModelSelection } from '../../../contracts/chat';
import { checkedTitle } from '../../../contracts/titles.ts';
import type { Encryption } from '../../platform/auth-store';
import { maskCasePatterns, type CaseMaskingField } from './masking.ts';
import { liveStatus, MANUAL_STATUSES, type LiveInputs } from './status.ts';
import { PERSONAL, type CaseRows, type CaseStore } from './store.ts';

// Personal records belong to this computer; signing in never relabels their owner.
export const LOCAL_PERSON = 'local';
export const CHANGED_SINCE = 'Changed since. Edit it instead.';
const KIND: Record<SectionKey, EntryValue['kind']> = {
  summary: 'text',
  customer: 'row',
  problem: 'row',
  reproduction: 'row',
  findings: 'item',
  actions: 'item',
  questions: 'item',
  next: 'text',
  resolution: 'row',
};
const PILLS = {
  findings: ['Confirmed', 'Ruled out', 'Guess'],
  actions: ['Proposed'],
  questions: ['Open', 'Answered'],
};
const VALUE_KEYS = ['section', 'kind', 'label', 'text', 'detail', 'pill'];
export type CaseOperation = {
  // Set only by the trusted human-edit IPC, never by model tool arguments.
  humanEditRequestId?: string;
  context: ContextStamp;
  selection?: ModelSelection;
  signal: AbortSignal;
  guard?: () => void;
  committed?: (update: CaseUpdate) => void;
};
export type CaseEnvironment = {
  context(): ContextStamp;
  assertContext(context: ContextStamp): void;
  encryption: Encryption;
};

export function checkedCaseEntry(input: unknown): EntryValue {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !VALUE_KEYS.includes(key))
  )
    throw Error('invalid-entry');
  const v = input as Record<string, unknown>,
    section = v.section as SectionKey;
  if (!Object.hasOwn(KIND, section) || v.kind !== KIND[section])
    throw Error('invalid-entry');
  const text = (key: string, max: number, required = false) => {
    const value = v[key];
    if (value === undefined && !required) return undefined;
    if (
      typeof value !== 'string' ||
      value.length > max ||
      (required && !value.trim())
    )
      throw Error('invalid-entry');
    return value;
  };
  const value: EntryValue = {
    section,
    kind: KIND[section],
    label: text('label', 120, KIND[section] === 'row'),
    text: text('text', 4000, true)!,
    detail: text('detail', 2000),
    pill: text('pill', 40, KIND[section] === 'item'),
  };
  if (value.kind !== 'item' && value.pill !== undefined)
    throw Error('invalid-entry');
  if (
    value.kind === 'item' &&
    !PILLS[section as keyof typeof PILLS].includes(value.pill!)
  )
    throw Error('reserved-field');
  return value;
}

// Only stable pilot-provider object links/references count as evidence.
export function caseEvidence(input?: string): string | undefined {
  if (!input) return;
  const value = input.trim();
  if (
    /^(?:Stripe (?:in|ch|pi|cus|sub|re)_[A-Za-z0-9_]+|(?:Zendesk|ZD) #?\d+|Linear [A-Z][A-Z0-9_]*-\d+)$/.test(
      value,
    )
  )
    return value;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port
    )
      return;
    if (
      /^[a-z0-9-]+\.zendesk\.com$/.test(url.hostname) &&
      /^\/agent\/tickets\/\d+$/.test(url.pathname)
    )
      return value;
    if (
      url.hostname === 'dashboard.stripe.com' &&
      /^\/(?:test\/)?(?:payments|invoices|customers|subscriptions|refunds)\/[A-Za-z0-9_]+$/.test(
        url.pathname,
      )
    )
      return value;
    if (
      url.hostname === 'linear.app' &&
      /^\/[a-z0-9-]+\/issue\/[A-Z][A-Z0-9]*-\d+$/.test(url.pathname)
    )
      return value;
  } catch {
    /* Invalid links provide no evidence. */
  }
}
function evidence(value: EntryValue) {
  if (value.section === 'findings') {
    value.detail = caseEvidence(value.detail);
    if (!value.detail && /^(Confirmed|Ruled out)$/.test(value.pill ?? ''))
      value.pill = 'Guess';
  }
  return value;
}
const valueOf = (e: EntryValue): EntryValue => ({
  section: e.section,
  kind: e.kind,
  label: e.label,
  text: e.text,
  detail: e.detail,
  pill: e.pill,
});
const same = (a: EntryValue, b: EntryValue) =>
  JSON.stringify(valueOf(a)) === JSON.stringify(valueOf(b));
export function ticketIn(text: string): string {
  const explicit =
    text.match(/\b(?:zendesk(?:\s+ticket)?|zd)\s+#?(\d+)\b/i) ??
    text.match(/tickets\/(\d+)\b/);
  const legacy =
    explicit ??
    Array.from(text.matchAll(/#(\d{3,})\b/g)).find(
      (match) => !/\bcase\s*$/i.test(text.slice(0, match.index)),
    );
  return legacy ? `ZD #${legacy[1]}` : '';
}

function linearIssueIn(text: string) {
  const issue =
    text.match(/\blinear(?:\s+(?:issue|ticket))?\s+([a-z][a-z0-9]*-\d+)\b/i) ??
    text.match(
      /https:\/\/linear\.app\/[a-z0-9-]+\/issue\/([a-z][a-z0-9]*-\d+)\b/i,
    );
  return issue ? `Linear ${issue[1].toUpperCase()}` : undefined;
}

export class CaseService {
  team?: import('../sync/documents').TeamDocuments;
  /** Team cases are shared; their link to a local chat lives on the chat. */
  teamChats?: {
    get(chatId: string): string | undefined;
    link(chatId: string, caseId: string | undefined): void;
    chats(caseId: string): string[];
  };
  private revision = 0;
  readonly store: CaseStore;
  private changed: (snapshot: CaseSnapshot) => void;
  private environment: CaseEnvironment;
  private now: () => string;
  private preparing?: Promise<void>;
  private lifetime = new AbortController();
  private pending = new AbortController();

  constructor(
    store: CaseStore,
    changed: (snapshot: CaseSnapshot) => void,
    environment: CaseEnvironment,
    now = () => new Date().toISOString(),
  ) {
    this.store = store;
    this.changed = changed;
    this.environment = environment;
    this.now = now;
  }
  context() {
    return this.environment.context();
  }
  operationSignal() {
    return this.pending.signal;
  }
  cancelPending() {
    this.pending.abort();
    this.pending = new AbortController();
  }
  async activate(file: string) {
    this.cancelPending();
    await this.preparing?.catch(() => {});
    this.preparing = undefined;
    await this.store.activate(file);
  }
  assertContext(context: ContextStamp) {
    this.environment.assertContext(context);
  }
  private guard(op: CaseOperation) {
    this.lifetime.signal.throwIfAborted();
    op.signal.throwIfAborted();
    this.environment.assertContext(op.context);
    if (op.context.context.kind !== 'personal') {
      if (!this.team) throw Error('case-context');
      this.team.guard(op);
      return;
    }
    op.guard?.();
    op.signal.throwIfAborted();
  }
  private authorize(caseId: string, op: CaseOperation) {
    this.guard(op);
    const owner = this.store.owner(caseId);
    if (
      !owner ||
      owner.workspace_id !== PERSONAL ||
      owner.owner_id !== LOCAL_PERSON
    )
      throw Error('unknown-case');
    if (!this.store.ready) throw Error('case-masking-required');
  }
  snapshot(): CaseSnapshot {
    const live = this.liveInputs?.();
    const shown = <T extends CaseRecord>(c: T): T =>
      live ? { ...c, status: liveStatus(c, live) } : c;
    if (this.context().context.kind === 'team')
      return {
        revision: this.revision,
        cases: (this.team?.sync.cases() ?? []).map((c) =>
          shown(this.withChats(c)),
        ),
      };
    return {
      revision: this.revision,
      cases: this.store
        .cases()
        .filter(
          (record) =>
            record.workspaceId === PERSONAL && record.ownerId === LOCAL_PERSON,
        )
        .map(shown),
      maskingRequired: !this.store.ready,
    };
  }
  emit() {
    this.revision++;
    this.changed(this.snapshot());
  }
  /** Chats and connection actions that drive the live statuses. */
  liveInputs?: () => LiveInputs;
  private liveKey = '';
  // Chat and action snapshots publish often (every streamed reply); re-send
  // cases only when something a live status depends on actually changed.
  refresh() {
    const live = this.liveInputs?.();
    if (!live) return;
    const key = JSON.stringify([
      live.actions
        .filter((a) => a.status === 'pending' || a.status === 'unknown')
        .map((a) => [a.chatId, a.source?.caseId, a.status]),
      live.chats.map((c) => [c.id, c.status, !!c.error]),
    ]);
    if (key === this.liveKey) return;
    this.liveKey = key;
    this.emit();
  }
  setStatus(caseId: string, status: unknown, op: CaseOperation) {
    // Team status changes need a shared sync operation; not built yet.
    if (op.context.context.kind === 'team') throw Error('team-status');
    if (!MANUAL_STATUSES.includes(status as CaseStatus))
      throw Error('invalid-entry');
    const before = this.read(caseId, op);
    if (before.status === 'done') throw Error('case-resolved');
    if (before.status === status) return;
    this.store.setStatus(caseId, status as CaseStatus, this.now());
    this.emit();
  }

  async prepare(op: CaseOperation) {
    if (op.context.context.kind === 'team') {
      this.environment.assertContext(op.context);
      await this.team?.sync.prepareRead();
      return;
    }
    this.guard(op);
    if (this.store.ready) return;
    if (this.preparing) {
      await this.preparing;
      this.guard(op);
      return;
    }
    const run = async () => {
      const guard = () => this.guard(op);
      await this.store.recover(this.environment.encryption, guard);
      guard();
      if (!this.store.ready) {
        if (!(await this.environment.encryption.isEncryptionAvailable()))
          throw Error('case-recovery');
        guard();
        const rows = structuredClone(this.store.rows());
        await this.maskRows(rows, op);
        guard();
        await this.store.upgrade(rows, this.environment.encryption, guard);
      }
      guard();
      this.emit();
    };
    this.preparing = run();
    try {
      await this.preparing;
    } finally {
      this.preparing = undefined;
    }
  }

  private async maskRows(rows: CaseRows, op: CaseOperation) {
    // Preserve opaque actor IDs; unknown legacy display names need an explicit identity mapping.
    const actor = (value: unknown) =>
      value == null ||
      value === 'local' ||
      value === 'system' ||
      (typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          value,
        ));
    if (
      rows.cases.some((row) => !actor(row.owner_id)) ||
      rows.entries.some(
        (row) => !actor(row.author_id) || !actor(row.on_behalf_of),
      ) ||
      rows.changes.some((row) => !actor(row.by) || !actor(row.on_behalf_of))
    )
      throw Error('case-recovery');
    const cells: {
      target: Record<string, unknown>;
      key: string;
      text: string;
    }[] = [];
    const collect = (target: Record<string, unknown>, keys: string[]) => {
      for (const key of keys)
        if (typeof target[key] === 'string')
          cells.push({ target, key, text: target[key] as string });
    };
    for (const row of rows.workspaces) collect(row, ['name']);
    for (const row of rows.cases)
      collect(row, [
        'title',
        'ticket',
        'issue',
        'customer_name',
        'customer_ref',
      ]);
    for (const row of rows.entries)
      collect(row, ['label', 'text', 'detail', 'pill']);
    const history: {
      row: CaseRows['changes'][number];
      key: string;
      value: EntryValue;
    }[] = [];
    for (const row of rows.changes)
      for (const key of ['before', 'after']) {
        if (row[key] == null) continue;
        const value = JSON.parse(String(row[key])) as EntryValue;
        if (
          !value ||
          typeof value !== 'object' ||
          Object.keys(value).some((key) => !VALUE_KEYS.includes(key)) ||
          !Object.hasOwn(KIND, value.section) ||
          value.kind !== KIND[value.section] ||
          typeof value.text !== 'string' ||
          ['label', 'detail', 'pill'].some(
            (key) =>
              value[key as keyof EntryValue] != null &&
              typeof value[key as keyof EntryValue] !== 'string',
          )
        )
          throw Error('case-recovery');
        collect(value, ['label', 'text', 'detail', 'pill']);
        history.push({ row, key, value });
      }
    for (let i = 0; i < cells.length; ) {
      const batch: typeof cells = [];
      let length = 0;
      while (
        i < cells.length &&
        batch.length < 32 &&
        length + cells[i].text.length <= 24000
      ) {
        if (cells[i].text.length > 8000) throw Error('case-recovery');
        length += cells[i].text.length;
        batch.push(cells[i++]);
      }
      if (!batch.length) throw Error('case-recovery');
      const masked = await this.mask(
        batch.map((cell, index) => ({ id: `f${index}`, text: cell.text })),
        op,
      );
      masked.forEach((field, index) => {
        batch[index].target[batch[index].key] = field.text;
      });
    }
    for (const row of rows.entries)
      if (row.section === 'findings') {
        row.detail =
          caseEvidence(row.detail == null ? undefined : String(row.detail)) ??
          null;
        if (!row.detail && /^(Confirmed|Ruled out)$/.test(String(row.pill)))
          row.pill = 'Guess';
      }
    for (const item of history)
      item.row[item.key] = JSON.stringify(evidence(item.value));
  }

  // Pattern masking only (emails, phones, cards, secrets, credential links); names and addresses are kept.
  async mask(fields: CaseMaskingField[], op: CaseOperation) {
    this.guard(op);
    return fields.map((field) => ({
      id: field.id,
      text: maskCasePatterns(field.text),
    }));
  }

  async create(
    chat: {
      id: string;
      title: string;
      messages: { role: string; text: string }[];
    },
    op: CaseOperation,
  ): Promise<string> {
    if (op.context.context.kind === 'team') {
      const existing = this.caseForChat(chat.id);
      if (existing) return existing;
      if (!this.teamChats) throw Error('sync-unavailable-operation');
      const [title] = await this.mask(
        [
          {
            id: 'title',
            text: chat.title.trim().slice(0, 120) || 'Untitled case',
          },
        ],
        op,
      );
      const id = this.team!.create(title.text, op);
      this.teamChats.link(chat.id, id);
      await this.team!.sync.sync();
      this.assertContext(op.context);
      return id;
    }
    await this.prepare(op);
    this.guard(op);
    const existing = this.store.caseForChat(chat.id);
    if (existing) {
      this.authorize(existing, op);
      return existing;
    }
    const userText = chat.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.text)
      .join(' ');
    const issueReference = linearIssueIn(userText);
    const [title, ticket, issue] = await this.mask(
      [
        {
          id: 'title',
          text: chat.title.trim().slice(0, 120) || 'Untitled case',
        },
        { id: 'ticket', text: ticketIn(userText) },
        ...(issueReference ? [{ id: 'issue', text: issueReference }] : []),
      ],
      op,
    );
    this.guard(op);
    const linked = this.store.caseForChat(chat.id);
    if (linked) {
      this.authorize(linked, op);
      return linked;
    }
    const id = randomUUID();
    this.store.insertCase({
      id,
      workspaceId: PERSONAL,
      title: title.text,
      ownerId: LOCAL_PERSON,
      ticket: ticket.text,
      issue: issue?.text,
      chatId: chat.id,
      at: this.now(),
    });
    this.emit();
    return id;
  }
  caseForChat(chatId: string) {
    if (this.context().context.kind === 'team') {
      const id = this.teamChats?.get(chatId);
      return id && this.team?.sync.cases().some((c) => c.id === id)
        ? id
        : undefined;
    }
    return this.store.caseForChat(chatId);
  }

  async customers(op: CaseOperation): Promise<CustomerDirectory> {
    this.guard(op);
    if (op.context.context.kind !== 'personal')
      throw Error('customer-personal-only');
    const db = this.store.customerDb();
    if (!db) return { customers: [], links: [] };
    const records = db.prepare('SELECT id, encrypted FROM customers').all();
    const links = db
      .prepare(
        `SELECT l.case_id AS caseId, l.customer_id AS customerId
         FROM case_customers l JOIN cases c ON c.id = l.case_id
         WHERE c.workspace_id = ? AND c.owner_id = ? AND c.deleted_at IS NULL`,
      )
      .all(PERSONAL, LOCAL_PERSON)
      .map((link) => ({
        caseId: String(link.caseId),
        customerId: String(link.customerId),
      }));
    const customers: Customer[] = [];
    for (const row of records) {
      const encrypted = Buffer.from(row.encrypted as Uint8Array);
      const value = JSON.parse(
        await this.environment.encryption.decryptString(encrypted),
      ) as Omit<Customer, 'id'>;
      this.guard(op);
      customers.push({ ...value, id: String(row.id) });
    }
    return { customers, links };
  }

  async searchReferences(
    kind: 'customer' | 'ticket',
    query: string,
    op: CaseOperation,
  ) {
    const search = normalizeLookup(query);
    if (!search || query.length > 120) throw Error('invalid-reference-search');
    this.guard(op);
    const personal = op.context.context.kind === 'personal';
    if (personal) await this.prepare(op);
    const matches = (...fields: (string | undefined)[]) =>
      fields.some((field) => field && normalizeLookup(field).includes(search));
    const directory =
      personal && kind === 'customer'
        ? (await this.customers(op)).customers
        : [];
    this.guard(op);
    const index = personal
      ? this.store.searchIndex()
      : this.team!.sync.searchIndex();
    const cases = index.metadata('case');
    this.guard(op);
    return kind === 'customer'
      ? {
          customers: directory
            .filter(({ name, reference }) => matches(name, reference))
            .slice(0, 10)
            .map(({ name, reference }) => ({ name, reference })),
          cases: cases
            .filter(({ customer }) =>
              matches(customer.name, customer.reference),
            )
            .slice(0, 10)
            .map(({ number, title, customer }) => ({
              number,
              title,
              customer,
            })),
        }
      : {
          cases: cases
            .filter(
              ({ title, ticket, issue }) =>
                (ticket || issue) && matches(title, ticket, issue),
            )
            .slice(0, 10)
            .map(({ number, title, ticket, issue }) => ({
              number,
              title,
              ticket,
              issue,
            })),
        };
  }

  read(caseId: string, op: CaseOperation) {
    if (op.context.context.kind === 'team')
      return this.withChats(this.team!.read(caseId, op));
    this.authorize(caseId, op);
    return this.store.case(caseId)!;
  }

  // Team cases are shared, but which local chats they attach to stays on
  // this computer (on the chat), so callers see one chatIds field in both kinds.
  private withChats<T extends { id: string; chatIds: string[] }>(c: T): T {
    return { ...c, chatIds: this.teamChats?.chats(c.id) ?? [] };
  }

  linkChat(caseId: string, chatId: string, op: CaseOperation) {
    if (this.read(caseId, op).chatIds.includes(chatId)) return;
    if (this.caseForChat(chatId)) throw Error('chat-has-case');
    if (op.context.context.kind === 'team') {
      if (!this.teamChats) throw Error('sync-unavailable-operation');
      this.teamChats.link(chatId, caseId);
    } else this.store.linkChat(caseId, chatId, this.now());
    this.emit();
  }

  unlinkChat(caseId: string, chatId: string, op: CaseOperation) {
    if (!this.read(caseId, op).chatIds.includes(chatId))
      throw Error('invalid-entry');
    if (op.context.context.kind === 'team')
      this.teamChats!.link(chatId, undefined);
    else this.store.unlinkChat(caseId, chatId);
    this.emit();
  }

  async people(op: CaseOperation) {
    this.guard(op);
    if (op.context.context.kind === 'team') {
      const { members } = await this.team!.sync.collaboration();
      this.guard(op);
      return members;
    }
    return [{ id: LOCAL_PERSON, name: 'You', role: 'on this computer' }];
  }

  async assign(
    caseId: string,
    action: unknown,
    recipientId: unknown,
    ownerRevision: unknown,
    op: CaseOperation,
  ) {
    this.guard(op);
    if (
      typeof action !== 'string' ||
      !['bring-in', 'handoff'].includes(action) ||
      typeof recipientId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(recipientId) ||
      !Number.isSafeInteger(ownerRevision) ||
      Number(ownerRevision) < 0
    )
      throw Error('invalid-entry');
    const before = this.read(caseId, op);
    if ((before.ownerRevision ?? 0) !== ownerRevision)
      throw Error('case-changed');
    if (op.context.context.kind === 'team') {
      const lease = this.team!.guard(op, true);
      if (before.ownerId !== lease.accountId)
        throw Error('case-assignment-denied');
      const people = await this.people(op);
      this.guard(op);
      if (!people.some((p) => p.id === recipientId && p.role !== 'viewer'))
        throw Error('case-assignment-denied');
      if (JSON.stringify(before) !== JSON.stringify(this.read(caseId, op)))
        throw Error('case-changed');
      await this.team!.sync.collaborate({
        id: randomUUID(),
        caseId,
        type: action as 'bring-in' | 'handoff',
        recipientId,
        ownerRevision: Number(ownerRevision),
      });
      this.guard(op);
      const saved = this.read(caseId, op);
      if (
        action === 'handoff'
          ? saved.ownerId !== recipientId
          : saved.ownerId !== recipientId &&
            !saved.contributorIds?.includes(recipientId)
      )
        throw Error('case-assignment-unconfirmed');
      return saved;
    }
    this.authorize(caseId, op);
    if (recipientId !== LOCAL_PERSON) throw Error('case-assignment-denied');
    if (action === 'bring-in')
      this.store.addContributor(caseId, recipientId, this.now());
    this.emit();
    return this.read(caseId, op);
  }

  remove(caseId: string, op: CaseOperation) {
    if (op.context.context.kind === 'team')
      return this.team!.remove(caseId, op);
    this.authorize(caseId, op);
    this.store.removeCase(caseId, this.now());
    this.emit();
  }

  async rename(
    caseId: string,
    input: unknown,
    expectedTitle: unknown,
    op: CaseOperation,
  ): Promise<string> {
    if (op.context.context.kind === 'team')
      return this.team!.rename(caseId, input, expectedTitle, op);
    const title = checkedTitle(input);
    const before = this.read(caseId, op);
    if (before.title !== expectedTitle) throw Error('case-changed');
    if (title === before.title) return title;
    const [masked] = await this.mask([{ id: 'title', text: title }], op);
    const clean = checkedTitle(masked.text);
    this.authorize(caseId, op);
    this.store.renameCase(caseId, before.title, clean, this.now());
    this.emit();
    return clean;
  }

  async edit(
    caseId: string,
    entryId: string | undefined,
    input: unknown,
    op: CaseOperation,
    expectedVersion?: number,
  ) {
    if (op.context.context.kind === 'team')
      return this.team!.edit(caseId, entryId, input, op, expectedVersion);
    this.authorize(caseId, op);
    if (
      op.humanEditRequestId &&
      (!/^[0-9a-f-]{36}$/i.test(op.humanEditRequestId) ||
        (entryId &&
          (!Number.isSafeInteger(expectedVersion) || expectedVersion! < 1)))
    )
      throw Error('invalid-entry');
    const before = entryId ? this.store.entry(caseId, entryId) : undefined;
    if (entryId && !before) throw Error('unknown-entry');
    if (
      before?.systemOwned ||
      (before?.section === 'actions' && before.pill !== 'Proposed')
    )
      throw Error('reserved-field');
    const version = entryId ? this.store.version(caseId, entryId) : 0;
    if (expectedVersion !== undefined && version !== expectedVersion)
      throw Error('case-changed');
    let value = input === undefined ? undefined : checkedCaseEntry(input);
    if (before?.section === 'resolution' || value?.section === 'resolution')
      throw Error('reserved-field');
    if (!value && !before) throw Error('invalid-entry');
    if (before && value && value.section !== before.section)
      throw Error('invalid-entry');
    if (value) {
      const fields = ['label', 'text', 'detail'].filter(
        (key) => value![key as keyof EntryValue] !== undefined,
      );
      const masked = await this.mask(
        fields.map((key) => ({
          id: key,
          text: String(value![key as keyof EntryValue]),
        })),
        op,
      );
      const clean = { ...value };
      for (const field of masked)
        (clean as Record<string, unknown>)[field.id] = field.text;
      value = evidence(checkedCaseEntry(clean));
      if (before && same(before, value)) throw Error('case-unchanged');
    }
    this.authorize(caseId, op);
    if (entryId && this.store.entry(caseId, entryId)?.systemOwned)
      throw Error('reserved-field');
    const id = entryId ?? op.humanEditRequestId ?? randomUUID(),
      changeId = randomUUID();
    this.store.writeEntry({
      caseId,
      entryId: id,
      value,
      position:
        before?.position ?? this.store.nextPosition(caseId, value!.section),
      version: version + 1,
      expectedVersion: version,
      by: LOCAL_PERSON,
      onBehalfOf: op.humanEditRequestId ? undefined : LOCAL_PERSON,
      at: this.now(),
      change: { id: changeId, before: before && valueOf(before) },
    });
    const source = value ?? before!;
    const update: CaseUpdate = {
      caseId,
      changeId,
      entryId: id,
      section: source.section,
      text: `${!before ? '+1 · ' : value ? 'Edited · ' : 'Removed · '}${source.text.slice(0, 140)}`,
    };
    op.committed?.(update);
    this.emit();
    return { ...update, version: version + 1 };
  }

  undo(
    caseId: string,
    changeId: string,
    op: CaseOperation,
  ): { ok: true } | { error: string } {
    if (op.context.context.kind === 'team')
      return this.team!.undo(caseId, changeId, op);
    this.authorize(caseId, op);
    const change = this.store.change(caseId, changeId);
    if (!change) throw Error('unknown-change');
    if (change.undoneAt) throw Error('already-undone');
    const owner = this.store.owner(caseId)!;
    if (
      ![change.by, change.onBehalfOf, owner.owner_id].includes(LOCAL_PERSON) ||
      change.systemOwned ||
      (change.after ?? change.before)?.section === 'resolution' ||
      (change.before?.section === 'actions' &&
        change.before.pill !== 'Proposed')
    )
      throw Error('reserved-field');
    const version = this.store.version(caseId, change.entryId);
    if (change.version === undefined || version !== change.version)
      return { error: CHANGED_SINCE };
    this.guard(op);
    this.store.writeEntry({
      caseId,
      entryId: change.entryId,
      value: change.before,
      position: this.store.position(caseId, change.entryId) ?? 0,
      version: version + 1,
      expectedVersion: version,
      by: LOCAL_PERSON,
      at: this.now(),
      undo: changeId,
    });
    this.emit();
    return { ok: true };
  }
  close() {
    this.pending.abort();
    this.lifetime.abort();
    this.store.close();
  }
}
