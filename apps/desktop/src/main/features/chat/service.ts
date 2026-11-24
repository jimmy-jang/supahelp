import { randomUUID } from 'node:crypto';
import type { CaseUpdate } from '../../../contracts/cases';
import type { PlaybookChatAction } from '../../../contracts/playbooks';
import type {
  ChatFile,
  ChatOptions,
  ChatSnapshot,
  Conversation,
  FileApproval,
  ProviderId,
  SendMessage,
} from '../../../contracts/chat';
import { checkedTitle } from '../../../contracts/titles.ts';
import type { ChatStore } from '../../platform/chat-store';

export type ChatOutput =
  | { type: 'text'; text: string }
  | { type: 'model'; model: string }
  | { type: 'step'; server: string; tool: string };

export type ChatSession = {
  readonly provider?: ProviderId;
  reply(
    text: string,
    signal: AbortSignal,
    files?: ChatFile[],
    userText?: string,
  ): AsyncIterable<ChatOutput>;
  close(): void;
};

const errors: Record<string, string> = {
  'model-busy': 'Wait for the current model connection change to finish.',
  'invalid-api-key': 'Enter a valid API key without spaces or line breaks.',
  'model-credentials':
    'Secure model credentials could not be read. Reconnect in Models settings.',
  'subscription-tests-disabled':
    'Subscription connections are disabled for automated tests.',
  'invalid-title': 'Use a title between 1 and 120 characters on one line.',
  'title-changed': 'This title changed. Cancel to load the current title.',
  'remove-actions':
    'Settle pending, running or uncertain actions before removing this chat.',
  'remove-running': 'Stop the reply before removing this chat.',
  'chat-storage':
    'Chat history could not be saved. Check available disk space and try again.',
  'invalid-options': 'Choose valid chat settings.',
  'invalid-project':
    'This project folder is unavailable. Choose another project.',
  'approval-ended': 'This edit request already ended.',
  'invalid-attachment': 'Choose up to five files, each no larger than 10 MB.',
  'unsupported-attachment':
    'Attach PNG, JPEG, GIF, WebP images or UTF-8 text files.',
  'attachment-limit': 'Restart Supahelp to clear unused attachments.',
  'invalid-message': 'Write a message between 1 and 12,000 characters.',
  'unsupported-command': 'Slash commands are not supported in chat.',
  'unknown-chat': 'This chat is no longer available. Start a new chat.',
  'chat-closed': 'This chat connection ended. Start a new chat to continue.',
  'account-access':
    'Connect this model provider for the current Supahelp account.',
  'reply-running':
    'Wait for the current reply to stop before sending another message.',
  'chat-limit': 'Start a new chat, or remove an unused chat to make room.',
  'session-limit':
    'Five chat sessions are already open. Close and reopen the window to clear them.',
  'claude-auth':
    'Claude authentication failed. Check your selected connection in Models settings.',
  'claude-config':
    'Another Claude authentication method is configured. Use your Claude subscription in Claude Code, then check again.',
  'claude-missing': 'Install Claude Code or choose its executable in Settings.',
  'claude-version':
    'Update Claude Code to version 2.1.318 or later, then check again.',
  'claude-isolation':
    'Claude loaded capabilities outside this chat’s permissions. This session was stopped.',
  'claude-limit':
    'Your Claude usage limit has been reached. Try again after it resets.',
  'claude-closed': 'This Claude session ended. Start a new chat to continue.',
  'claude-model':
    'This model is not available on your Claude account. Choose another model in Settings and start a new chat.',
  'codex-missing': 'Install Codex or choose its executable in Models settings.',
  'codex-auth':
    'OpenAI authentication failed. Check your selected connection in Models settings.',
  'codex-failure':
    'OpenAI could not finish this reply. Check your connection, balance and usage limits, then start a new chat.',
  'codex-isolation':
    'ChatGPT loaded capabilities outside this chat’s permissions. This session was stopped.',
  'invalid-model': 'Choose an available model in Models settings.',
};

