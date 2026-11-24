import type { BrowserWindow, IpcMain } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isTrustedSender } from '../../ipc/trusted-sender.ts';

// One flag per computer. A missing or unreadable file only replays the tour.
async function readSeen(file: string) {
  try {
    return JSON.parse(await readFile(file, 'utf8')).seen === true;
  } catch {
    return false;
  }
}

async function markSeen(file: string) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify({ seen: true }), {
    mode: 0o600,
  });
  await rename(`${file}.tmp`, file);
}

export function registerQuickTourIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | undefined,
  location: string,
  file: string,
) {
  const handle = (name: string, run: () => Promise<{ seen: boolean }>) =>
    ipc.handle(`quick-tour:${name}`, async (event, input: unknown) => {
      if (!isTrustedSender(event, getWindow()?.webContents, location))
        return { ok: false, error: 'This window cannot use the quick tour.' };
      if (input !== undefined)
        return { ok: false, error: 'Check the quick tour request.' };
      try {
        return { ok: true, value: await run() };
      } catch {
        return { ok: false, error: 'The quick tour state could not be saved.' };
      }
    });
  handle('get', async () => ({ seen: await readSeen(file) }));
  handle('complete', async () => {
    await markSeen(file);
    return { seen: true };
  });
}
