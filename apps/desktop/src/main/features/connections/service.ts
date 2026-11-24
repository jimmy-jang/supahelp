import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  CatalogConnection,
  CatalogSetup,
  CatalogSnapshot,
} from '../../../contracts/catalog';
import { ApiConnection } from '../../integrations/connection-api.ts';
import { McpConnection } from '../../integrations/connection-mcp.ts';
import {
  ProviderError,
  redactConnection,
  toolFingerprint,
  type CatalogRecord,
} from '../../integrations/connection-oauth.ts';
import {
  connectionProviders,
  isCustomInstance,
  providerFor,
  type ConnectionProvider,
} from '../../integrations/connection-providers.ts';
import {
  OAuthBrokerError,
  type OAuthBroker,
} from '../../integrations/oauth-broker.ts';
import { oauthAvailable } from '../../integrations/oauth-apps.ts';
import { ConnectionStore } from '../../platform/connection-store.ts';
import { ConnectionActions } from './actions.ts';

type Remote = Omit<
  Pick<
    McpConnection,
    'connect' | 'listTools' | 'callTool' | 'finish' | 'close'
  >,
  'connect'
> & {
  connect(interactive: boolean): Promise<string | void>;
  verify?: ApiConnection['verify'];
  verificationCode?: string;
};
type Store = Pick<ConnectionStore<CatalogRecord>, 'load' | 'save'> & {
  remove?(): Promise<void>;
};
type Runtime = {
  // Provider id, or `custom-mcp-1a2b3c4d` for one of the user's own servers/APIs.
  id: string;
  provider: ConnectionProvider;
  record: CatalogRecord;
  store: Store;
  actions: ConnectionActions;
  state: CatalogConnection['state'];
  epoch: number;
  tools: Tool[];
  offered: Tool[];
  remote?: Remote;
  saving: Promise<void>;
  account?: string;
  message?: string;
};

export function connectionSetup(value: unknown): CatalogSetup {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    JSON.stringify(value).length > 100000
  )
    throw Error('Invalid setup.');
  const input = value as CatalogSetup;
  if (typeof input.id !== 'string' || input.id.length > 100)
    throw Error('Invalid connection.');
  const p = providerFor(input.id);
  if (
    !['read', 'write'].includes(input.access) ||
    !input.values ||
    typeof input.values !== 'object' ||
    Array.isArray(input.values)
  )
    throw Error('Invalid setup.');
  const values: Record<string, string> = {};
  for (const field of p.fields) {
    const value = input.values[field.key] ?? field.value ?? '';
    if (
      typeof value !== 'string' ||
      value.length > (field.multiline ? 48000 : 8192) ||
      (!field.optional && !value.trim()) ||
      (field.choices && !field.choices.includes(value))
    )
      throw Error(`Check ${field.label}.`);
    values[field.key] = value.trim();
  }
  return { id: input.id, access: input.access, values };
}

// A saved connection worth restoring. A REST API may need no credential: its saved operations are the setup.
function hasCredential(
  provider: ConnectionProvider,
  record: { tokens?: unknown; values: Record<string, string> },
) {
  return !!(
    record.tokens ||
    record.values.key ||
    (provider.id === 'custom-api' && record.values.operations)
  );
}

