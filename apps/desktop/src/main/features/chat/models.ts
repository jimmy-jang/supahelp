import type { CaseUpdate } from '../../../contracts/cases';
import type {
  ChatOptions,
  Effort,
  ModelSelection,
  ModelsSettings,
  ProviderId,
} from '../../../contracts/chat';
import type { ClaudeCode } from '../../integrations/claude-code';
import type { Codex } from '../../integrations/codex';
import {
  connectorAgent,
  type AgentConnection,
  type AgentTools,
} from '../../integrations/connector-agent.ts';
import type { ModelCredentials } from '../../platform/model-credentials';
import { assertSubscriptionEnabled } from '../../platform/model-credentials.ts';
import {
  isModelSelection,
  readModelPreferences,
  writeModelPreferences,
} from '../../platform/model-settings.ts';
import { caseAgent } from '../cases/agent.ts';
import type { ResolveService } from '../cases/resolve';
import type { CaseService } from '../cases/service';
import type { Connections } from '../connections/service';
import type { LinearConnector } from '../linear/service';
import { playbookAgent } from '../playbooks/agent.ts';
import type { PlaybookService } from '../playbooks/service';
import type { ZendeskConnector } from '../zendesk/service';
import { DocumentInference } from './document-inference.ts';
import type { ChatService, ChatSession } from './service';

export class ChatModels {
  private file: string;
  readonly claude: ClaudeCode;
  readonly codex: Codex;
  private selected?: ModelSelection;
  private codexExecutable?: string;
  private loaded: Promise<void>;
  private credentials?: ModelCredentials;
  private changingAuthentication = false;

  private async changeAuthentication(
    run: (guard: () => void) => Promise<void>,
  ) {
    if (this.changingAuthentication) throw Error('model-busy');
    this.changingAuthentication = true;
    const generation = () =>
      this.accountContext?.authenticationGeneration?.() ??
      this.accountContext?.generation();
    const started = generation();
    const guard = () => {
      if (started !== generation()) throw Error('account-access');
    };
    try {
      await this.loaded;
      guard();
      await run(guard);
      guard();
    } finally {
      this.changingAuthentication = false;
    }
  }
  private linear?: LinearConnector;
  private zendesk?: ZendeskConnector;
  private connections?: Connections;
  private documents: DocumentInference;
  private cases?: CaseService;
  private resolution?: {
    resolve: ResolveService;
    chats: Pick<ChatService, 'offerResolutionReview'>;
  };
  configureResolution(
    resolve: ResolveService,
    chats: Pick<ChatService, 'offerResolutionReview'>,
  ) {
    this.resolution = { resolve, chats };
  }
  private playbooks?: PlaybookService;
  private attachedPlaybooks = new Map<string, string[]>();
  freshTools(chatId: string) {
    return !!this.attachedPlaybooks.get(chatId)?.length;
  }
  private playbookChats?: Pick<
    ChatService,
    'playbookFocus' | 'offerPlaybookAction' | 'requestFileApproval'
  >;
  configurePlaybooks(
    books: PlaybookService,
    chats?: ChatModels['playbookChats'],
  ) {
    this.playbooks = books;
    this.playbookChats = chats;
  }
  attachPlaybooks(chatId: string, ids: string[]) {
    if (ids.length) this.attachedPlaybooks.set(chatId, [...ids]);
    else this.attachedPlaybooks.delete(chatId);
  }
  private caseUpdated?: (chatId: string, update: CaseUpdate) => void;
  private accountContext?: {
    generation(): number;
    authenticationGeneration?(): number;
    canUse(capability: string): Promise<boolean>;
  };

  constructor(
    file: string,
    claude: ClaudeCode,
    codex: Codex,
    linear?: LinearConnector,
    zendesk?: ZendeskConnector,
    connections?: Connections,
    accountContext?: ChatModels['accountContext'],
    cases?: CaseService,
    caseUpdated?: (chatId: string, update: CaseUpdate) => void,
    credentials?: ModelCredentials,
  ) {
    this.credentials = credentials;
    this.cases = cases;
    this.caseUpdated = caseUpdated;
    this.accountContext = accountContext;
    this.file = file;
    this.claude = claude;
    this.codex = codex;
    this.linear = linear;
    this.zendesk = zendesk;
    this.connections = connections;
    this.loaded = this.load();
    this.documents = new DocumentInference(
      claude,
      codex,
      () => this.settings(),
      accountContext,
    );
  }

