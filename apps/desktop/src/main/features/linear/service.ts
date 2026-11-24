import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { LinearAccess, LinearSnapshot } from '../../../contracts/linear';
import { LinearRemote } from '../../integrations/linear.ts';
import type { LinearRecord } from '../../platform/linear-store';
import { ConnectionActions } from '../connections/actions.ts';

type Remote = Pick<
  LinearRemote,
  'connect' | 'listTools' | 'callTool' | 'close'
>;
type Store = {
  load(): Promise<LinearRecord | undefined>;
  save(value: LinearRecord): Promise<void>;
};
export class LinearConnector {
  private record: LinearRecord = { access: 'read', actions: [] };
  private state: LinearSnapshot['state'] = 'disconnected';
  private message?: string;
  private account?: string;
  private remote?: Remote;
  private tools: Tool[] = [];
  private epoch = 0;
  private revision = 0;
  private connecting = false;
  private loaded: Promise<void>;
  private saving = Promise.resolve();
  private actions: ConnectionActions;
  private store: Store;
  private openExternal: (url: string) => Promise<void>;
  private changed: (snapshot: LinearSnapshot) => void;
  private createRemote: (
    record: LinearRecord,
    save: () => Promise<void>,
    open: (url: string) => Promise<void>,
  ) => Remote;
  private accountContext?: {
    principal(): string | null;
    generation(): number;
    canUse(): Promise<boolean>;
    canManage?(): Promise<boolean>;
  };
  private restoring?: Promise<void>;

