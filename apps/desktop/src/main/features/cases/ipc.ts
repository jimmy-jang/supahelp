import type { BrowserWindow, IpcMain } from 'electron';
import type { ContextStamp } from '../../../contracts/accounts';
import type { CaseEditRequest } from '../../../contracts/cases';
import type { ModelSelection, Reply } from '../../../contracts/chat';
import { checkedTitle, type TitleEdit } from '../../../contracts/titles.ts';
import { isTrustedSender } from '../../ipc/trusted-sender.ts';
import type { ChatService } from '../chat/service';
import { publicCaseError } from './errors.ts';
import { storedCaseMarkdown } from './markdown.ts';
import type { CaseService } from './service';
import { checkedCaseEntry } from './service.ts';

// Named case operations validate both the trusted frame and the originating context.
export function registerCasesIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | undefined,
  location: string,
  cases: CaseService,
  chats: ChatService,
  selection: () => Promise<ModelSelection>,
  removalBlocked?: (caseId: string, chatIds: string[]) => boolean,
) {
  let editing:
    | { requestId: string; context: ContextStamp; controller: AbortController }
    | undefined;
  const handle = (channel: string, run: (input: unknown) => unknown) =>
    ipc.handle(channel, async (event, input): Promise<Reply<unknown>> => {
      if (!isTrustedSender(event, getWindow()?.webContents, location))
        return { ok: false, error: 'This window cannot access cases.' };
      try {
        return { ok: true, value: await run(input) };
      } catch (error) {
        return {
          ok: false,
          error: publicCaseError(error),
        };
      }
    });
  const input = (value: unknown, keys: string[]) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))
    )
      throw Error('invalid-entry');
    const args = value as Record<string, unknown>;
    cases.assertContext(args.context as ContextStamp);
    for (const key of keys.filter((key) => key !== 'context'))
      if (
        typeof args[key] !== 'string' ||
        !/^[a-zA-Z0-9-]{1,100}$/.test(args[key] as string)
      )
        throw Error('invalid-entry');
    return args as {
      context: ContextStamp;
      chatId: string;
      caseId: string;
      changeId: string;
      requestId: string;
    };
  };
  const operation = (context: ContextStamp) => ({
    context,
    signal: cases.operationSignal(),
  });
  handle('cases:people', (value) => {
    const { context } = input(value, ['context']);
    return cases.people(operation(context));
  });
  handle('cases:assign', (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        'action,caseId,context,ownerRevision,recipientId'
    )
      throw Error('invalid-entry');
    const args = value as import('../../../contracts/cases').CaseAssignment;
    if (
      typeof args.caseId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(args.caseId)
    )
      throw Error('invalid-entry');
    return cases.assign(
      args.caseId,
      args.action,
      args.recipientId,
      args.ownerRevision,
      operation(args.context),
    );
  });
  handle('cases:status', (value) => {
    const args = input(value, ['caseId', 'context', 'status']);
    cases.setStatus(
      args.caseId,
      (value as { status: string }).status,
      operation(args.context),
    );
  });
  handle('cases:remove', (value) => {
    const { caseId, context } = input(value, ['caseId', 'context']);
    const op = operation(context);
    const { chatIds } = cases.read(caseId, op);
    if (removalBlocked?.(caseId, chatIds)) throw Error('remove-actions');
    if (
      chats
        .snapshot()
        .chats.some(
          (chat) => chatIds.includes(chat.id) && chat.status !== 'idle',
        )
    )
      throw Error('remove-running');
    cases.remove(caseId, op);
    for (const id of chatIds) chats.refreshTools(id);
  });
  handle('cases:rename', async (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        'caseId,context,expectedTitle,title'
    )
      throw Error('invalid-title');
    const args = value as TitleEdit & { caseId: string; context: ContextStamp };
    if (
      typeof args.caseId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(args.caseId) ||
      typeof args.expectedTitle !== 'string'
    )
      throw Error('invalid-title');
    const title = checkedTitle(args.title),
      op = operation(args.context);
    if (cases.read(args.caseId, op).title !== args.expectedTitle)
      throw Error('case-changed');
    return cases.rename(args.caseId, title, args.expectedTitle, {
      ...op,
      selection: await selection(),
    });
  });
  handle('cases:edit', async (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('invalid-entry');
    const args = value as CaseEditRequest;
    const keys = [
      'context',
      'caseId',
      'requestId',
      'action',
      ...(args.action === 'add'
        ? ['value']
        : args.action === 'update'
          ? ['entryId', 'version', 'value']
          : args.action === 'remove'
            ? ['entryId', 'version']
            : []),
    ];
    if (
      !['add', 'update', 'remove'].includes(args.action) ||
      Object.keys(args).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(args, key))
    )
      throw Error('invalid-entry');
    cases.assertContext(args.context);
    if (
      typeof args.caseId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(args.caseId) ||
      typeof args.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        args.requestId,
      )
    )
      throw Error('invalid-entry');
    if (
      args.action !== 'add' &&
      (typeof args.entryId !== 'string' ||
        !/^[a-zA-Z0-9-]{1,100}$/.test(args.entryId) ||
        !Number.isSafeInteger(args.version) ||
        args.version < 1)
    )
      throw Error('invalid-entry');
    if (args.action !== 'remove') checkedCaseEntry(args.value);
    const op = operation(args.context);
    const record = cases.read(args.caseId, op);
    const before =
      args.action === 'add'
        ? undefined
        : record.entries.find((e) => e.id === args.entryId);
    if (args.action !== 'add' && !before) throw Error('unknown-entry');
    if (
      before?.systemOwned ||
      before?.section === 'resolution' ||
      (args.action !== 'remove' && args.value.section === 'resolution')
    )
      throw Error('reserved-field');
    if (
      editing &&
      !editing.controller.signal.aborted &&
      !cases.operationSignal().aborted &&
      JSON.stringify(editing.context) === JSON.stringify(args.context)
    )
      throw Error('case-edit-busy');
    const current = {
      requestId: args.requestId,
      context: args.context,
      controller: new AbortController(),
    };
    editing?.controller.abort();
    editing = current;
    try {
      return await cases.edit(
        args.caseId,
        args.action === 'add' ? undefined : args.entryId,
        args.action === 'remove' ? undefined : args.value,
        {
          ...op,
          humanEditRequestId: args.requestId,
          signal: AbortSignal.any([op.signal, current.controller.signal]),
          selection: args.action === 'remove' ? undefined : await selection(),
        },
        args.action === 'add' ? undefined : args.version,
      );
    } catch (error) {
      if (current.controller.signal.aborted || op.signal.aborted)
        throw Error('case-edit-canceled');
      throw error;
    } finally {
      if (editing === current) editing = undefined;
    }
  });
  handle('cases:cancelEdit', (value) => {
    const args = input(value, ['context', 'requestId']);

    if (
      editing?.requestId === args.requestId &&
      JSON.stringify(editing.context) === JSON.stringify(args.context)
    )
      editing.controller.abort();
  });
  handle('cases:list', async (value) => {
    const args = input(value, ['context']);

    await cases.prepare(operation(args.context));
    return cases.snapshot();
  });
  handle('cases:customers:list', async (value) => {
    const { context } = input(value, ['context']);
    if (context.context.kind !== 'personal')
      throw Error('customer-personal-only');
    const op = operation(context);
    await cases.prepare(op);
    return cases.customers(op);
  });
  handle('cases:create', async (value) => {
    const args = input(value, ['chatId', 'context']),
      chatId = args.chatId;
    // Only a real, open chat; preview ids are never in the chat service.
    const chat =
      typeof chatId === 'string' && chatId.length <= 100
        ? chats.snapshot().chats.find((c) => c.id === chatId)
        : undefined;
    if (!chat) throw Error('unknown-chat');
    const guard = () => {
      if (
        chats.snapshot().chats.find((c) => c.id === chat.id)?.status !== 'idle'
      )
        throw Error('case-turn-ended');
    };
    guard();
    const id = await cases.create(chat, {
      ...operation(args.context),
      selection: chat.options?.selection ?? (await selection()),
      guard,
    });
    chats.refreshTools(chat.id);
    return id;
  });
  handle('cases:undo', (value) => {
    const args = input(value, ['caseId', 'changeId', 'context']);
    const result = cases.undo(
      args.caseId,
      args.changeId,
      operation(args.context),
    );
    if ('error' in result) return Promise.reject(Error('case-changed'));
    chats.caseUndone(args.caseId, args.changeId);
  });
  handle('cases:markdown', (value) => {
    const args = input(value, ['caseId', 'context']);
    if (args.context.context.kind === 'team') cases.team!.sync.exportGuard();
    return storedCaseMarkdown(cases.read(args.caseId, operation(args.context)));
  });
}
