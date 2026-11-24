import { encryption } from '../../src/main/platform/os-encryption';
import { PlaybookService } from '../../src/main/features/playbooks/service';
import { PilotMetrics } from '../../src/main/features/pilot-metrics/service';
import { registerPilotMetricsIpc } from '../../src/main/features/pilot-metrics/ipc';
import { ResolveService } from '../../src/main/features/cases/resolve';
import { registerPlaybooksIpc } from '../../src/main/features/playbooks/ipc';
import { PlaybookScreenshots } from '../../src/main/platform/playbook-screenshots';
import { ZendeskConnector } from '../../src/main/features/zendesk/service';
import { ZendeskRemote } from '../../src/main/integrations/zendesk';
import { registerZendeskIpc } from '../../src/main/features/zendesk/ipc';
// Test-only composition: production services and packaged renderer/preload, controlled Codex transport.
import { BrowserWindow, ipcMain, nativeImage } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AccountService } from '../../src/main/features/accounts/service';
import { LocalAccess } from '../../src/main/platform/local-access';
import {
  registerAccountsIpc,
  scopedFeatureIpc,
} from '../../src/main/features/accounts/ipc';
import { CaseStore } from '../../src/main/features/cases/store';
import { CaseService } from '../../src/main/features/cases/service';
import { registerCasesIpc } from '../../src/main/features/cases/ipc';
import { ChatModels } from '../../src/main/features/chat/models';
import { ChatService } from '../../src/main/features/chat/service';
import { registerChatIpc } from '../../src/main/features/chat/ipc';
import { ChatResources } from '../../src/main/platform/chat-resources';
import { Codex } from '../../src/main/integrations/codex';
import { ClaudeCode } from '../../src/main/integrations/claude-code';
import { ModelCredentials } from '../../src/main/platform/model-credentials';
import {
  closeBeforeQuit,
  protectUnsavedEdits,
} from '../../src/main/window-close';
import { windowConfirmation } from '../../src/main/window-dialog';

