import type { BrowserWindow, IpcMain } from 'electron';
import type { Reply } from '../../../contracts/chat';
import { isTrustedSender } from '../../ipc/trusted-sender.ts';
import type { ChatService } from '../chat/service';
import type { LinearConnector } from './service';
import { linearAccess } from './validation.ts';

export function registerLinearIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | undefined,
  location: string,
  linear: LinearConnector,
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
              'Linear could not complete this request. Check the connection and action status.',
          };
        }
      },
    );
  handle('linear:status', () => linear.status());
  handle('linear:connect', async (input, guard) => {
    const access = linearAccess(input);
    chats.refreshTools();
    return linear.connect(access, guard);
  });
  handle('linear:disconnect', async (_, guard) => {
    chats.refreshTools();
    await linear.disconnect(guard);
  });
  handle('linear:decide', (input) => {
    const value = input as { id?: unknown; decision?: unknown } | null;
    if (
      !value ||
      typeof value.id !== 'string' ||
      value.id.length > 100 ||
      !['approve', 'deny', 'checked'].includes(String(value.decision))
    )
      throw Error('Invalid approval.');
    return linear.decide(
      value.id,
      value.decision as 'approve' | 'deny' | 'checked',
    );
  });
}