export class Connections {
  private items = new Map<string, Runtime>();
  private revision = 0;
  private loaded: Promise<void>;
  private signingIn?: string;
  private validator = new AjvJsonSchemaValidator();
  private changed: (snapshot: CatalogSnapshot) => void;
  private open: (url: string) => Promise<void>;
  private createRemote: (
    provider: ConnectionProvider,
    record: CatalogRecord,
    save: () => Promise<void>,
    open: (url: string) => Promise<void>,
    changed: () => void,
  ) => Remote;
  private accountContext?: {
    principal(): string | null;
    generation(): number;
    canUse(id: string): Promise<boolean>;
    canManage?(id: string): Promise<boolean>;
  };
  private restoring = new Map<string, Promise<void>>();
  private broker?: OAuthBroker;
  private makeStore: (id: string) => Store;
  private readonly pendingReview?: readonly string[];
  constructor(
    store: (id: string) => Store,
    open: (url: string) => Promise<void>,
    changed: (snapshot: CatalogSnapshot) => void,
    createRemote = (
      provider: ConnectionProvider,
      record: CatalogRecord,
      save: () => Promise<void>,
      external: (url: string) => Promise<void>,
      notify: () => void,
    ): Remote =>
      provider.transport === 'mcp'
        ? new McpConnection(provider, record, save, external, notify, broker)
        : new ApiConnection(provider, record, save, external, broker),
    accountContext?: {
      principal(): string | null;
      generation(): number;
      canUse(id: string): Promise<boolean>;
      canManage?(id: string): Promise<boolean>;
    },
    broker?: OAuthBroker,
    discover?: () => Promise<string[]>,
    pendingReview?: readonly string[],
  ) {
    this.pendingReview = pendingReview;
    this.makeStore = store;
    this.accountContext = accountContext;
    this.broker = broker;
    this.open = open;
    this.changed = changed;
    this.createRemote = createRemote;
    for (const provider of connectionProviders) this.add(provider.id, provider);
    this.loaded = this.restore(discover);
  }
  private add(id: string, provider: ConnectionProvider) {
    const item: Runtime = {
      id,
      provider,
      record: { access: 'read', actions: [], values: {} },
      store: this.makeStore(id),
      state: 'disconnected',
      epoch: 0,
      tools: [],
      offered: [],
      saving: Promise.resolve(),
      actions: undefined!,
    };
    item.actions = new ConnectionActions(
      () => this.nameOf(item),
      () => item.record.actions,
      () => this.save(item),
      () => this.publish(),
      () => ({
        account: item.account || this.nameOf(item),
        ...(this.accountContext?.principal()
          ? { principal: this.accountContext.principal()! }
          : {}),
        scope: `${id}:${JSON.stringify(
          Object.entries(item.record.values)
            .filter(([key]) =>
              [
                'site',
                'region',
                'endpoint',
                'orgId',
                'spaceId',
                'tenant',
                'teamId',
                'channelId',
                'channels',
                'environment',
                'instance',
              ].includes(key),
            )
            .sort(),
        )}`,
      }),
    );
    this.items.set(id, item);
    return item;
  }
  private nameOf(item: Runtime) {
    return (
      (isCustomInstance(item.id) && item.record.values.name?.trim()) ||
      item.provider.name
    );
  }
  private async restore(discover?: () => Promise<string[]>) {
    for (const id of (await discover?.().catch(() => [])) ?? [])
      if (isCustomInstance(id) && !this.items.has(id))
        this.add(id, providerFor(id));
    await this.adoptLegacy();
    await Promise.all(
      [...this.items.values()].map(async (item) => {
        try {
          const saved = await item.store.load();
          if (!saved) return;
          if (
            !saved.values ||
            typeof saved.values !== 'object' ||
            Array.isArray(saved.values) ||
            Object.values(saved.values).some(
              (value) => typeof value !== 'string',
            )
          )
            throw Error('Invalid connection record.');
          // A new server whose sign-in never finished leaves nothing worth keeping.
          if (
            isCustomInstance(item.id) &&
            !hasCredential(item.provider, saved) &&
            !saved.actions.length
          ) {
            this.items.delete(item.id);
            await item.store.remove?.();
            return;
          }
          item.record = saved;
          item.actions.recover();
          await this.save(item);
          if (
            hasCredential(item.provider, saved) &&
            (!this.accountContext ||
              (await this.accountContext.canUse(item.id)))
          )
            await this.establish(item, false);
        } catch {
          item.state = 'error';
          item.message =
            'Reconnect this service in Settings. Saved action receipts are retained.';
        }
      }),
    ).then(() => this.publish());
  }
  // Before multiple servers, `custom-mcp`/`custom-api` held the one saved record. Move it to a real instance.
  private async adoptLegacy() {
    for (const template of ['custom-mcp', 'custom-api']) {
      const legacy = this.items.get(template)!;
      try {
        const saved = await legacy.store.load();
        if (
          !saved ||
          !(saved.tokens || saved.values?.key || saved.actions?.length)
        )
          continue;
        const id = `${template}-00000000`;
        const item = this.items.get(id) ?? this.add(id, legacy.provider);
        await item.store.save({
          ...saved,
          values: { name: legacy.provider.name, ...saved.values },
        });
        await legacy.store.save({
          access: saved.access,
          values: {},
          actions: [],
        });
      } catch {
        /* Unreadable legacy data stays on disk; the user can set the server up again. */
      }
    }
  }
  private item(id: string) {
    const item = this.items.get(id);
    if (!item) throw Error('Unknown connection.');
    return item;
  }
  private save(item: Runtime) {
    const value = structuredClone(item.record);
    const next = item.saving.catch(() => {}).then(() => item.store.save(value));
    item.saving = next;
    return next;
  }
  snapshot(): CatalogSnapshot {
    return {
      revision: this.revision,
      pendingReview: this.pendingReview,
      connections: [...this.items.values()].map((item) => {
        const p = item.provider;
        return redactConnection(
          {
            id: item.id,
            instanceOf: isCustomInstance(item.id) ? p.id : undefined,
            name: this.nameOf(item),
            documentation: p.documentation,
            instructions: p.instructions,
            readOnly: p.readOnly,
            requiresSupahelpAccount: p.requiresSupahelpAccount,
            unavailable:
              (p.requiresSupahelpAccount && !this.broker) ||
              !oauthAvailable(p.id) ||
              undefined,
            fields: p.fields.map((field) => ({
              ...field,
              value: field.secret
                ? undefined
                : field.choices &&
                    !field.choices.includes(item.record.values[field.key])
                  ? (field.value ?? field.choices[0])
                  : (item.record.values[field.key] ?? field.value),
            })),
            revision: this.revision,
            state: item.state,
            access: item.record.access,
            account: item.account,
            message: item.message,
            verificationCode:
              item.state === 'connecting'
                ? item.remote?.verificationCode
                : undefined,
            manualReturn:
              item.state === 'connecting' &&
              item.record.values.redirectUri?.startsWith('https:'),
            tools: item.offered
              .filter(
                (tool) =>
                  p.id === 'custom-mcp' ||
                  item.tools.some((active) => active.name === tool.name),
              )
              .map((tool) => ({
                name: tool.name,
                description: tool.description,
                readOnly: item.tools.some(
                  (active) =>
                    active.name === tool.name &&
                    active.annotations?.readOnlyHint === true,
                ),
                inputSchema: tool.inputSchema,
                fingerprint: toolFingerprint(tool),
              })),
            actions: item.record.actions,
          },
          item.record,
        ) as CatalogConnection;
      }),
    };
  }
  private publish() {
    this.revision++;
    this.changed(this.snapshot());
  }
  async status() {
    await this.loaded;
    await Promise.all(
      [...this.items.values()].map(async (item) => {
        if (
          item.state !== 'disconnected' ||
          !hasCredential(item.provider, item.record) ||
          (this.accountContext &&
            !(await (this.accountContext.canManage?.(item.id) ??
              this.accountContext.canUse(item.id))))
        )
          return;
        let pending = this.restoring.get(item.id);
        if (!pending) {
          pending = this.establish(item, false)
            .catch(() => {
              item.state = 'error';
              item.message = 'Reconnect this service in Settings.';
            })
            .finally(() => {
              this.restoring.delete(item.id);
              this.publish();
            });
          this.restoring.set(item.id, pending);
        }
        await pending;
      }),
    );
    return this.snapshot();
  }
  async guide(id: string) {
    await this.open(providerFor(id).documentation);
  }
  private classify(item: Runtime, tools: Tool[]) {
    return tools.flatMap((tool) => {
      const custom = item.provider.id === 'custom-mcp';
      if (
        !custom &&
        item.provider.transport === 'mcp' &&
        /credential|secret|api.?key|token|export|execute|graphql|nerdgraph|shell|code_mode/i.test(
          tool.name,
        )
      )
        return [];
      const read =
        item.provider.transport === 'api'
          ? tool.annotations?.readOnlyHint === true
          : custom
            ? item.record.readTools?.[tool.name] === toolFingerprint(tool)
            : item.provider.reads?.test(tool.name) === true &&
              tool.annotations?.readOnlyHint !== false;
      // Every non-read tool is offered as a change behind approval; the
      // provider account's own permissions decide what actually succeeds.
      if (!read && (item.provider.readOnly || item.record.access === 'read'))
        return [];
      return [
        { ...tool, annotations: { ...tool.annotations, readOnlyHint: read } },
      ];
    });
  }
  private async establish(
    item: Runtime,
    interactive: boolean,
    guard?: () => void,
  ) {
    const epoch = item.epoch;
    const remote = this.createRemote(
      item.provider,
      item.record,
      async () => {
        if (epoch !== item.epoch) throw Error('Connection changed.');
        if (item.state === 'connecting') guard?.();
        await this.save(item);
      },
      this.open,
      () => {
        if (epoch === item.epoch) this.publish();
      },
    );
    item.remote = remote;
    const account = await remote.connect(interactive);
    guard?.();
    const tools = redactConnection(
      await remote.listTools(),
      item.record,
    ) as Tool[];
    if (epoch !== item.epoch) {
      await remote.close();
      throw Error('Connection changed.');
    }
    if (
      new Set(tools.map((tool) => tool.name)).size !== tools.length ||
      tools.some(
        (tool) =>
          !/^[a-zA-Z0-9_.-]{1,128}$/.test(tool.name) ||
          tool.inputSchema.type !== 'object',
      )
    )
      throw Error('Invalid provider tools.');
    for (const tool of tools) this.validator.getValidator(tool.inputSchema);
    item.offered = tools;
    item.tools = this.classify(item, tools);
    if (!item.tools.length && item.provider.id !== 'custom-mcp')
      throw Error('No supported tools are available with this grant.');
    item.account = typeof account === 'string' ? account : undefined;
    const identityTool: Record<string, string> = {
      hubspot: 'get_user_details',
      'hubspot-service': 'get_user_details',
      notion: 'notion-get-self',
      'github-issues': 'get_me',
      incidentio: 'identity_show',
    };
    const lookup = identityTool[item.provider.id];
    if (
      lookup &&
      item.tools.some(
        (tool) =>
          tool.name === lookup && tool.annotations?.readOnlyHint === true,
      )
    ) {
      try {
        const result = await remote.callTool(lookup, {});
        const part = result.content.find((part) => part.type === 'text');
        const value =
          result.structuredContent ??
          (part?.type === 'text' ? JSON.parse(part.text) : undefined);
        if (!result.isError && value && typeof value === 'object') {
          const user =
            value.user && typeof value.user === 'object' ? value.user : {};
          const workspace =
            value.workspace && typeof value.workspace === 'object'
              ? value.workspace
              : {};
          const parts = [
            workspace.name ??
              workspace.id ??
              value.portalId ??
              value.accountId ??
              value.workspace_id,
            user.name ??
              user.email ??
              value.displayName ??
              value.name ??
              value.login,
          ].filter(
            (part) => typeof part === 'string' || typeof part === 'number',
          );
          if (parts.length) item.account = parts.join(' · ').slice(0, 300);
        }
      } catch {
        /* Optional identity must not invent a user or invalidate a working grant. */
      }
    }
    if (epoch !== item.epoch) {
      await remote.close();
      throw Error('Connection changed.');
    }
    guard?.();
    item.state = 'connected';
    item.message =
      item.provider.id === 'custom-api'
        ? 'API setup saved. No request was sent yet: use Test access below to try one read operation. Supahelp enforces your operation definitions locally.'
        : item.tools.length
          ? 'Connected. Available actions remain subject to your provider permissions. Supahelp’s access choice is enforced locally.'
          : 'Review the discovered tools below and mark the ones you trust as read only, or reconnect with changes enabled to approve every call.';
    await this.save(item);
  }
  async connect(input: CatalogSetup, guard?: () => void) {
    await this.loaded;
    if (this.signingIn)
      throw Error('Finish or cancel the current sign-in first.');
    if (input?.id === 'custom-mcp' || input?.id === 'custom-api')
      throw Error('Add this as a new connection.');
    const item = isCustomInstance(input?.id)
      ? (this.items.get(input.id) ?? this.add(input.id, providerFor(input.id)))
      : this.item(input.id);
    await this.restoring.get(item.id);
    const p = providerFor(input.id);
    const { values } = connectionSetup(input);
    this.signingIn = input.id;
    try {
      if (p.requiresSupahelpAccount) {
        if (!this.broker) throw new OAuthBrokerError('unavailable');
        await this.broker.requireSignIn(new AbortController().signal);
      }
      await this.disconnect(input.id, guard);
      guard?.();
      item.record = {
        access: p.readOnly ? 'read' : input.access,
        values,
        actions: item.record.actions,
      };
      item.state = 'connecting';
      this.publish();
      const epoch = item.epoch;
      try {
        await this.establish(item, true, guard);
      } catch (error) {
        if (epoch === item.epoch) {
          item.state = 'error';
          item.tools = [];
          const reason = error instanceof Error ? error.message : '';
          item.message =
            reason === 'No supported tools are available with this grant.'
              ? 'Sign-in completed, but no supported actions were found. Check the provider’s available tools and scopes before using this connection.'
              : error instanceof OAuthBrokerError ||
                  error instanceof ProviderError
                ? error.message
                : reason.includes('sign-in is not configured in this build')
                  ? 'This connection is not configured in this build. Contact Supahelp support.'
                  : reason === 'Sign-in cancelled or timed out.'
                    ? 'Authorization was canceled or timed out. You can try again.'
                    : 'This connection did not finish. Check your account permissions and region, then try again.';
          await item.remote?.close();
        }
      }
      this.publish();
      return this.snapshot();
    } finally {
      this.signingIn = undefined;
    }
  }
  async disconnect(id: string, guard?: () => void) {
    await this.loaded;
    guard?.();
    const item = this.item(id);
    const canceled = item.state === 'connecting';
    item.epoch++;
    item.actions.cancelAll();
    const remote = item.remote;
    item.remote = undefined;
    item.state = 'disconnected';
    item.tools = [];
    item.offered = [];
    item.account = undefined;
    item.message = canceled
      ? 'Authorization was canceled. You can try again.'
      : undefined;
    const name = item.record.values.name;
    item.record = {
      access: item.record.access,
      values: isCustomInstance(id) && name ? { name } : {},
      actions: item.record.actions,
    };
    await this.save(item);
    await remote?.close();
    this.publish();
  }
  // Forget one of the user's own servers/APIs, including its saved receipts.
  async remove(id: string, guard?: () => void) {
    await this.loaded;
    guard?.();
    if (!isCustomInstance(id))
      throw Error('Only your own connections can be removed.');
    const item = this.item(id);
    await this.disconnect(id, guard);
    await item.saving;
    await item.store.remove?.();
    this.items.delete(id);
    this.publish();
  }
  async finish(id: string, url: string, guard?: () => void) {
    await this.loaded;
    guard?.();
    if (typeof url !== 'string' || url.length > 16000)
      throw Error('Invalid return address.');
    const item = this.item(id);
    if (item.state !== 'connecting')
      throw Error('Sign-in is no longer pending.');
    item.remote?.finish(url);
  }
  async reviewReads(
    id: string,
    tools: { name: string; fingerprint: string }[],
    guard?: () => void,
  ) {
    await this.loaded;
    guard?.();
    const item = this.item(id);
    if (
      item.provider.id !== 'custom-mcp' ||
      item.state !== 'connected' ||
      !Array.isArray(tools) ||
      tools.length > 2000
    )
      throw Error('Invalid read-tool review.');
    const approved: Record<string, string> = {};
    for (const value of tools) {
      const tool = item.offered.find((tool) => tool.name === value.name);
      if (!tool || value.fingerprint !== toolFingerprint(tool))
        throw Error('The tool changed. Review its current schema.');
      approved[value.name] = value.fingerprint;
    }
    const previous = item.record.readTools;
    item.record.readTools = approved;
    try {
      await this.save(item);
    } catch (error) {
      item.record.readTools = previous;
      throw error;
    }
    item.tools = this.classify(item, item.offered);
    item.actions.cancelAll();
    this.publish();
  }
  // A user-started check of one declared read operation, so a custom API's setup can be proven to work.
  async testRead(id: string, name: string, args: Record<string, unknown>) {
    await this.loaded;
    const item = this.item(id);
    const tool = item.tools.find((tool) => tool.name === name);
    if (
      item.provider.id !== 'custom-api' ||
      item.state !== 'connected' ||
      !item.remote ||
      tool?.annotations?.readOnlyHint !== true ||
      !this.validator.getValidator(tool.inputSchema)(args).valid
    )
      throw Error('Invalid test request.');
    // Network failures (wrong host, offline, redirect, timeout) are safe to explain: they hold no credential.
    const result = await item.remote
      .callTool(name, structuredClone(args), AbortSignal.timeout(30000))
      .catch((error: unknown) => {
        if (error instanceof ProviderError) throw error;
        const code = (error as { cause?: { code?: string } })?.cause?.code;
        throw new ProviderError(
          code === 'ENOTFOUND'
            ? 'That address was not found. Check the API base address.'
            : error instanceof Error && error.name === 'TimeoutError'
              ? 'The API did not answer in 30 seconds.'
              : error instanceof Error && /redirect/i.test(error.message)
                ? 'The API redirected the request. Supahelp does not follow redirects: use the final base address.'
                : `Could not reach the API${code ? ` (${code})` : ''}. Check the base address and your connection.`,
        );
      });
    const part = result.content.find((part) => part.type === 'text');
    return { preview: part?.type === 'text' ? part.text.slice(0, 2000) : '' };
  }
  async decide(
    id: string,
    action: string,
    decision: 'approve' | 'deny' | 'checked',
  ) {
    await this.loaded;
    if (
      !['approve', 'deny', 'checked'].includes(decision) ||
      typeof action !== 'string' ||
      action.length > 100
    )
      throw Error('Invalid decision.');
    await this.item(id).actions.decide(action, decision);
  }
  resumeChat(chatId: string) {
    for (const item of this.items.values()) item.actions.resumeChat(chatId);
  }
  async cancelCase(id: string) {
    await Promise.all(
      [...this.items.values()].map((item) => item.actions.cancelCase(id)),
    );
  }
  cancelChat(chatId: string) {
    for (const item of this.items.values()) item.actions.cancelChat(chatId);
  }
  async agents(chatId: string) {
    const accountGeneration = this.accountContext?.generation();
    await this.status();
    const available = [];
    for (const item of this.items.values())
      if (!this.accountContext || (await this.accountContext.canUse(item.id)))
        available.push(item);
    return available
      .filter((item) => item.state === 'connected' && item.remote)
      .map((item) => {
        const epoch = item.epoch;
        const remote = item.remote!;
        const tools = item.tools;
        const active = () => {
          if (
            accountGeneration !== this.accountContext?.generation() ||
            epoch !== item.epoch ||
            tools !== item.tools ||
            item.state !== 'connected' ||
            item.actions.isCancelled(chatId)
          )
            throw Error('This connection changed or the chat stopped.');
        };
        return {
          id: item.id,
          name: item.id.replaceAll('-', '_'),
          agent: {
            tools,
            call: async (
              name: string,
              args: Record<string, unknown>,
              signal?: AbortSignal,
            ) => {
              active();
              args = structuredClone(args);
              let tool = tools.find((tool) => tool.name === name);
              if (!tool) throw Error('Tool unavailable.');
              if (
                JSON.stringify(args).length > 48000 ||
                !this.validator.getValidator(tool.inputSchema)(args).valid
              )
                throw Error('Invalid tool inputs.');
              if (
                item.record.access === 'read' &&
                tool.annotations?.readOnlyHint !== true
              )
                throw Error('This connection is read only.');
              this.validateEffect(item, name, args);
              let supplied =
                item.provider.id === 'stripe' &&
                tool.annotations?.readOnlyHint !== true
                  ? { ...args, _requestId: randomUUID() }
                  : args;
              let execute = (
                value: Record<string, unknown>,
                abort: AbortSignal,
              ) => remote.callTool(name, value, abort);
              if (item.provider.id === 'front' && name === 'send_message') {
                const readDraft = async (abort?: AbortSignal) => {
                  active();
                  if (
                    !tools.some(
                      (tool) =>
                        tool.name === 'read_message' &&
                        tool.annotations?.readOnlyHint === true,
                    ) ||
                    typeof args.draftId !== 'string'
                  )
                    throw Error('Read the draft before sending.');
                  const result = await remote.callTool(
                    'read_message',
                    { messageId: args.draftId },
                    abort,
                  );
                  const part = result.content.find(
                    (part) => part.type === 'text',
                  );
                  const draft =
                    result.structuredContent ??
                    (part?.type === 'text' ? JSON.parse(part.text) : undefined);
                  if (
                    result.isError ||
                    !draft ||
                    typeof draft !== 'object' ||
                    draft.id !== args.draftId ||
                    typeof draft.body !== 'string' ||
                    !Array.isArray(draft.recipients) ||
                    !draft.recipients.length ||
                    !(draft.draft_version || draft.draftVersion)
                  )
                    throw Error(
                      'The draft’s identity, recipients, content and version could not be confirmed.',
                    );
                  return draft;
                };
                const draft = await readDraft(signal);
                tool = {
                  ...tool,
                  inputSchema: {
                    ...tool.inputSchema,
                    properties: {
                      ...tool.inputSchema.properties,
                      _review: { type: 'object' },
                    },
                  },
                };
                supplied = { ...args, _review: draft };
                execute = async (value, abort) => {
                  // shortcut: Front has no conditional send; recheck now and upgrade when version-guarded sending is available.
                  if (!isDeepStrictEqual(await readDraft(abort), value._review))
                    throw Error(
                      'The draft changed after approval. Review it again.',
                    );
                  active();
                  const { _review: _reviewed, ...parameters } = value;
                  return remote.callTool(name, parameters, abort);
                };
              }
              return item.actions.run(
                chatId,
                tool,
                supplied,
                active,
                execute,
                signal,
                item.provider.id === 'stripe' && remote.verify
                  ? (result, value, abort) =>
                      remote.verify!(name, result, value, abort)
                  : undefined,
                item.provider.id === 'stripe'
                  ? (value) =>
                      Object.fromEntries(
                        Object.entries(value).filter(
                          ([key]) => key !== '_requestId',
                        ),
                      )
                  : item.provider.id === 'front' && name === 'send_message'
                    ? (value) => ({ draftId: value.draftId })
                    : undefined,
              );
            },
          },
        };
      });
  }
  private validateEffect(
    item: Runtime,
    name: string,
    args: Record<string, unknown>,
  ) {
    if (
      item.provider.id === 'stripe' &&
      [
        'refund_charge',
        'cancel_subscription',
        'change_plan',
        'add_credit',
      ].includes(name) &&
      item.record.actions.some(
        (action) =>
          action.account === item.account &&
          ['pending', 'running', 'unknown'].includes(action.status) &&
          (action.arguments.charge_id ?? action.arguments.id) ===
            (args.charge_id ?? args.id),
      )
    )
      throw Error(
        'A change to this Stripe target is pending or uncertain. Check its receipt before another change.',
      );
    if (
      item.provider.id === 'github-issues' &&
      name === 'issue_write' &&
      args.method !== 'create'
    )
      throw Error('Only issue creation is enabled.');
    if (
      name === 'addOrEditJiraIssueComment' &&
      (args.commentId || args.comment_id)
    )
      throw Error('Only new comments are enabled.');
    if (
      item.provider.id.startsWith('hubspot') &&
      !item.provider.reads?.test(name) &&
      !['create_note'].includes(name) &&
      !['tickets', 'notes', '0-5', '0-46'].includes(String(args.objectType))
    )
      throw Error('Only ticket and note changes are enabled.');
  }
  async close() {
    await this.loaded;
    for (const item of this.items.values()) {
      item.actions.cancelAll();
      await item.remote?.close();
      await item.saving;
    }
  }
}
