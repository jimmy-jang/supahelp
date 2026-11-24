import { encryption } from '../../src/main/platform/os-encryption';
import { registerCollaborationIpc } from '../../src/main/features/collaboration/ipc';
import { NotificationDelivery } from '../../src/main/features/notifications/service';
// Controlled composition of production services + the packaged preload/renderer.
import { BrowserWindow, ipcMain, nativeImage } from 'electron';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AccountService } from '../../src/main/features/accounts/service';
import { AccountApi } from '../../src/main/integrations/account-api';
import { LocalAccess } from '../../src/main/platform/local-access';
import {
  registerAccountsIpc,
  scopedFeatureIpc,
} from '../../src/main/features/accounts/ipc';
import { CaseStore } from '../../src/main/features/cases/store';
import { CaseService } from '../../src/main/features/cases/service';
import { registerCasesIpc } from '../../src/main/features/cases/ipc';
import { PlaybookService } from '../../src/main/features/playbooks/service';
import { registerPlaybooksIpc } from '../../src/main/features/playbooks/ipc';
import { ResolveService } from '../../src/main/features/cases/resolve';
import { PlaybookScreenshots } from '../../src/main/platform/playbook-screenshots';
import { SyncService } from '../../src/main/features/sync/service';
import { TeamDocuments } from '../../src/main/features/sync/documents';
import { registerSyncIpc } from '../../src/main/features/sync/ipc';
import { teamApi } from '../../src/main/integrations/team-api';
import type { ChatService } from '../../src/main/features/chat/service';
import type { ChatModels } from '../../src/main/features/chat/models';
export async function boot(
  profile: string,
  packaged: string,
  origin: string,
  token: string,
  workspaceId: string,
  organizationId: string,
) {
  await mkdir(profile, { recursive: true });
  const location = pathToFileURL(
    join(packaged, '.vite/renderer/main_window/index.html'),
  ).href;
  const window = new BrowserWindow({
    width: 1400,
    height: 950,
    webPreferences: {
      preload: join(packaged, '.vite/build/preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error')
      console.error('renderer console:', event.message);
  });

  const auth = {
    begin: async () => {},
    cancel: () => {},
    finish: async () => {},
    token: async () => token,
    signOut: async () => {},
    close: async () => {},
  };
  const accounts = new AccountService({
    auth,
    api: new AccountApi(origin, auth.token, fetch, true),
    access: new LocalAccess(join(profile, 'access.enc'), encryption),
    changed: (s) => {
      if (!window.isDestroyed()) window.webContents.send('accounts:changed', s);
    },
    invalidate: async () => {
      cases.cancelPending();
      await sync.activate(accounts.snapshot().context);
    },
  });
  const publish = (channel: string, value: Record<string, any>) =>
    void accounts
      .scopeSnapshot(channel, value)
      .then((v) => {
        if (!window.isDestroyed()) window.webContents.send(channel, v);
      })
      .catch(() => {});
  const cases = new CaseService(
    new CaseStore(join(profile, 'cases.db')),
    (s) => publish('cases:changed', s),
    {
      context: () => accounts.snapshot().context,
      assertContext: (c) => accounts.assertCurrentContext(c),
      encryption,
    },
  );
  const books = new PlaybookService(cases, cases.store.books, (s) =>
    publish('playbooks:changed', s),
  );
  const sync = new SyncService({
    directory: join(profile, 'team'),
    encryption,
    transport: teamApi(origin, auth.token, fetch, true),
    changed: () => {
      cases.emit();
      books.refreshTeam();
    },
    invalidated: () => cases.cancelPending(),
  });
  cases.team = new TeamDocuments(sync, cases);
  accounts.documentsVisible = () => {
    try {
      sync.guard();
      return true;
    } catch {
      return false;
    }
  };
  accounts.reconciled = (v, out) => sync.reconcile(v, out);
  const screenshots = new PlaybookScreenshots(join(profile, 'screenshots'), {
    decode: (b) => {
      const i = nativeImage.createFromBuffer(b);
      return { ...i.getSize(), pixels: i.toBitmap() };
    },
    encode: (i) =>
      nativeImage
        .createFromBitmap(i.pixels, {
          width: i.width,
          height: i.height,
          scaleFactor: 1,
        })
        .toPNG(),
  });
  screenshots.team = {
    active: () => true,
    allowed: (b, id) => sync.imageAllowed(b, id),
    read: (b, id) => sync.image(b, id),
    save: (b, id, data) => sync.saveImage(b, id, data),
  };
  const selection = async () => ({
    provider: 'claude' as const,
    model: 'sonnet' as const,
  });
  const models = {
    settings: async () => ({ selected: await selection() }),
    draftDocument: async (kind: string) => {
      if (kind !== 'resolution')
        throw Error('Unexpected controlled draft request.');
      return { resolution: 'Corrected the duplicate retry.' };
    },
    cancelMasking: () => {},
  } as unknown as ChatModels;
  const chats = {
    snapshot: () => ({ chats: [] }),
    refreshTools: () => {},
    caseUndone: () => {},
  } as unknown as ChatService;
  const channels: string[] = [];
  const ipc = {
    handle: (name: string, fn: Parameters<typeof ipcMain.handle>[1]) => {
      channels.push(name);
      ipcMain.handle(name, fn);
    },
  };
  registerAccountsIpc(ipc, () => window, location, accounts);
  const scoped = scopedFeatureIpc(
    ipc,
    () => window,
    location,
    accounts,
    async () => 'claude',
    new Set(),
  );
  registerCasesIpc(scoped, () => window, location, cases, chats, selection);
  registerPlaybooksIpc(
    scoped,
    () => window,
    location,
    cases,
    books,
    new ResolveService(cases, books, () => false),
    models,
    chats,
    screenshots,
    async () => undefined,
  );
  const delivered: string[] = [];
  const notifications = new NotificationDelivery(
    join(profile, 'notifications.enc'),
    encryption,
    (e) => delivered.push(e.id),
  );
  registerCollaborationIpc(
    scoped,
    cases,
    sync,
    accounts,
    teamApi(origin, auth.token, fetch, true),
    selection,
    notifications,
  );
  registerSyncIpc(scoped, cases, sync, selection);
  scoped.handle('chat:list', async () => ({
    ok: true,
    value: { revision: 1, chats: [] },
  }));
  scoped.handle('chat:projects', async () => ({ ok: true, value: [] }));
  scoped.handle('chat:discard-attachments', async () => ({ ok: true }));
  scoped.handle('models:settings', async () => ({
    ok: true,
    value: { providers: [], models: [], selected: await selection() },
  }));
  await accounts.refresh();
  await accounts.select({ kind: 'team', workspaceId, organizationId });
  await window.loadURL(location);
  return {
    window,
    delivered,
    notifications,
    sync,
    cases,
    books,
    accounts,
    screenshots,
    async close() {
      window.destroy();
      await sync.deactivate();
      await accounts.close();
      cases.close();
      channels.forEach((c) => ipcMain.removeHandler(c));
    },
  };
}