export function publicChatError(error: unknown): string {
  return (
    (error instanceof Error &&
      Object.hasOwn(errors, error.message) &&
      errors[error.message]) ||
    'The reply could not finish. Your message and any partial reply are kept. Start a new chat to reconnect.'
  );
}

export class ChatService {
  private chats = new Map<string, Conversation>();
  private sessions = new Map<string, ChatSession>();
  private turns = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  private approvals = new Map<
    string,
    { request: FileApproval; settle(approved: boolean): void }[]
  >();
  private revision = 0;
  private publishTimer?: ReturnType<typeof setTimeout>;
  private dirty = new Set<Conversation>();
  private store?: Pick<ChatStore, 'list' | 'put' | 'remove'>;
  private provider: {
    open(options?: ChatOptions, chatId?: string): ChatSession;
    cancelTools?(chatId: string): void;
    caseForChat?(chatId: string): string | undefined;
    freshTools?(chatId: string): boolean;
  };
  private changed: (snapshot: ChatSnapshot) => void;

  constructor(
    provider: {
      open(options?: ChatOptions, chatId?: string): ChatSession;
      cancelTools?(chatId: string): void;
      caseForChat?(chatId: string): string | undefined;
      freshTools?(chatId: string): boolean;
    },
    changed: (snapshot: ChatSnapshot) => void,
    store?: Pick<ChatStore, 'list' | 'put' | 'remove'>,
  ) {
    this.provider = provider;
    this.changed = changed;
    this.store = store;
    this.restore(store);
  }

  private restore(store: ChatService['store']) {
    const chats = new Map<string, Conversation>();
    for (const record of store?.list<{ version: number; chat: Conversation }>(
      'chat/',
    ) ?? []) {
      if (
        record.version !== 1 ||
        !record.chat ||
        typeof record.chat.id !== 'string' ||
        !Array.isArray(record.chat.messages)
      )
        throw Error('chat-storage');
      const chat = structuredClone(record.chat);
      if (chat.status !== 'idle')
        chat.notice = 'Reply interrupted when Supahelp closed.';
      chat.status = 'idle';
      delete chat.step;
      delete chat.fileApproval;
      chats.set(chat.id, chat);
    }
    this.chats = chats;
  }

  async activate(store: ChatService['store']) {
    await this.close();
    this.publish();
    if (this.dirty.size) throw Error('chat-storage');
    this.restore(store);
    this.store = store;
    this.revision++;
  }

  snapshot(): ChatSnapshot {
    return structuredClone({
      revision: this.revision,
      chats: [...this.chats.values()].reverse(),
    });
  }

  rename(id: string, input: unknown, expectedTitle: unknown): string {
    const title = checkedTitle(input);
    const chat = this.chats.get(id);
    if (!chat) throw Error('unknown-chat');
    if (chat.title !== expectedTitle) throw Error('title-changed');
    chat.title = title;
    this.publish(chat);
    return title;
  }

  setPlaybooks(chatId: string, ids: string[]) {
    const chat = this.chats.get(chatId);
    if (!chat || chat.status !== 'idle') throw Error('reply-running');
    chat.playbookIds = [...ids];
    this.publish(chat);
  }

  remove(id: string) {
    const chat = this.chats.get(id);
    if (!chat) throw Error('unknown-chat');
    if (chat.status !== 'idle') throw Error('remove-running');
    try {
      this.store?.remove(`chat/${id}`);
    } catch {
      throw Error('chat-storage');
    }
    this.refreshTools(id);
    this.dirty.delete(chat);
    this.chats.delete(id);
    this.publish();
  }
  createLocalChat(title = 'Continue case', playbookId?: string) {
    if (this.chats.size >= 50) throw Error('chat-limit');
    const id = randomUUID();
    this.chats.set(id, {
      id,
      title,
      ...(playbookId ? { playbookId } : {}),
      messages: [],
      status: 'idle',
      model: '',
    });
    this.publish(this.chats.get(id));
    return id;
  }

