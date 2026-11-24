import type { ZendeskSetup, ZendeskSnapshot } from '../../../contracts/zendesk';
import {
  ZendeskAuthorizationError,
  ZendeskRemote,
  zendeskSite,
  zendeskTools,
  type ZendeskRecord,
} from '../../integrations/zendesk.ts';
import { ConnectionActions } from '../connections/actions.ts';

type Remote = Pick<
  ZendeskRemote,
  'connect' | 'listTools' | 'callTool' | 'verify' | 'close' | 'user'
>;
type Store = {
  load(): Promise<ZendeskRecord | undefined>;
  save(value: ZendeskRecord): Promise<void>;
};
const effect = (args: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(args).filter(([key]) => key !== 'updated_stamp'),
  );

export class ZendeskConnector {
  private record: ZendeskRecord = { access: 'read', actions: [] };
  private remote?: Remote;
  private state: ZendeskSnapshot['state'] = 'disconnected';
  private message?: string;
  private revision = 0;
  private epoch = 0;
  private connecting = false;
  private loaded: Promise<void>;
  private saving = Promise.resolve();
  private store: Store;
  private open: (url: string) => Promise<void>;
  private changed: (snapshot: ZendeskSnapshot) => void;
  private createRemote: (
    record: ZendeskRecord,
    save: () => Promise<void>,
    open: (url: string) => Promise<void>,
  ) => Remote;
  private actions: ConnectionActions;
  private accountContext?: {
    principal(): string | null;
    generation(): number;
    canUse(): Promise<boolean>;
    canManage?(): Promise<boolean>;
  };
  private restoring?: Promise<void>;
  private defaultClientId?: string;
  constructor(
    store: Store,
    open: (url: string) => Promise<void>,
    changed: (snapshot: ZendeskSnapshot) => void,
    createRemote = (
      record: ZendeskRecord,
      save: () => Promise<void>,
      open: (url: string) => Promise<void>,
    ): Remote => new ZendeskRemote(record, save, open),
    defaultClientId?: string,
    accountContext?: {
      principal(): string | null;
      generation(): number;
      canUse(): Promise<boolean>;
      canManage?(): Promise<boolean>;
    },
  ) {
    this.accountContext = accountContext;
    this.store = store;
    this.open = open;
    this.changed = changed;
    this.createRemote = createRemote;
    this.record.clientId = defaultClientId;
    this.defaultClientId = defaultClientId;
    this.actions = new ConnectionActions(
      'Zendesk',
      () => this.record.actions,
      () => this.save(),
      () => this.publish(),
      () => ({
        account: `${this.record.site}${this.remote?.user?.name ? ` · ${this.remote.user.name}` : ''}`,
        scope: this.record.site,
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
        'Zendesk could not reconnect. Check the OAuth client and your access. Saved action receipts are kept.';
    }
    this.publish();
  }
  private save() {
    const value = structuredClone(this.record);
    const next = this.saving.catch(() => {}).then(() => this.store.save(value));
    this.saving = next;
    return next;
  }
  private scopes() {
    return this.record.tokens?.scope?.split(/\s+/).filter(Boolean) ?? [];
  }
  snapshot(): ZendeskSnapshot {
    const scopes = this.scopes();
    const write =
      this.record.access === 'write' &&
      scopes.some((scope) => scope === 'write' || scope === 'tickets:write');
    return structuredClone({
      revision: this.revision,
      state: this.state,
      access: write ? 'write' : 'read',
      site: this.record.site,
      clientId: this.defaultClientId,
      account: this.remote?.user?.name,
      role: this.remote?.user?.role,
      scopes,
      message: this.message,
      tools:
        this.state === 'connected'
          ? zendeskTools(scopes)
              .filter((tool) => write || tool.annotations?.readOnlyHint)
              .map((tool) => ({
                name: tool.name,
                description: tool.description,
                readOnly: tool.annotations?.readOnlyHint === true,
              }))
          : [],
      actions: this.record.actions,
    });
  }
  private publish() {
    this.revision++;
    this.changed(this.snapshot());
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
          this.message = 'Zendesk could not reconnect. Reconnect in Settings.';
        })
        .finally(() => {
          this.restoring = undefined;
          this.publish();
        });
      await this.restoring;
    }
    return this.snapshot();
  }
  private async establish(interactive: boolean, guard?: () => void) {
    const epoch = this.epoch;
    this.record.site = zendeskSite(this.record.site ?? '');
    const remote = this.createRemote(
      this.record,
      async () => {
        if (epoch !== this.epoch) throw Error('Zendesk disconnected.');
        if (this.state === 'connecting') guard?.();
        await this.save();
        this.publish();
      },
      this.open,
    );
    this.remote = remote;
    await remote.connect(interactive);
    guard?.();
    if (epoch !== this.epoch) {
      await remote.close();
      throw Error('Zendesk disconnected.');
    }
    this.state = 'connected';
    this.message = undefined;
  }
  async connect(setup: ZendeskSetup, guard?: () => void) {
    await this.loaded;
    await this.restoring;
    const site = zendeskSite(setup.site);
    const clientId = this.defaultClientId;
    if (!clientId)
      throw Error(
        'Supahelp’s Zendesk sign-in is not configured in this build. Contact Supahelp support.',
      );
    if (
      !/^[\w.-]{1,200}$/.test(clientId) ||
      !['read', 'write'].includes(setup.access)
    )
      throw Error('Choose valid Zendesk OAuth settings.');
    if (this.connecting) throw Error('Zendesk sign-in is already in progress.');
    this.connecting = true;
    try {
      await this.disconnect(guard);
      guard?.();
      this.record.site = site;
      this.record.clientId = clientId;
      this.record.access = setup.access;
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
            'Zendesk did not connect. Check the public OAuth client ID, registered callback and agent access, then try again.';
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
    this.record = {
      access: this.record.access,
      actions: this.record.actions,
      site: this.record.site,
      clientId: this.record.clientId,
    };
    this.state = 'disconnected';
    this.message = undefined;
    await this.save();
    await remote?.close();
    this.publish();
  }
  resumeChat(id: string) {
    this.actions.resumeChat(id);
  }
  cancelCase(id: string) {
    return this.actions.cancelCase(id);
  }
  cancelChat(id: string) {
    this.actions.cancelChat(id);
  }
  async decide(id: string, decision: 'approve' | 'deny' | 'checked') {
    await this.loaded;
    return this.actions.decide(id, decision);
  }
  private async authorized<T>(
    remote: Remote,
    epoch: number,
    run: () => Promise<T>,
  ) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ZendeskAuthorizationError && epoch === this.epoch) {
        this.epoch++;
        this.state = 'error';
        this.message =
          'Zendesk authorization expired or was revoked. Sign in again to restore access.';
        this.actions.cancelAll();
        this.publish();
        await remote.close();
      }
      throw error;
    }
  }
  async agent(
    chatId: string,
    source?: { caseId: string; resolutionId: string },
    guard?: () => void,
    pending?: (id: string) => void,
  ) {
    const accountGeneration = this.accountContext?.generation();
    if (this.accountContext && !(await this.accountContext.canUse())) return;
    await this.status();
    await this.loaded;
    if (this.state !== 'connected' || !this.remote) return;
    const epoch = this.epoch;
    const remote = this.remote;
    const tools = await this.authorized(remote, epoch, () =>
      remote.listTools(),
    );
    const active = () => {
      guard?.();
      if (
        accountGeneration !== this.accountContext?.generation() ||
        epoch !== this.epoch ||
        this.state !== 'connected' ||
        this.actions.isCancelled(chatId)
      )
        throw Error('Zendesk disconnected or the request was cancelled.');
    };
    return {
      tools,
      call: async (
        name: string,
        args: Record<string, unknown>,
        signal?: AbortSignal,
      ) => {
        active();
        const tool = tools.find((item) => item.name === name);
        if (!tool) throw Error('This Zendesk tool is not available.');
        return this.actions.run(
          chatId,
          tool,
          args,
          active,
          (input, callSignal) =>
            this.authorized(remote, epoch, () =>
              remote.callTool(name, input, callSignal),
            ),
          signal,
          tool.annotations?.readOnlyHint === true
            ? undefined
            : (result, input, callSignal) =>
                this.authorized(remote, epoch, () =>
                  remote.verify(name, result, input, callSignal),
                ),
          effect,
          source,
          pending,
        );
      },
    };
  }
  async close() {
    await this.loaded;
    this.actions.cancelAll();
    await this.remote?.close();
    await this.saving;
  }
}
