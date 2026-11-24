import type { BrowserWindow, IpcMain } from 'electron';
import type { Reply, SendMessage } from '../../../contracts/chat';
import type { TitleEdit } from '../../../contracts/titles';
import type { ClaudeCode } from '../../integrations/claude-code';
import { isTrustedSender } from '../../ipc/trusted-sender.ts';
import type { ChatResources } from '../../platform/chat-resources';
import { isClaudeModel } from '../../platform/claude-settings.ts';
import { isModelSelection, isProvider } from '../../platform/model-settings.ts';
import type { ChatModels } from './models';
import type { ChatService } from './service';
import { publicChatError } from './service.ts';
import { providerApiKey } from './validation.ts';

export function registerChatIpc({
  ipcMain,
  getWindow,
  location,
  provider,
  chats,
  chooseExecutable,
  openInstall,
  models,
  openExternal,
  resources,
  choosePaths,
  removalBlocked,
}: {
  ipcMain: Pick<IpcMain, 'handle'>;
  getWindow: () => BrowserWindow | undefined;
  location: string;
  provider: ClaudeCode;
  chats: ChatService;
  chooseExecutable: (
    provider?: 'claude' | 'chatgpt',
  ) => Promise<string | undefined>;
  openInstall: (provider?: 'claude' | 'chatgpt') => Promise<void>;
  models: ChatModels;
  resources: ChatResources;
  choosePaths: (kind: 'project' | 'files') => Promise<string[]>;
  openExternal: (url: string) => Promise<void>;
  removalBlocked?: (chatId: string) => boolean;
}) {
  const handle = (
    name: string,
    run: (input: unknown, guard: () => void) => unknown,
  ) => {
    ipcMain.handle(
      name,
      async (event, input, guard = () => {}): Promise<Reply<unknown>> => {
        if (!isTrustedSender(event, getWindow()?.webContents, location))
          return { ok: false, error: 'This window cannot access chat.' };
        try {
          return {
            ok: true,
            value: await run(
              input && typeof input === 'object' && 'input' in input
                ? input.input
                : input,
              guard,
            ),
          };
        } catch (error) {
          return { ok: false, error: publicChatError(error) };
        }
      },
    );
  };
  handle('claude:status', () => provider.status());
  handle('models:settings', () => models.settings());
  handle('models:connect', (id) => {
    if (!isProvider(id)) throw Error('invalid-model');
    chats.refreshTools();
    return models.connect(id, openExternal);
  });
  handle('models:api-key', async (input) => {
    const { provider: id, key } = providerApiKey(input);
    chats.refreshTools();
    await models.setApiKey(id, key);
  });
  handle('models:disconnect', async (id) => {
    if (!isProvider(id)) throw Error('invalid-model');
    chats.refreshTools();
    await models.disconnect(id);
  });
  handle('models:choose', async (id, guard) => {
    if (!isProvider(id)) throw Error('invalid-model');
    const executable = await chooseExecutable(id);
    guard();
    if (executable) {
      chats.refreshTools();
      await models.chooseExecutable(id, executable);
    }
  });
  handle('models:install', (id) => {
    if (!isProvider(id)) throw Error('invalid-model');
    return openInstall(id);
  });
  handle('models:select', (selection, guard) => {
    if (!isModelSelection(selection)) throw Error('invalid-model');
    return models.select(selection, guard);
  });
  handle('claude:sign-in', () => provider.signIn());
  handle('claude:install', () => openInstall());
  handle('claude:choose', async (_input, guard) => {
    const executable = await chooseExecutable();
    guard();
    return executable ? provider.configure({ executable }) : provider.status();
  });
  handle('claude:model', (model) => {
    if (!isClaudeModel(model)) throw Error('invalid-message');
    return provider.configure({ model });
  });
  handle('chat:list', () => chats.snapshot());
  handle('chat:remove', (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'chatId,context'
    )
      throw Error('unknown-chat');
    const { chatId } = value as { chatId: unknown };
    if (typeof chatId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(chatId))
      throw Error('unknown-chat');
    if (removalBlocked?.(chatId)) throw Error('remove-actions');
    chats.remove(chatId);
    models.attachPlaybooks(chatId, []);
  });
  handle('chat:rename', (value) => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !==
        'chatId,context,expectedTitle,title'
    )
      throw Error('invalid-title');
    const args = value as TitleEdit & { chatId: string };
    if (
      typeof args.chatId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(args.chatId) ||
      typeof args.expectedTitle !== 'string' ||
      args.expectedTitle.length > 120
    )
      throw Error('invalid-title');
    return chats.rename(args.chatId, args.title, args.expectedTitle);
  });
  handle('chat:projects', (_input, guard) => resources.list(guard));
  handle('chat:choose-project', async (_input, guard) => {
    const paths = await choosePaths('project');
    guard();
    return paths[0] ? resources.connect(paths[0], guard) : undefined;
  });
  handle('chat:discard-attachments', (ids) => {
    if (
      !Array.isArray(ids) ||
      ids.length > 5 ||
      ids.some((id) => typeof id !== 'string')
    )
      throw Error('invalid-attachment');
    resources.consume(ids);
  });
  handle('chat:attachments', async (_input, guard) => {
    const paths = await choosePaths('files');
    guard();
    return resources.attach(paths, guard);
  });
  handle('chat:send', async (input, guard) => {
    if (!input || typeof input !== 'object') throw Error('invalid-message');
    const message = input as SendMessage;
    const files = resources.resolve(message.attachments ?? []);
    if (message.options?.project !== undefined) {
      if (typeof message.options.project !== 'string')
        throw Error('invalid-project');
      await resources.validateProject(message.options.project);
    }
    guard();
    const id = chats.send(message, files);
    resources.consume(message.attachments ?? []);
    return id;
  });
  handle('chat:stop', (id) => {
    if (typeof id !== 'string' || id.length > 100) throw Error('unknown-chat');
    chats.stop(id);
  });
  handle('chat:fileApproval', (input) => {
    const { chatId, requestId, approved } = (input ?? {}) as Record<
      string,
      unknown
    >;
    if (
      typeof chatId !== 'string' ||
      chatId.length > 100 ||
      typeof requestId !== 'string' ||
      requestId.length > 100 ||
      typeof approved !== 'boolean'
    )
      throw Error('approval-ended');
    chats.answerFileApproval(chatId, requestId, approved);
  });
}
