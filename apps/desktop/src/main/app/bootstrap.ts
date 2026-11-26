import { encryption } from '../platform/os-encryption.ts';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  Notification,
  shell,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  registerAccountsIpc,
  scopedFeatureIpc,
} from '../features/accounts/ipc';
import { parseAppLink } from '../features/accounts/links';
import { AccountService } from '../features/accounts/service';
import { registerCasesIpc } from '../features/cases/ipc';
import { ResolveService } from '../features/cases/resolve';
import { CaseService } from '../features/cases/service';
import { CaseStore } from '../features/cases/store';
import { registerChatIpc } from '../features/chat/ipc';
import { ChatModels } from '../features/chat/models';
import { ChatService } from '../features/chat/service';
import { registerConnectionsIpc } from '../features/connections/ipc';
import { Connections } from '../features/connections/service';
import { registerLinearIpc } from '../features/linear/ipc';
import { LinearConnector } from '../features/linear/service';
import { NotificationDelivery } from '../features/notifications/service';
import { registerPilotMetricsIpc } from '../features/pilot-metrics/ipc';
import { PilotMetrics } from '../features/pilot-metrics/service';
import { registerPlaybooksIpc } from '../features/playbooks/ipc';
import { PlaybookService } from '../features/playbooks/service';
import { registerCollaborationIpc } from '../features/collaboration/ipc';
import { TeamDocuments } from '../features/sync/documents';
import { registerSyncIpc } from '../features/sync/ipc';
import { registerQuickTourIpc } from '../features/tour/ipc';
import { SyncService } from '../features/sync/service';
import { registerZendeskIpc } from '../features/zendesk/ipc';
import { ZendeskConnector } from '../features/zendesk/service';
import { AccountApi } from '../integrations/account-api';
import { AuthKit } from '../integrations/authkit';
import { ClaudeCode } from '../integrations/claude-code';
import { Codex } from '../integrations/codex';
import type { CatalogRecord } from '../integrations/connection-oauth';
import { oauthApp } from '../integrations/oauth-apps';
import { OAuthBroker } from '../integrations/oauth-broker';
import { teamApi } from '../integrations/team-api';
import type { ZendeskRecord } from '../integrations/zendesk';
import { AccountCache } from '../platform/account-cache';
import { AuthStore } from '../platform/auth-store';
import { ChatResources } from '../platform/chat-resources';
import { ChatStore } from '../platform/chat-store';
import { ConnectionStore } from '../platform/connection-store';
import type { LinearRecord } from '../platform/linear-store';
import { LocalAccess } from '../platform/local-access';
import { ModelCredentials } from '../platform/model-credentials';
import { PersonalRecovery } from '../platform/personal-workspace-recovery';
import {
  PersonalWorkspace,
  personalDirectory,
} from '../platform/personal-workspace';
import { PlaybookScreenshots } from '../platform/playbook-screenshots';
import { isTrustedSender } from '../ipc/trusted-sender.ts';
import {
  checkNow,
  getUpdateState,
  installNow,
  onUpdateState,
} from './updates.ts';
import { createWindow, rendererLocation } from '../window';
import { closeBeforeQuit } from '../window-close';
import { startAccountPolling } from './account-polling.ts';
import { connectLinks, routeLink } from './links.ts';