  send(input: SendMessage, files: ChatFile[] = []): string {
    if (
      !input ||
      typeof input !== 'object' ||
      typeof input.text !== 'string' ||
      (!input.text.trim() && !files.length) ||
      input.text.length > 12000
    )
      throw Error('invalid-message');
    if (input.options !== undefined) {
      const value = input.options;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        (value.confirmation !== undefined &&
          !['ask', 'skip'].includes(value.confirmation)) ||
        (value.effort !== undefined &&
          !['low', 'medium', 'high', 'xhigh', 'max'].includes(value.effort)) ||
        (value.project !== undefined &&
          (typeof value.project !== 'string' || value.project.length > 4096)) ||
        (value.selection !== undefined &&
          (!value.selection ||
            !['claude', 'chatgpt'].includes(value.selection.provider) ||
            typeof value.selection.model !== 'string' ||
            !/^[a-zA-Z0-9._-]{1,120}$/.test(value.selection.model)))
      )
        throw Error('invalid-options');
    }
    if (input.text.trimStart().startsWith('/'))
      throw Error('unsupported-command');
    if (
      input.chatId !== undefined &&
      (typeof input.chatId !== 'string' || !this.chats.has(input.chatId))
    )
      throw Error('unknown-chat');
    if (!input.chatId && this.sessions.size >= 5) throw Error('session-limit');
    const id = input.chatId ?? randomUUID();
    if (this.turns.has(id)) throw Error('reply-running');
    const chat = this.chats.get(id) ?? {
      id,
      title: (input.text.trim() || files[0]?.name || 'New chat').slice(0, 48),
      messages: [],
      status: 'idle',
      model: 'Connecting…',
    };
    if (
      chat.messages.filter((message) => message.role !== 'case').length >= 100
    )
      throw Error('chat-limit');
    const options = input.options ?? chat.options;
    let session = this.sessions.get(id);
    const text = input.text.trim() ? input.text : '';
    let prompt = text || 'Please review the attached files.';
    if (session && JSON.stringify(options) !== JSON.stringify(chat.options)) {
      session.close();
      session = undefined;
    }
    if (!session && chat.messages.length) {
      // shortcut: only text history transfers; retain prior uploads when cross-model file context is needed.
      prompt = `Previous conversation (context only):\n${chat.messages
        .filter((message) => message.role !== 'case')
        .map((message) => `${message.role}: ${message.text}`)
        .join('\n')}\n\nCurrent user message:\n${prompt}`;
    }
    session ??= this.provider.open(options, id);
    if (options) chat.options = structuredClone(options);
    this.sessions.set(id, session);
    this.chats.set(id, chat);
    chat.messages.push(
      {
        role: 'user',
        text: text + files.map((file) => `\n[Attached: ${file.name}]`).join(''),
      },
      { role: 'assistant', text: '' },
    );
    chat.status = 'running';
    delete chat.error;
    delete chat.notice;
    const controller = new AbortController();
    // Reserve before the async iterator can publish or accept a second send.
    const turn = { controller, done: Promise.resolve() };
    this.turns.set(id, turn);
    this.publish(chat);
    turn.done = this.run(
      chat,
      session,
      controller,
      prompt,
      files,
      text,
    ).finally(() => {
      if (this.turns.get(id) === turn) this.turns.delete(id);
      // Copy: settle() removes entries from this queue.
      for (const pending of this.approvals.get(id)?.slice() ?? [])
        pending.settle(false);
      chat.status = 'idle';
      delete chat.step;
      if (this.provider.caseForChat?.(id) || this.provider.freshTools?.(id)) {
        session.close();
        if (this.sessions.get(id) === session) this.sessions.delete(id);
      }
      this.publish(chat);
    });
    return id;
  }

  private async run(
    chat: Conversation,
    session: ChatSession,
    controller: AbortController,
    prompt: string,
    files: ChatFile[],
    userText: string,
  ) {
    const response = chat.messages.at(-1)!;
    try {
      for await (const output of session.reply(
        prompt,
        controller.signal,
        files,
        userText,
      )) {
        if (controller.signal.aborted) break;
        if (output.type === 'model') chat.model = output.model;
        else if (output.type === 'step')
          chat.step = { server: output.server, tool: output.tool };
        else {
          if (response.text.length + output.text.length > 128000)
            throw Error('chat-limit');
          response.text += output.text;
          delete chat.step;
        }
        this.schedulePublish(chat);
      }
    } catch (error) {
      session.close();
      if (!controller.signal.aborted) chat.error = publicChatError(error);
    } finally {
      if (controller.signal.aborted) chat.notice = 'Reply stopped.';
    }
  }

  stop(id: string) {
    const chat = this.chats.get(id);
    if (!chat) throw Error('unknown-chat');
    const turn = this.turns.get(id);
    if (turn) {
      chat.status = 'stopping';
      turn.controller.abort();
      this.provider.cancelTools?.(id);
      this.publish(chat);
    }
  }

  caseUpdated(chatId: string, update: CaseUpdate, duringTurn = true) {
    const chat = this.chats.get(chatId),
      turn = this.turns.get(chatId);
    if (
      !chat ||
      (duringTurn && (!turn || turn.controller.signal.aborted)) ||
      chat.messages.some(
        (message) =>
          message.role === 'case' && message.changeId === update.changeId,
      )
    )
      return;
    chat.messages.push({ role: 'case', ...update });
    this.publish(chat);
  }

  teamCase(chatId: string) {
    return this.chats.get(chatId)?.teamCaseId;
  }

  linkTeamCase(chatId: string, caseId: string | undefined) {
    const chat = this.chats.get(chatId);
    if (!chat) throw Error('unknown-chat');
    if (caseId) chat.teamCaseId = caseId;
    else delete chat.teamCaseId;
    this.publish(chat);
  }

  teamCaseChats(caseId: string) {
    return [...this.chats.values()]
      .filter((chat) => chat.teamCaseId === caseId)
      .map((chat) => chat.id);
  }

  playbookFocus(chatId: string) {
    const chat = this.chats.get(chatId);
    return chat?.playbookFocusId ?? chat?.playbookId;
  }

  offerResolutionReview(
    chatId: string,
    review: NonNullable<Conversation['resolutionReview']>,
  ) {
    const chat = this.chats.get(chatId);
    const turn = this.turns.get(chatId);
    if (!chat || !turn || turn.controller.signal.aborted)
      throw Error('case-turn-ended');
    chat.resolutionReview = review;
    this.publish(chat);
  }

  dismissResolutionReview(chatId: string, id: string, version: number) {
    const chat = this.chats.get(chatId);
    if (
      chat?.resolutionReview?.id !== id ||
      chat.resolutionReview.version !== version
    )
      return;
    delete chat.resolutionReview;
    this.publish(chat);
  }

  /** Waits for the user to approve a project file change; false if the turn ends first. */
  requestFileApproval(
    chatId: string,
    request: Omit<FileApproval, 'requestId'>,
  ): Promise<boolean> {
    const chat = this.chats.get(chatId),
      turn = this.turns.get(chatId);
    if (!chat || !turn || turn.controller.signal.aborted)
      return Promise.resolve(false);
    const signal = turn.controller.signal;
    const entry = {
      request: { requestId: randomUUID(), ...request },
      settle(_approved: boolean) {},
    };
    const queue = this.approvals.get(chatId) ?? [];
    this.approvals.set(chatId, queue);
    return new Promise<boolean>((resolve) => {
      const abort = () => entry.settle(false);
      entry.settle = (approved) => {
        const index = queue.indexOf(entry);
        if (index === -1) return;
        queue.splice(index, 1);
        if (!queue.length) this.approvals.delete(chatId);
        signal.removeEventListener('abort', abort);
        if (queue[0]) chat.fileApproval = queue[0].request;
        else delete chat.fileApproval;
        this.publish(chat);
        resolve(approved);
      };
      signal.addEventListener('abort', abort, { once: true });
      queue.push(entry);
      chat.fileApproval ??= entry.request;
      this.publish(chat);
    });
  }

  answerFileApproval(chatId: string, requestId: string, approved: boolean) {
    const pending = this.approvals
      .get(chatId)
      ?.find((entry) => entry.request.requestId === requestId);
    if (!pending) throw Error('approval-ended');
    pending.settle(approved);
  }

  offerPlaybookAction(chatId: string, action: PlaybookChatAction) {
    const chat = this.chats.get(chatId),
      turn = this.turns.get(chatId);
    if (!chat || !turn || turn.controller.signal.aborted)
      throw Error('case-turn-ended');
    chat.playbookAction = action;
    if (action.kind === 'saved') chat.playbookFocusId = action.playbookId;
    this.publish(chat);
  }

  getPlaybookAction(chatId: string, requestId: string) {
    const chat = this.chats.get(chatId),
      action = chat?.playbookAction;
    if (
      chat?.status !== 'idle' ||
      !action ||
      action.completed ||
      action.requestId !== requestId
    )
      throw Error('case-changed');
    return action;
  }

  finishPlaybookAction(chatId: string, requestId: string, approved: boolean) {
    const chat = this.chats.get(chatId);
    const action = chat?.playbookAction;
    if (!chat || !action || action.requestId !== requestId) return;
    if (approved && action.kind !== 'open' && action.kind !== 'saved') {
      action.completed = true;
      if (
        action.kind === 'delete' &&
        chat.playbookFocusId === action.playbookId
      )
        delete chat.playbookFocusId;
    } else {
      if (approved) chat.playbookFocusId = action.playbookId;
      delete chat.playbookAction;
    }
    this.publish(chat);
  }

  caseUndone(caseId: string, changeId: string) {
    for (const chat of this.chats.values())
      for (const message of chat.messages)
        if (
          message.role === 'case' &&
          message.caseId === caseId &&
          message.changeId === changeId
        ) {
          message.note = 'Undone';
          this.dirty.add(chat);
        }
    this.publish();
  }

  disconnect(provider: ProviderId) {
    for (const [id, session] of this.sessions) {
      if (session.provider !== provider) continue;
      this.stop(id);
      session.close();
    }
  }

  refreshTools(chatId?: string) {
    for (const [id, session] of this.sessions) {
      if (chatId && chatId !== id) continue;
      this.stop(id);
      session.close();
      this.sessions.delete(id);
    }
  }

  async close() {
    const turns = this.turns;
    const sessions = this.sessions;
    this.turns = new Map();
    this.sessions = new Map();
    for (const turn of turns.values()) turn.controller.abort();
    for (const session of sessions.values()) session.close();
    this.publish();
    await Promise.allSettled([...turns.values()].map((turn) => turn.done));
  }

  private schedulePublish(chat: Conversation) {
    this.dirty.add(chat);
    this.publishTimer ??= setTimeout(() => this.publish(), 40);
  }

  private publish(chat?: Conversation) {
    clearTimeout(this.publishTimer);
    this.publishTimer = undefined;
    if (chat) this.dirty.add(chat);
    for (const value of this.dirty) {
      try {
        this.store?.put(`chat/${value.id}`, { version: 1, chat: value });
        this.dirty.delete(value);
      } catch {
        value.error = publicChatError(Error('chat-storage'));
      }
    }
    this.revision++;
    this.changed(this.snapshot());
  }
}
