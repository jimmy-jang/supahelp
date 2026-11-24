import type { BrowserWindow, IpcMain } from 'electron';
import type { ApiSpecRequest, CatalogSetup } from '../../../contracts/catalog';
import type { Reply } from '../../../contracts/chat';
import { loadApiSpec } from '../../integrations/connection-api/api-spec.ts';
import { ProviderError } from '../../integrations/connection-oauth.ts';
import { OAuthBrokerError } from '../../integrations/oauth-broker.ts';
import { isTrustedSender } from '../../ipc/trusted-sender.ts';
import type { ChatService } from '../chat/service';
import type { Connections } from './service';

export function registerConnectionsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | undefined,
  location: string,
  connections: Connections,
  chats: ChatService,
) {
  const handle = (
    channel: string,
    run: (input: Record<string, unknown>, guard?: () => void) => unknown,
    limit = 100000,
  ) =>
    ipc.handle(
      channel,
      async (event, input, guard): Promise<Reply<unknown>> => {
        if (!isTrustedSender(event, getWindow()?.webContents, location))
          return { ok: false, error: 'This window cannot access connections.' };
        try {
          if (
            input !== undefined &&
            (!input ||
              typeof input !== 'object' ||
              Array.isArray(input) ||
              JSON.stringify(input).length > limit)
          )
            throw Error('Invalid input.');
          return { ok: true, value: await run(input ?? {}, guard) };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof OAuthBrokerError ||
              error instanceof ProviderError
                ? error.message
                : 'The connection request failed. Check your setup and the action status before trying again.',
          };
        }
      },
    );
  const id = (input: Record<string, unknown>) => {
    if (typeof input.id !== 'string' || input.id.length > 100)
      throw Error('Invalid connection.');
    return input.id;
  };
  handle('connections:status', () => connections.status());
  handle('connections:guide', (input) => connections.guide(id(input)));
  handle('connections:connect', async (input, guard) => {
    id(input);
    chats.refreshTools();
    try {
      return await connections.connect(input as CatalogSetup, guard);
    } finally {
      chats.refreshTools();
    }
  });
  handle(
    'connections:api-spec',
    (input) => loadApiSpec(input as unknown as ApiSpecRequest),
    2_100_000,
  );
  handle('connections:test-read', (input) => {
    if (
      typeof input.tool !== 'string' ||
      !input.args ||
      typeof input.args !== 'object' ||
      Array.isArray(input.args)
    )
      throw Error('Invalid test request.');
    return connections.testRead(
      id(input),
      input.tool,
      input.args as Record<string, unknown>,
    );
  });
  handle('connections:disconnect', async (input, guard) => {
    chats.refreshTools();
    await connections.disconnect(id(input), guard);
    chats.refreshTools();
  });
  handle('connections:remove', async (input, guard) => {
    chats.refreshTools();
    await connections.remove(id(input), guard);
    chats.refreshTools();
  });
  handle('connections:finish', (input, guard) => {
    if (typeof input.url !== 'string') throw Error('Invalid return.');
    return connections.finish(id(input), input.url, guard);
  });
  handle('connections:review-reads', async (input, guard) => {
    if (
      !Array.isArray(input.tools) ||
      input.tools.some(
        (tool) =>
          !tool ||
          typeof tool.name !== 'string' ||
          typeof tool.fingerprint !== 'string',
      )
    )
      throw Error('Invalid review.');
    chats.refreshTools();
    await connections.reviewReads(id(input), input.tools, guard);
    chats.refreshTools();
  });
  handle('connections:decide', (input) => {
    if (
      typeof input.action !== 'string' ||
      !['approve', 'deny', 'checked'].includes(String(input.decision))
    )
      throw Error('Invalid decision.');
    return connections.decide(
      id(input),
      input.action,
      input.decision as 'approve' | 'deny' | 'checked',
    );
  });
}
