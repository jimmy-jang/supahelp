import { app, autoUpdater, dialog } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { UpdateState } from '../../contracts/updates.ts';
import { feedUrl, updatesSupported } from './update-feed.ts';
import { canCheck, nextUpdateState, type UpdateEvent } from './update-state.ts';

const HOUR = 60 * 60 * 1000;
let state: UpdateState = { version: app.getVersion(), status: 'unsupported' };
let prompted = false;
const listeners = new Set<(state: UpdateState) => void>();

export const getUpdateState = () => state;

export function onUpdateState(listener: (state: UpdateState) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function apply(event: UpdateEvent) {
  const next = nextUpdateState(state, event);
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener(state);
}

export function checkNow() {
  if (!canCheck(state)) return;
  try {
    autoUpdater.checkForUpdates();
  } catch (error) {
    console.warn('[updates]', (error as Error).message);
    apply('error');
  }
}

export function installNow() {
  if (state.status === 'ready') autoUpdater.quitAndInstall();
}

export function startUpdates() {
  const feed = __SUPAHELP_UPDATE_FEED__;
  // macOS builds must also be Developer ID signed.
  const squirrelInstalled =
    process.platform !== 'win32' ||
    existsSync(join(dirname(process.execPath), '..', 'Update.exe'));
  if (
    !updatesSupported(feed, app.isPackaged, process.platform, squirrelInstalled)
  )
    return;
  autoUpdater.on('checking-for-update', () => apply('checking'));
  autoUpdater.on('update-available', () => apply('available'));
  autoUpdater.on('update-not-available', () => apply('none'));
  autoUpdater.on('error', (error) => {
    console.warn('[updates]', error.message);
    apply('error');
  });
  autoUpdater.on('update-downloaded', async () => {
    apply('downloaded');
    if (prompted) return; // Settings and the sidebar chip carry it from here
    prompted = true;
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: 'A Supahelp update is ready',
      detail:
        'Restart to finish updating, or it installs the next time Supahelp opens.',
    });
    if (response === 0) installNow();
  });
  try {
    autoUpdater.setFeedURL({
      url: feedUrl(feed, process.platform, process.arch, app.getVersion()),
    });
  } catch (error) {
    console.warn('[updates]', (error as Error).message); // e.g. unsigned local mac build
    return;
  }
  apply('supported');
  // Delay the first check: Squirrel.Windows holds a lock right after install.
  setTimeout(checkNow, 10_000);
  setInterval(checkNow, HOUR);
}