  private async load() {
    const value = await readModelPreferences(this.file);
    this.selected = value.selected;
    this.codexExecutable = value.codexExecutable;
    if (this.codexExecutable) this.codex.useExecutable(this.codexExecutable);
  }

  private async save() {
    await writeModelPreferences(this.file, {
      selected: this.selected,
      codexExecutable: this.codexExecutable,
    });
  }

  async settings(): Promise<ModelsSettings> {
    await this.loaded;
    const [claude, chatgpt] = await Promise.all([
      this.claude.status(),
      this.codex.status(),
    ]);
    const models: ModelsSettings['models'] = [];
    if (claude.state === 'ready') {
      const catalog = await this.claude.models().catch(() => []);
      for (const model of catalog) {
        if (
          /^[a-zA-Z0-9._-]{1,120}$/.test(model.value) &&
          model.value !== 'default'
        )
          models.push({
            provider: 'claude',
            model: model.value,
            label: model.displayName,
            efforts: model.supportedEffortLevels,
          });
      }
      if (!catalog.length)
        for (const model of ['sonnet', 'opus', 'haiku'])
          models.push({
            provider: 'claude',
            model,
            label: `Claude ${model[0].toUpperCase()}${model.slice(1)}`,
          });
    }
    if (chatgpt.state === 'ready') {
      for (const model of await this.codex.models().catch(() => []))
        if (
          model.model !== 'default' &&
          isModelSelection({ provider: 'chatgpt', model: model.model })
        )
          models.push({
            provider: 'chatgpt',
            model: model.model,
            label: model.displayName,
            efforts: model.supportedReasoningEfforts
              ?.map((item) => item.reasoningEffort)
              .filter((value): value is Effort =>
                ['low', 'medium', 'high', 'xhigh', 'max'].includes(value),
              ),
          });
    }
    // Masking and drafting run with this selection, so prefer a provider the
    // current account may use; the saved choice can belong to another account.
    const usable: ModelsSettings['models'] = [];
    for (const model of models)
      if (
        !this.accountContext ||
        (await this.accountContext.canUse(`model:${model.provider}`))
      )
        usable.push(model);
    const saved =
      this.selected?.model !== 'default' && this.selected
        ? this.selected
        : undefined;
    const selected = (saved && usable.some((m) => m.provider === saved.provider)
      ? saved
      : undefined) ??
      usable.find(
        (model) => model.provider === 'claude' && model.model === claude.model,
      ) ??
      usable[0] ??
      saved ?? { provider: 'claude' as const, model: 'sonnet' };
    return {
      providers: [
        {
          ...claude,
          id: 'claude',
          authentication: (await this.credentials?.get('claude'))?.mode,
        },
        {
          ...chatgpt,
          authentication: (await this.credentials?.get('chatgpt'))?.mode,
        },
      ],
      models,
      selected: { provider: selected.provider, model: selected.model },
    };
  }

  async select(selection: ModelSelection, guard?: () => void) {
    const settings = await this.settings();
    if (
      this.accountContext &&
      !(await this.accountContext.canUse(`model:${selection.provider}`))
    )
      throw Error('account-access');
    if (
      !settings.models.some(
        (model) =>
          model.provider === selection.provider &&
          model.model === selection.model,
      ) ||
      !settings.providers.some(
        (provider) =>
          provider.id === selection.provider && provider.state === 'ready',
      )
    )
      throw Error('invalid-model');
    guard?.();
    const previous = this.selected;
    this.selected = selection;
    try {
      await this.save();
    } catch (error) {
      this.selected = previous;
      throw error;
    }
  }

  async connect(
    provider: ProviderId,
    openExternal: (url: string) => Promise<void>,
  ) {
    return this.changeAuthentication(async (guard) => {
      assertSubscriptionEnabled();
      this.cancelMasking(provider);
      if (this.credentials) {
        if (provider === 'chatgpt') await this.codex.disconnect();
        else this.claude.close();
        guard();
        await this.credentials.set(provider, 'subscription');
        guard();
      }
      if (provider === 'chatgpt') {
        const url = await this.codex.signIn();
        guard();
        try {
          await openExternal(url);
          guard();
        } catch (error) {
          await this.codex.disconnect();
          throw error;
        }
      } else {
        await this.claude.configure({ enabled: true });
        guard();
        await this.claude.signIn();
      }
    });
  }

