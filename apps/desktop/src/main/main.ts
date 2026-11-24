import { app } from 'electron';
import started from 'electron-squirrel-startup';
import { startApplication } from './app/bootstrap.ts';
import { routeLink } from './app/links.ts';
import { startUpdates } from './app/updates.ts';

app.on('open-url', (event, url) => {
  event.preventDefault();
  routeLink(url);
});

if (started) app.quit();

// Forge's `protocols` only writes macOS/Linux metadata; Squirrel installs on
// Windows never register supahelp://, so the browser sign-in can't return here.
// Re-registered every launch so the path follows each versioned app-x.y.z exe.
if (process.platform === 'win32' && app.isPackaged)
  app.setAsDefaultProtocolClient('supahelp');

// One executor owns the encrypted credentials and action receipts for this profile.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.whenReady().then(async () => {
  if (!primary) return;
  await startApplication();
  startUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