export async function startApplication() {
  let window: BrowserWindow | undefined;
  const profile = app.getPath('userData');
  const guest = personalDirectory(profile, null);
  await mkdir(guest, { recursive: true, mode: 0o700 });
  const localAccess = new LocalAccess(
    path.join(app.getPath('userData'), 'local-access.enc'),
    encryption,
  );
  let accountApi: AccountApi | undefined, auth: AuthKit | undefined;
  const accountConfig =
    process.env.SUPAHELP_WORKOS_CLIENT_ID || process.env.SUPAHELP_API_BASE_URL
      ? {
          clientId: process.env.SUPAHELP_WORKOS_CLIENT_ID,
          apiBaseUrl: process.env.SUPAHELP_API_BASE_URL,
        }
      : __SUPAHELP_ACCOUNT_CONFIG__;
  // Only `npm start` may use a local HTTP account API; packaged builds require HTTPS.
  const localApi = !app.isPackaged;
  try {
    if (accountConfig.clientId && accountConfig.apiBaseUrl) {
      auth = new AuthKit({
        clientId: accountConfig.clientId,
        store: new AuthStore(
          path.join(app.getPath('userData'), 'account.enc'),
          encryption,
        ),
        openExternal: (url) => shell.openExternal(url),
        logout: (token) => accountApi!.logout(token),
      });
      accountApi = new AccountApi(
        accountConfig.apiBaseUrl,
        (signal) => auth!.token(signal),
        fetch,
        localApi,
      );
    }
  } catch {
    auth = undefined;
    accountApi = undefined;
  }
  const accounts = new AccountService({
    auth,
    cache: new AccountCache(
      path.join(app.getPath('userData'), 'account-view.enc'),
      encryption,
    ),
    api: accountApi,
    access: localAccess,
    changed: (snapshot) => {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send('accounts:changed', snapshot);
    },
    invalidate: async (context, keepModelLogin) => {
      for (const n of nativeNotifications.values()) n.close();
      nativeNotifications.clear();
      cases.cancelPending();
      models.close(keepModelLogin);
      chats.refreshTools();
      resources.clear();
      screenshots.clear();
      await personal.activate(context.accountId);
      await sync.activate(context);
    },
    saveExport: async (data) => {
      if (!window) return false;
      const generation = accounts.generation();
      const result = await dialog.showSaveDialog(window, {
        title: 'Export organization data',
        defaultPath: 'supahelp-organization.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (
        result.canceled ||
        !result.filePath ||
        accounts.generation() !== generation
      )
        return false;
      const temporary = `${result.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, data, { mode: 0o600 });
        if (accounts.generation() !== generation) return false;
        await rename(temporary, result.filePath);
        return true;
      } finally {
        await rm(temporary, { force: true });
      }
    },
  });
  let notificationDelivery: NotificationDelivery | undefined;
  // Set once cases exist; chats and actions drive the live case statuses.
  let refreshCases = () => {};
  const publish = (channel: string, value: Record<string, any>) => {
    if (
      [
        'chat:changed',
        'linear:changed',
        'zendesk:changed',
        'connections:changed',
      ].includes(channel)
    )
      refreshCases();
    void accounts
      .scopeSnapshot(channel, value)
      .then((snapshot) => {
        if (accounts.generation() !== snapshot.context.generation) return;
        if (
          window &&
          !window.isDestroyed() &&
          !window.webContents.isDestroyed()
        )
          window.webContents.send(channel, snapshot);
        if (
          notificationDelivery &&
          ['linear:changed', 'zendesk:changed', 'connections:changed'].includes(
            channel,
          )
        ) {
          const scope = `${accounts.principal() ?? 'anonymous'}/personal`;
          const values = snapshot as Record<string, any>;
          const actions =
            values.actions ??
            values.connections?.flatMap(
              (c: Record<string, any>) => c.actions ?? [],
            ) ??
            [];
          void notificationDelivery.observe(scope, actions).catch(() => {});
        }
      })
      .catch(() => {});
  };
  const linear = new LinearConnector(
    new ConnectionStore<LinearRecord>(
      path.join(app.getPath('userData'), 'linear.enc'),
      encryption,
    ),
    (url) => shell.openExternal(url),
    (snapshot) => publish('linear:changed', snapshot),
    undefined,
    {
      principal: () => accounts.principal(),
      generation: () => accounts.generation(),
      canUse: () => accounts.canUse('linear'),
      canManage: () => accounts.canManageConnection('linear'),
    },
  );
  const zendesk = new ZendeskConnector(
    new ConnectionStore<ZendeskRecord>(
      path.join(app.getPath('userData'), 'zendesk.enc'),
      encryption,
    ),
    (url) => shell.openExternal(url),
    (snapshot) => publish('zendesk:changed', snapshot),
    undefined,
    (() => {
      try {
        return oauthApp('zendesk').clientId;
      } catch {
        return undefined;
      }
    })(),
    {
      principal: () => accounts.principal(),
      generation: () => accounts.generation(),
      canUse: () => accounts.canUse('zendesk'),
      canManage: () => accounts.canManageConnection('zendesk'),
    },
  );
  const modelCredentials = new ModelCredentials(
    path.join(app.getPath('userData'), 'model-credentials'),
    encryption,
    () => accounts.principal(),
  );
  const provider = new ClaudeCode(
    path.join(app.getPath('userData'), 'claude.json'),
    path.join(app.getPath('userData'), 'chat-workspace'),
    modelCredentials,
  );
  const connections = new Connections(
    (id) =>
      new ConnectionStore<CatalogRecord>(
        path.join(app.getPath('userData'), 'connections', `${id}.enc`),
        encryption,
      ),
    (url) => shell.openExternal(url),
    (snapshot) => publish('connections:changed', snapshot),
    undefined,
    {
      principal: () => accounts.principal(),
      generation: () => accounts.generation(),
      canUse: (id) => accounts.canUse(`catalog:${id}`),
      canManage: (id) => accounts.canManageConnection(`catalog:${id}`),
    },
    accountConfig.apiBaseUrl && auth
      ? new OAuthBroker(
          accountConfig.apiBaseUrl,
          (signal) => auth!.token(signal),
          localApi,
        )
      : undefined,
    // The user's own MCP servers and APIs are saved one file each.
    async () =>
      (
        await readdir(path.join(app.getPath('userData'), 'connections')).catch(
          () => [],
        )
      )
        .map((file) => file.replace(/\.enc$/, ''))
        .filter((id) => /^custom-(mcp|api)-[0-9a-f]{8}$/.test(id)),
    ['google-drive', 'teams'],
  );
  const cases: CaseService = new CaseService(
    new CaseStore(path.join(guest, 'cases.db')),
    (snapshot) => publish('cases:changed', snapshot),
    {
      context: () => accounts.snapshot().context,
      assertContext: (context) => accounts.assertCurrentContext(context),
      encryption,
    },
  );
  const models: ChatModels = new ChatModels(
    path.join(app.getPath('userData'), 'models.json'),
    provider,
    new Codex(
      path.join(app.getPath('userData'), 'codex'),
      undefined,
      modelCredentials,
    ),
    linear,
    zendesk,
    connections,
    accounts,
    cases,
    (chatId, update) => chats.caseUpdated(chatId, update),
    modelCredentials,
  );
  const resources = new ChatResources(path.join(guest, 'projects.json'));
  const chatStore = await ChatStore.open(
    path.join(guest, 'chats'),
    'local-chats',
    encryption,
  );
  const chats = new ChatService(
    models,
    (snapshot) => publish('chat:changed', snapshot),
    chatStore,
  );
  const books = new PlaybookService(cases, cases.store.books, (snapshot) =>
    publish('playbooks:changed', snapshot),
  );
  const allActions = () => [
    ...linear.snapshot().actions,
    ...zendesk.snapshot().actions,
    ...connections.snapshot().connections.flatMap((c) => c.actions ?? []),
  ];
  cases.liveInputs = () => ({
    actions: allActions(),
    chats: chats.snapshot().chats,
  });
  refreshCases = () => cases.refresh();
  const hasUnsettledActions = (chatIds: string[], caseId?: string) => {
    const actions = allActions();
    return actions.some(
      (a) =>
        ((caseId !== undefined && a.source?.caseId === caseId) ||
          chatIds.includes(a.chatId)) &&
        ['pending', 'running', 'unknown'].includes(a.status),
    );
  };
  const resolve = new ResolveService(cases, books, (caseId) =>
    hasUnsettledActions(
      cases.snapshot().cases.find((c) => c.id === caseId)?.chatIds ?? [],
      caseId,
    ),
  );
  const screenshots = new PlaybookScreenshots(
    path.join(guest, 'playbook-screenshots'),
    {
      decode: (data) => {
        const image = nativeImage.createFromBuffer(data);
        const size = image.getSize();
        return { ...size, pixels: image.toBitmap() };
      },
      encode: (image) =>
        nativeImage
          .createFromBitmap(image.pixels, {
            width: image.width,
            height: image.height,
            scaleFactor: 1,
          })
          .toPNG(),
    },
  );
  const recovery = new PersonalRecovery(profile, encryption);
  const personal = new PersonalWorkspace({
    recovery,
    root: profile,
    encryption,
    cases,
    chats,
    models,
    resources,
    screenshots,
    chatStore,
  });
  accounts.recovery = {
    available: () => recovery.available(),
    restore: (id, guard) => personal.restore(id, guard),
  };
  const teamTransport =
    accountConfig.apiBaseUrl && auth
      ? teamApi(
          accountConfig.apiBaseUrl,
          (s) => auth!.token(s),
          fetch,
          localApi,
        )
      : undefined;
  const nativeNotifications = new Map<string, Notification>();
  const notifications = new NotificationDelivery(
    path.join(app.getPath('userData'), 'notifications.enc'),
    encryption,
    (event, hideDetails) => {
      if (!Notification.isSupported()) return;
      const label =
        event.category === 'question'
          ? 'An open question is for you'
          : event.category === 'handed-off'
            ? 'A case was handed to you'
            : event.category === 'brought-in'
              ? 'You were brought into a case'
              : event.category === 'approval'
                ? 'A case needs approval'
                : event.category === 'playbook-published'
                  ? 'A new Playbook was published'
                  : event.category === 'playbook-updated'
                    ? 'Your Playbook was updated'
                    : 'An action needs checking';
      const banner = new Notification({
        title: 'Supahelp',
        body: hideDetails ? 'You have an update in Supahelp.' : label,
      });
      nativeNotifications.set(event.id, banner);
      const context = accounts.snapshot().context;
      banner.on('click', () => {
        if (accounts.principal() !== context.accountId) return;
        // Playbook banners only bring the app forward; the bell opens the Playbook.
        if (event.category.startsWith('playbook-')) {
          /* no case link */
        } else if (
          event.category === 'approval' ||
          event.category === 'failure'
        )
          accounts.receiveLocalCaseLink(event.documentId);
        else routeLink(`supahelp://case/${event.documentId}`);
        if (!window) openWindow();
        window?.show();
        window?.focus();
      });
      banner.on('close', () => nativeNotifications.delete(event.id));
      banner.on('failed', () => nativeNotifications.delete(event.id));
      banner.show();
    },
  );
  await notifications
    .observe(`${accounts.principal() ?? 'anonymous'}/personal`, [
      ...linear.snapshot().actions,
      ...zendesk.snapshot().actions,
      ...connections.snapshot().connections.flatMap((c) => c.actions ?? []),
    ])
    .catch(() => {});
  notificationDelivery = notifications;
  const knownCaseAuthority = new Map<string, string>();
  const sync = new SyncService({
    directory: path.join(app.getPath('userData'), 'team'),
    encryption,
    transport: teamTransport,
    changed: () => {
      const current = new Map(
        sync.cases().map((record) => [record.id, record]),
      );
      for (const [id, authority] of knownCaseAuthority) {
        const c = current.get(id);
        if (!c || `${c.ownerId}/${c.ownerRevision ?? 0}` !== authority) {
          void Promise.all([
            linear.cancelCase(id),
            zendesk.cancelCase(id),
            connections.cancelCase(id),
          ]).catch(() => {});
        }
      }
      knownCaseAuthority.clear();
      for (const c of current.values())
        knownCaseAuthority.set(c.id, `${c.ownerId}/${c.ownerRevision ?? 0}`);
      cases.emit();
      books.refreshTeam();
    },
    invalidated: () => {
      for (const n of nativeNotifications.values()) n.close();
      nativeNotifications.clear();
      cases.cancelPending();
      models.close(true);
      screenshots.clear();
    },
  });
  cases.team = new TeamDocuments(sync, cases);
  cases.teamChats = {
    get: (chatId) => chats.teamCase(chatId),
    link: (chatId, caseId) => chats.linkTeamCase(chatId, caseId),
    chats: (caseId) => chats.teamCaseChats(caseId),
  };
  accounts.documentsVisible = () => {
    try {
      sync.guard();
      return true;
    } catch {
      return false;
    }
  };
  accounts.reconciled = (view, signedOut, guard) =>
    sync.reconcile(view, signedOut, guard);
  screenshots.team = {
    active: () => accounts.snapshot().context.context.kind === 'team',
    allowed: (book, id) => sync.imageAllowed(book, id),
    read: (book, id) => sync.image(book, id),
    save: (book, id, data) => sync.saveImage(book, id, data),
  };
  models.configurePlaybooks(books, chats);
  models.configureResolution(resolve, chats);
  for (const chat of chats.snapshot().chats)
    models.attachPlaybooks(chat.id, chat.playbookIds ?? []);
  registerAccountsIpc(ipcMain, () => window, rendererLocation(), accounts);
  registerQuickTourIpc(
    ipcMain,
    () => window,
    rendererLocation(),
    path.join(app.getPath('userData'), 'quick-tour.json'),
  );
  const trusted = (event: Electron.IpcMainInvokeEvent) =>
    isTrustedSender(event, window?.webContents, rendererLocation());
  ipcMain.handle('app:update-state', (event) =>
    trusted(event) ? getUpdateState() : undefined,
  );
  ipcMain.handle('app:update-check', (event) => {
    if (trusted(event)) checkNow();
  });
  ipcMain.handle('app:update-install', (event) => {
    if (trusted(event)) installNow();
  });
  onUpdateState((state) => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send('app:update-state-changed', state);
  });
  const featureIpc = scopedFeatureIpc(
    ipcMain,
    () => window,
    rendererLocation(),
    accounts,
    async () => (await models.settings()).selected.provider,
    new Set(connections.snapshot().connections.map((item) => item.id)),
  );
  registerCollaborationIpc(
    featureIpc,
    cases,
    sync,
    accounts,
    teamTransport,
    async () => (await models.settings()).selected,
    notifications,
  );
  registerSyncIpc(
    featureIpc,
    cases,
    sync,
    async () => (await models.settings()).selected,
  );
  registerCasesIpc(
    featureIpc,
    () => window,
    rendererLocation(),
    cases,
    chats,
    async () => (await models.settings()).selected,
    (caseId, chatIds) => hasUnsettledActions(chatIds, caseId),
  );
  registerPilotMetricsIpc(
    featureIpc,
    () => window,
    rendererLocation(),
    new PilotMetrics(cases),
    async (data, guard) => {
      if (!window) return false;
      guard();
      const result = await dialog.showSaveDialog(window, {
        title: 'Export local pilot counts',
        defaultPath: 'supahelp-pilot-counts.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      guard();
      if (result.canceled || !result.filePath) return false;
      const temporary = `${result.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, data, { mode: 0o600, flag: 'wx' });
        guard();
        await rename(temporary, result.filePath);
        return true;
      } finally {
        await rm(temporary, { force: true });
      }
    },
  );
  registerPlaybooksIpc(
    featureIpc,
    () => window,
    rendererLocation(),
    cases,
    books,
    resolve,
    models,
    chats,
    screenshots,
    async () => {
      if (!window) return;
      const result = await dialog.showOpenDialog(window, {
        title: 'Add Playbook screenshot',
        filters: [{ name: 'PNG screenshot', extensions: ['png'] }],
        properties: ['openFile'],
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
    zendesk,
    {
      chooseExport: async (title) => {
        if (!window) return;
        const result = await dialog.showSaveDialog(window, {
          title: 'Export Playbook',
          defaultPath: `${title.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'playbook'}.md`,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        return result.canceled ? undefined : result.filePath;
      },
      openLink: (url) => shell.openExternal(url),
      copyMarkdown: (markdown) => clipboard.writeText(markdown),
    },
  );
  registerLinearIpc(
    featureIpc,
    () => window,
    rendererLocation(),
    linear,
    chats,
  );
  registerZendeskIpc(
    featureIpc,
    () => window,
    rendererLocation(),
    zendesk,
    chats,
  );
  registerConnectionsIpc(
    featureIpc,
    () => window,
    rendererLocation(),
    connections,
    chats,
  );
  registerChatIpc({
    ipcMain: featureIpc,
    removalBlocked: (chatId) => hasUnsettledActions([chatId]),
    resources,
    choosePaths: async (kind) => {
      if (!window) return [];
      const result = await dialog.showOpenDialog(window, {
        title:
          kind === 'project'
            ? 'Connect a project folder'
            : 'Attach photos and files',
        properties:
          kind === 'project'
            ? ['openDirectory']
            : ['openFile', 'multiSelections'],
      });
      return result.canceled ? [] : result.filePaths;
    },
    provider,
    chats,
    models,
    openExternal: (url) => shell.openExternal(url),
    getWindow: () => window,
    location: rendererLocation(),
    chooseExecutable: async (id = 'claude') => {
      if (!window) return;
      const result = await dialog.showOpenDialog(window, {
        title: id === 'claude' ? 'Choose Claude Code' : 'Choose Codex',
        properties: ['openFile', 'showHiddenFiles'],
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
    openInstall: (id = 'claude') =>
      shell.openExternal(
        id === 'claude'
          ? 'https://code.claude.com/docs/en/setup'
          : 'https://developers.openai.com/codex/cli',
      ),
  });
  const openWindow = () => {
    window = createWindow(() => cases.cancelPending());
    window.on('focus', () => {
      void accounts.refresh().then(() => sync.sync());
    });
    window.on('closed', () => {
      window = undefined;
      cases.cancelPending();
      screenshots.clear();
      void chats.close();
      resources.clear();
      models.close();
      chats.refreshTools();
    });
  };
  await sync.sweep();
  await personal.activate(null);
  await accounts.refresh();
  openWindow();
  connectLinks((url) => accounts.receiveLink(url));
  void accounts.refresh();
  const stopAccountPolling = startAccountPolling({
    accounts,
    sync,
    teamTransport,
    notifications,
    getWindow: () => window,
  });
  app.on('second-instance', (_event, argv) => {
    for (const url of argv) if (parseAppLink(url)) routeLink(url);
    if (!window) openWindow();
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });

  let quitting = false;
  let closingForQuit = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (closingForQuit) return;
    closingForQuit = true;
    closeBeforeQuit(
      window,
      () => {
        quitting = true;
        stopAccountPolling();
        for (const n of nativeNotifications.values()) n.close();
        nativeNotifications.clear();
        cases.cancelPending();
        screenshots.clear();
        models.close();
        void Promise.allSettled([
          chats.close(),
          linear.close(),
          zendesk.close(),
          connections.close(),
          accounts.close(),
          sync.deactivate(),
        ]).finally(() => {
          cases.close();
          personal.close();
          app.quit();
        });
      },
      () => {
        closingForQuit = false;
      },
    );
  });

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openWindow();
    }
  });
}