  async disconnect(provider: ProviderId) {
    return this.changeAuthentication(async (guard) => {
      this.cancelMasking(provider);
      // Remove the durable key even if a provider process no longer responds.
      await this.credentials?.set(provider, 'disconnected');
      guard();
      if (provider === 'chatgpt') await this.codex.disconnect();
      else await this.claude.configure({ enabled: false });
    });
  }

  async setApiKey(provider: ProviderId, key: string) {
    return this.changeAuthentication(async (guard) => {
      if (!this.credentials) throw Error('model-credentials');
      this.cancelMasking(provider);
      if (provider === 'chatgpt') {
        await this.codex.disconnect();
        guard();
      }
      await this.credentials.set(provider, 'api-key', key);
      guard();
      if (provider === 'claude') await this.claude.configure({ enabled: true });
    });
  }

  async chooseExecutable(provider: ProviderId, executable: string) {
    this.cancelMasking(provider);
    await this.loaded;
    if (provider === 'claude') await this.claude.configure({ executable });
    else {
      const previous = this.codexExecutable;
      this.codexExecutable = executable;
      try {
        await this.save();
      } catch (error) {
        this.codexExecutable = previous;
        throw error;
      }
      this.codex.useExecutable(executable);
    }
  }

  cancelTools(chatId: string) {
    this.linear?.cancelChat(chatId);
    this.zendesk?.cancelChat(chatId);
    this.connections?.cancelChat(chatId);
  }
  caseForChat(chatId: string) {
    return this.cases?.caseForChat(chatId);
  }