export async function boot(
  profile: string,
  packagedRoot: string,
  executable: string,
  options?: {
    image?: string;
    zendeskOrigin?: string;
    authorize?: (url: string) => Promise<void>;
    savePilot?: (data: string, guard: () => void) => Promise<boolean>;
    pilotNow?: () => number;
    playbookExport?: string;
    copyMarkdown?: (markdown: string) => void;
    realProviders?: boolean;
  },
) {
  const location = pathToFileURL(
    join(packagedRoot, '.vite/renderer/main_window/index.html'),
  ).href;
  const window = new BrowserWindow({
    width: 1440,
    height: 1000,
    webPreferences: {
      preload: join(packagedRoot, '.vite/build/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const accounts = new AccountService({
    access: new LocalAccess(join(profile, 'local-access.enc'), encryption),
    changed: (snapshot) =>
      window.webContents.send('accounts:changed', snapshot),
    invalidate: async () => {
      cases.cancelPending();
      models.cancelMasking();
      screenshots.clear();
      chats.refreshTools();
    },
  });
  const publish = (channel: string, snapshot: Record<string, any>) => {
    void accounts
      .scopeSnapshot(channel, snapshot)
      .then((value) => window.webContents.send(channel, value))
      .catch(() => {});
  };
  const cases: CaseService = new CaseService(
    new CaseStore(join(profile, 'cases.db')),
    (snapshot) => publish('cases:changed', snapshot),
    {
      context: () => accounts.snapshot().context,
      assertContext: (context) => accounts.assertCurrentContext(context),
      encryption,
    },
  );
  process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS = '1';
  const credentials = new ModelCredentials(
    join(profile, 'model-credentials'),
    encryption,
    () => accounts.principal(),
  );
  // The controlled executable uses a fake API key so subscription guards stay enabled.
  if (!options?.realProviders)
    await credentials.set(
      'chatgpt',
      'api-key',
      'controlled-fixture-api-key-only',
    );
  const claude = options?.realProviders
    ? new ClaudeCode(
        join(profile, 'claude.json'),
        join(profile, 'chat-workspace'),
        credentials,
      )
    : ({
        status: async () => ({
          state: 'missing',
          model: 'sonnet',
          message: 'Controlled test',
        }),
        models: async () => [],
      } as unknown as ClaudeCode);
  const models: ChatModels = new ChatModels(
    join(profile, 'models.json'),
    claude,
    new Codex(join(profile, 'codex'), executable, credentials),
    undefined,
    undefined,
    undefined,
    accounts,
    cases,
    (id, update) => chats.caseUpdated(id, update),
    credentials,
  );
  const chats = new ChatService(models, (snapshot) =>
    publish('chat:changed', snapshot),
  );
  const books = new PlaybookService(cases, cases.store.books, (snapshot) =>
    publish('playbooks:changed', snapshot),
  );
  const zendesk = options?.zendeskOrigin
    ? new ZendeskConnector(
        { load: async () => undefined, save: async () => {} },
        options.authorize!,
        (snapshot) => publish('zendesk:changed', snapshot),
        (record, save, open) =>
          new ZendeskRemote(record, save, open, options.zendeskOrigin!, 0),
        'public-client',
      )
    : undefined;
  if (zendesk)
    await zendesk.connect({
      site: 'acme',
      access: 'write',
    });
  const resolve = new ResolveService(
    cases,
    books,
    (caseId) =>
      zendesk
        ?.snapshot()
        .actions.some(
          (a) =>
            a.source?.caseId === caseId &&
            ['pending', 'running', 'unknown'].includes(a.status),
        ) ?? false,
  );
  const screenshots = new PlaybookScreenshots(
    join(profile, 'playbook-screenshots'),
    {
      decode: (data) => {
        const image = nativeImage.createFromBuffer(data);
        return { ...image.getSize(), pixels: image.toBitmap() };
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
  models.configurePlaybooks(books, chats);
  models.configureResolution(resolve, chats);
  const channels: string[] = [];
  const tracked = {
    handle: (
      channel: string,
      listener: Parameters<typeof ipcMain.handle>[1],
    ) => {
      channels.push(channel);
      ipcMain.handle(channel, listener);
    },
  };
  registerAccountsIpc(
    tracked,
    () => (window.isDestroyed() ? undefined : window),
    location,
    accounts,
  );
  const scoped = scopedFeatureIpc(
    tracked,
    () => (window.isDestroyed() ? undefined : window),
    location,
    accounts,
    async () => (await models.settings()).selected.provider,
    new Set(),
  );
  for (const name of zendesk ? ['linear'] : ['linear', 'zendesk'])
    scoped.handle(`${name}:status`, async () => ({
      ok: true,
      value: {
        revision: 0,
        state: 'disconnected',
        access: 'read',
        tools: [],
        actions: [],
        message: 'Disconnected',
      },
    }));
  scoped.handle('connections:status', async () => ({
    ok: true,
    value: { revision: 0, connections: [] },
  }));
  registerCasesIpc(
    scoped,
    () => (window.isDestroyed() ? undefined : window),
    location,
    cases,
    chats,
    async () => (await models.settings()).selected,
  );
  registerPlaybooksIpc(
    scoped,
    () => (window.isDestroyed() ? undefined : window),
    location,
    cases,
    books,
    resolve,
    models,
    chats,
    screenshots,
    async () => options?.image,
    zendesk,
    {
      chooseExport: async () => options?.playbookExport,
      copyMarkdown: options?.copyMarkdown,
      openLink: async () => {
        throw Error('External access is disabled in this test.');
      },
    },
  );
  registerPilotMetricsIpc(
    scoped,
    () => (window.isDestroyed() ? undefined : window),
    location,
    new PilotMetrics(cases, options?.pilotNow),
    options?.savePilot ?? (async () => false),
  );
  if (zendesk)
    registerZendeskIpc(
      scoped,
      () => (window.isDestroyed() ? undefined : window),
      location,
      zendesk,
      chats,
    );
  registerChatIpc({
    ipcMain: scoped,
    getWindow: () => (window.isDestroyed() ? undefined : window),
    location,
    provider: claude,
    chats,
    models,
    resources: new ChatResources(join(profile, 'projects.json')),
    choosePaths: async () => [],
    chooseExecutable: async () => undefined,
    openInstall: async () => {},
    openExternal: async () => {
      throw Error('External access is disabled in this test.');
    },
  });
  protectUnsavedEdits(
    window,
    windowConfirmation(ipcMain, window, location),
    () => cases.cancelPending(),
  );
  await window.loadURL(location);
  return {
    window,
    cases,
    chats,
    accounts,
    books,
    resolve,
    screenshots,
    models,
    zendesk,
    quitProbe: () =>
      new Promise<string>((resolve) =>
        closeBeforeQuit(
          window,
          () => resolve('closed'),
          () => resolve('stayed'),
        ),
      ),
    async close() {
      cases.cancelPending();
      models.close();
      await chats.close();
      await accounts.close();
      await zendesk?.close();
      screenshots.clear();
      cases.close();
      window.destroy();
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      channels.forEach((channel) => ipcMain.removeHandler(channel));
    },
  };
}
