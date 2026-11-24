import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { isTrustedSender } from './ipc/trusted-sender.ts';

export function windowConfirmation(
  ipc: Pick<IpcMain, 'on' | 'removeListener'>,
  window: BrowserWindow,
  location: string,
) {
  const contents = window.webContents;
  let pending: { id: string; resolve: (accepted: boolean) => void } | undefined;
  const finish = (accepted: boolean) => {
    const request = pending;
    pending = undefined;
    request?.resolve(accepted);
  };
  const receive = (event: IpcMainEvent, input: unknown) => {
    if (
      !isTrustedSender(event, contents, location) ||
      !pending ||
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input)
    )
      return;
    const reply = input as Record<string, unknown>;
    if (
      Object.keys(reply).length !== 2 ||
      reply.id !== pending.id ||
      typeof reply.accepted !== 'boolean'
    )
      return;
    finish(reply.accepted);
  };
  const navigated = (
    _event: unknown,
    _url: string,
    inPlace: boolean,
    mainFrame: boolean,
  ) => {
    if (mainFrame && !inPlace) finish(false);
  };
  const cancel = () => finish(false);
  ipc.on('window:close-response', receive);
  contents.on('did-start-navigation', navigated);
  contents.on('render-process-gone', cancel);
  window.once('closed', () => {
    cancel();
    ipc.removeListener('window:close-response', receive);
    contents.removeListener('did-start-navigation', navigated);
    contents.removeListener('render-process-gone', cancel);
  });
  return (): Promise<boolean> => {
    if (pending) return Promise.resolve(false);
    return new Promise((resolve) => {
      const id = randomUUID();
      pending = { id, resolve };
      try {
        contents.send('window:close-requested', id);
      } catch {
        finish(false);
      }
    });
  };
}