  cancelMasking(provider?: ProviderId) {
    this.documents.cancel(provider);
  }
  draftDocument(
    kind: 'resolution' | 'playbook',
    data: unknown,
    selection: ModelSelection,
    signal: AbortSignal,
  ) {
    return this.documents.draftDocument(kind, data, selection, signal);
  }
  open(options: ChatOptions = {}, chatId?: string): ChatSession {
    const accountContext = this.accountContext,
      originGeneration = accountContext?.generation(),
      contextAbort = new AbortController();
    const cases = this.cases,
      updated = this.caseUpdated,
      originContext = cases?.context();
    let currentTurn:
      | { controller: AbortController; signal: AbortSignal; userText: string }
      | undefined;
    let selectedCapability: string | undefined;
    const check = () => {
      contextAbort.signal.throwIfAborted();
      if (accountContext && originGeneration !== accountContext.generation())
        throw Error('chat-closed');
    };
    const guard = async (capability: string) => {
      check();
      if (accountContext && !(await accountContext.canUse(capability)))
        throw Error('account-access');
      check();
    };
    const secured = (capability: string, agent: AgentTools): AgentTools => ({
      tools: agent.tools,
      call: async (name, args, signal) => {
        await guard(capability);
        check();
        const current = AbortSignal.any([
          contextAbort.signal,
          ...(signal ? [signal] : []),
        ]);
        current.throwIfAborted();
        return agent.call(name, args, current);
      },
    });
    let session: ChatSession | undefined;
    const connections: AgentConnection[] = [];
    const connectors = [
      { name: 'linear' as const, service: this.linear },
      { name: 'zendesk' as const, service: this.zendesk },
    ];
    let closed = false;
    const load = async () => {
      await this.loaded;
      if (session) return session;
      const catalog = await this.settings();
      const selected = options.selection ?? catalog.selected;
      selectedCapability = `model:${selected.provider}`;
      await guard(selectedCapability);
      const model = catalog.models.find(
        (item) =>
          item.provider === selected.provider && item.model === selected.model,
      );
      if (
        !model ||
        (options.effort && !model.efforts?.includes(options.effort))
      )
        throw Error('invalid-model');
      if (chatId) {
        try {
          // The session (and these tools) outlive one turn, so read the
          // active turn at call time instead of capturing the first one.
          const turnSignal = () => {
            if (!currentTurn) throw Error('case-turn-ended');
            return currentTurn.signal;
          };
          if (cases && originContext && currentTurn) {
            const resolution = this.resolution;
            const agent = caseAgent(
              cases,
              chatId,
              {
                context: originContext,
                selection: selected,
                get signal() {
                  return turnSignal();
                },
                guard: () => {
                  check();
                  turnSignal().throwIfAborted();
                },
                committed: (update) => updated?.(chatId, update),
              },
              resolution && {
                resolve: resolution.resolve,
                offer: (draft) =>
                  resolution.chats.offerResolutionReview(chatId, draft),
              },
            );
            if (agent)
              connections.push(
                await connectorAgent(
                  'supahelp-case',
                  secured(selectedCapability, agent),
                ),
              );
          }
          if (this.playbooks && originContext && currentTurn) {
            const agent = playbookAgent(
              this.playbooks,
              this.attachedPlaybooks.get(chatId) ?? [],
              {
                context: originContext,
                selection: selected,
                get signal() {
                  return turnSignal();
                },
                guard: check,
              },
              this.playbookChats && {
                focus: () => this.playbookChats?.playbookFocus(chatId),
                caseId: () => cases?.caseForChat(chatId),
                userText: () => currentTurn?.userText ?? '',
                offer: (action) =>
                  this.playbookChats!.offerPlaybookAction(chatId, action),
              },
            );
            if (agent)
              connections.push(
                await connectorAgent(
                  'supahelp-playbooks',
                  secured(selectedCapability, agent),
                ),
              );
          }
          for (const connector of connectors) {
            if (
              accountContext &&
              !(await accountContext.canUse(connector.name))
            )
              continue;
            const agent = await connector.service?.agent(chatId);
            if (agent)
              connections.push(
                await connectorAgent(
                  connector.name,
                  secured(connector.name, agent),
                ),
              );
          }
          for (const connection of (await this.connections?.agents(chatId)) ??
            []) {
            if (
              accountContext &&
              !(await accountContext.canUse(`catalog:${connection.id}`))
            )
              continue;
            connections.push(
              await connectorAgent(
                connection.name,
                secured(`catalog:${connection.id}`, connection.agent),
              ),
            );
          }
        } catch (error) {
          connections.forEach((connection) => connection.close());
          throw error;
        }
      }
      await guard(selectedCapability);
      check();
      if (closed) throw Error('chat-closed');
      session ??=
        selected?.provider === 'chatgpt'
          ? this.codex.open(selected.model, options, connections)
          : this.claude.open(
              selected.model,
              options,
              connections,
              undefined,
              chatId && this.playbookChats
                ? (request) =>
                    this.playbookChats!.requestFileApproval(chatId, request)
                : undefined,
            );
      if (closed) {
        session.close();
        connections.forEach((connection) => connection.close());
      }
      return session;
    };
    const catalogConnections = this.connections;
    return {
      get provider() {
        return session?.provider;
      },
      async *reply(text, signal, files, userText = text) {
        if (signal.aborted) return;
        if (closed) throw Error('chat-closed');
        const controller = new AbortController();
        currentTurn = {
          controller,
          userText,
          signal: AbortSignal.any([
            signal,
            controller.signal,
            contextAbort.signal,
          ]),
        };
        const turn = currentTurn;
        const active = await load();
        if (selectedCapability) await guard(selectedCapability);
        check();
        if (signal.aborted) return;
        if (closed) throw Error('chat-closed');
        if (chatId)
          connectors.forEach((connector) =>
            connector.service?.resumeChat(chatId),
          );
        if (chatId) catalogConnections?.resumeChat(chatId);
        try {
          yield* active.reply(text, turn.signal, files);
        } finally {
          turn.controller.abort();
          if (chatId) catalogConnections?.cancelChat(chatId);
          if (chatId)
            connectors.forEach((connector) =>
              connector.service?.cancelChat(chatId),
            );
        }
      },
      close() {
        contextAbort.abort();
        currentTurn?.controller.abort();
        if (chatId) catalogConnections?.cancelChat(chatId);
        closed = true;
        session?.close();
        connections.forEach((connection) => connection.close());
        if (chatId)
          connectors.forEach((connector) =>
            connector.service?.cancelChat(chatId),
          );
      },
    };
  }

  resetWorkspace() {
    this.close();
    this.attachedPlaybooks.clear();
  }

  close(keepModelLogin = false) {
    this.cancelMasking();
    this.claude.close?.();
    this.codex.close(keepModelLogin);
  }
}
