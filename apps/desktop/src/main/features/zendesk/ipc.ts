import type { BrowserWindow, IpcMain } from 'electron';
import type { Reply } from '../../../contracts/chat';
import { isTrustedSender } from '../../ipc/trusted-sender.ts';
import type { ChatService } from '../chat/service';
import type { ZendeskConnector } from './service';
import { zendeskSetup } from './validation.ts';

export function registerZendeskIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | undefined,
  location: string,
  zendesk: ZendeskConnector,
  chats: ChatService,
) {
  const handle = (
    channel: string,
    run: (input: unknown, guard?: () => void) => unknown,
  ) =>
    ipc.handle(
      channel,
      async (event, input, guard): Promise<Reply<unknown>> => {
        if (!isTrustedSender(event, getWindow()?.webContents, location))
          return { ok: false, error: 'This window cannot access connections.' };
        try {
          return { ok: true, value: await run(input, guard) };
        } catch {
          return {
            ok: false,
            error:
              'Zendesk could not complete this request. Check its connection and action status.',
          };
        }
      },
    );
  handle('zendesk:status', () => zendesk.status());
  handle('zendesk:connect', (input, guard) => {
    const value = zendeskSetup(input);
    chats.refreshTools();
    return zendesk.connect(value, guard);
  });
  handle('zendesk:disconnect', async (_, guard) => {
    chats.refreshTools();
    await zendesk.disconnect(guard);
  });
  handle('zendesk:decide', (input) => {
    const value = input as { id?: unknown; decision?: unknown } | null;
    if (
      !value ||
      typeof value.id !== 'string' ||
      value.id.length > 100 ||
      !['approve', 'deny', 'checked'].includes(String(value.decision))
    )
      throw Error('Invalid approval.');
    return zendesk.decide(
      value.id,
      value.decision as 'approve' | 'deny' | 'checked',
    );
  });
}