  constructor(
    store: Store,
    openExternal: (url: string) => Promise<void>,
    changed: (snapshot: LinearSnapshot) => void,
    createRemote = (
      record: LinearRecord,
      save: () => Promise<void>,
      open: (url: string) => Promise<void>,
    ): Remote => new LinearRemote(record, save, open),
    accountContext?: {
      principal(): string | null;
      generation(): number;
      canUse(): Promise<boolean>;
      canManage?(): Promise<boolean>;
    },
  ) {
    this.accountContext = accountContext;
    this.store = store;
    this.openExternal = openExternal;
    this.changed = changed;
    this.createRemote = createRemote;
    this.actions = new ConnectionActions(
      'Linear',
      () => this.record.actions,
      () => this.save(),
      () => this.publish(),
      () => ({
        account: this.account,
        ...(accountContext?.principal()
          ? { principal: accountContext.principal()! }
          : {}),
      }),
    );
    this.loaded = this.load();
  }
  private async load() {
    try {
      const saved = await this.store.load();
      if (!saved) return;
      this.record = saved;
      this.actions.recover();
      await this.save();
      if (
        saved.tokens &&
        (!this.accountContext || (await this.accountContext.canUse()))
      )
        await this.establish(false);
    } catch {
      this.state = 'error';
      this.message =
        'Linear could not reconnect. Reconnect in Settings; saved action receipts are kept.';
    }
    this.publish();
  }
  private save() {
    const value = structuredClone(this.record);
    const next = this.saving.catch(() => {}).then(() => this.store.save(value));
    this.saving = next;
    return next;
  }
  snapshot(): LinearSnapshot {
    return structuredClone({
      revision: this.revision,
      state: this.state,
      access: this.record.access,
      account: this.account,
      message: this.message,
      tools: this.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        readOnly:
          this.record.access === 'read' ||
          tool.annotations?.readOnlyHint === true,
      })),
      actions: this.record.actions,
    });
  }
  async status() {
    await this.loaded;
    if (
      this.state === 'disconnected' &&
      this.record.tokens &&
      (!this.accountContext ||
        (await (this.accountContext.canManage?.() ??
          this.accountContext.canUse())))
    ) {
      this.restoring ??= this.establish(false)
        .catch(() => {
          this.state = 'error';
          this.message = 'Linear could not reconnect. Reconnect in Settings.';
        })
        .finally(() => {
          this.restoring = undefined;
          this.publish();
        });
      await this.restoring;
    }
    return this.snapshot();
  }
  private publish() {
    this.revision++;
    this.changed(this.snapshot());
  }
  private async establish(interactive: boolean, guard?: () => void) {
    const epoch = this.epoch;
    const remote = this.createRemote(
      this.record,
      async () => {
        if (epoch !== this.epoch) throw Error('Linear disconnected.');
        if (this.state === 'connecting') guard?.();
        await this.save();
      },
      this.openExternal,
    );
    this.remote = remote;
    const readEndpoint = this.record.access === 'read';
    await remote.connect(interactive);
    guard?.();
    const tools = await remote.listTools();
    if (epoch !== this.epoch) {
      await remote.close();
      throw Error('Linear disconnected.');
    }
    const scopes = this.record.tokens?.scope?.split(/\s+/);
    if (
      scopes &&
      !scopes.some((scope) =>
        ['write', 'issues:create', 'comments:create'].includes(scope),
      )
    )
      this.record.access = 'read';
    this.tools =
      this.record.access === 'read'
        ? tools
            .filter((tool) =>
              readEndpoint
                ? tool.annotations?.readOnlyHint !== false
                : tool.annotations?.readOnlyHint === true,
            )
            .map((tool) => ({
              ...tool,
              annotations: { ...tool.annotations, readOnlyHint: true },
            }))
        : tools;
    this.state = 'connected';
    this.message = undefined;
    // Identity is optional: do not invent a workspace or identity from a successful login.
    if (
      tools.some(
        (tool) =>
          tool.name === 'get_user' && tool.inputSchema.properties?.query,
      )
    ) {
      try {
        const result = await remote.callTool('get_user', { query: 'me' });
        const text = result.content.find((part) => part.type === 'text');
        const user = text?.type === 'text' ? JSON.parse(text.text) : undefined;
        if (typeof user?.name === 'string')
          this.account = user.name.slice(0, 150);
      } catch {
        /* Optional identity lookup must not invalidate a working connection. */
      }
    }
  }
  async connect(access: LinearAccess, guard?: () => void) {
    await this.loaded;
    await this.restoring;
    if (!['read', 'write'].includes(access))
      throw Error('Choose valid Linear access.');
    if (this.connecting)
      throw Error('A Linear sign-in is already in progress.');
    this.connecting = true;
    try {
      await this.disconnect(guard);
      guard?.();
      this.record.access = access;
      this.state = 'connecting';
      this.publish();
      const epoch = this.epoch;
      try {
        await this.establish(true, guard);
        guard?.();
        await this.save();
      } catch {
        if (epoch === this.epoch) {
          this.state = 'error';
          this.message =
            'Linear did not connect. Try again and complete sign-in in your browser.';
          await this.remote?.close();
        }
      }
      this.publish();
      return this.snapshot();
    } finally {
      this.connecting = false;
    }
  }
  async disconnect(guard?: () => void) {
    await this.loaded;
    guard?.();
    this.epoch++;
    this.actions.cancelAll();
    const remote = this.remote;
    this.remote = undefined;
    this.tools = [];
    this.account = undefined;
    this.state = 'disconnected';
    this.message = undefined;
    this.record = { access: this.record.access, actions: this.record.actions };
    await this.save();
    await remote?.close();
    this.publish();
  }
  resumeChat(chatId: string) {
    this.actions.resumeChat(chatId);
  }
  cancelCase(id: string) {
    return this.actions.cancelCase(id);
  }
  cancelChat(chatId: string) {
    this.actions.cancelChat(chatId);
  }
  async agent(chatId: string) {
    const accountGeneration = this.accountContext?.generation();
    if (this.accountContext && !(await this.accountContext.canUse())) return;
    await this.status();
    await this.loaded;
    if (this.state !== 'connected' || !this.remote) return;
    const epoch = this.epoch;
    const remote = this.remote;
    const tools = this.tools;
    const active = () => {
      if (
        accountGeneration !== this.accountContext?.generation() ||
        epoch !== this.epoch ||
        this.state !== 'connected' ||
        this.actions.isCancelled(chatId)
      )
        throw Error('Linear disconnected or this request was cancelled.');
    };
    return {
      tools,
      call: async (
        name: string,
        supplied: Record<string, unknown>,
        signal?: AbortSignal,
      ) => {
        active();
        const tool = tools.find((item) => item.name === name);
        if (!tool) throw Error('This Linear tool is not available.');
        // The dedicated read-only endpoint cannot expose writes; also reject explicit write annotations.
        if (
          this.record.access === 'read' &&
          tool.annotations?.readOnlyHint !== true
        )
          throw Error('Linear has read-only access.');
        return this.actions.run(
          chatId,
          tool,
          supplied,
          active,
          (args, callSignal) => remote.callTool(name, args, callSignal),
          signal,
          ['create_issue', 'update_issue', 'save_issue'].includes(name) &&
            tools.some(
              (item) =>
                item.name === 'get_issue' &&
                item.annotations?.readOnlyHint === true,
            )
            ? async (result, args, callSignal) => {
                const text = result.content.find(
                  (part) => part.type === 'text',
                );
                const issue =
                  text?.type === 'text' ? JSON.parse(text.text) : undefined;
                if (typeof issue?.id !== 'string') return;
                const check = await remote.callTool(
                  'get_issue',
                  { id: issue.id },
                  callSignal,
                );
                const body = check.content.find((part) => part.type === 'text');
                const confirmed =
                  body?.type === 'text' ? JSON.parse(body.text) : undefined;
                if (
                  !check.isError &&
                  confirmed?.id === issue.id &&
                  Object.entries(args).every(([key, value]) =>
                    key === 'id'
                      ? value === confirmed.id || value === confirmed.identifier
                      : JSON.stringify(confirmed[key]) ===
                        JSON.stringify(value),
                  )
                )
                  return `Read back issue ${issue.id} in Linear and checked the supplied fields.`;
              }
            : undefined,
        );
      },
    };
  }
  async decide(id: string, decision: 'approve' | 'deny' | 'checked') {
    await this.loaded;
    return this.actions.decide(id, decision);
  }
  async close() {
    await this.loaded;
    this.actions.cancelAll();
    await this.remote?.close();
    await this.saving;
  }
}
