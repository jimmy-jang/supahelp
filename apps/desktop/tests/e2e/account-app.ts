import { registerPlaybooksIpc } from '../../src/main/features/playbooks/ipc';
import { ResolveService } from '../../src/main/features/cases/resolve';
import { PersonalRecovery } from '../../src/main/platform/personal-workspace-recovery';
import { mkdir } from 'node:fs/promises';
import { nativeImage } from 'electron';
import {
  PersonalWorkspace,
  personalDirectory,
} from '../../src/main/platform/personal-workspace';
import { ChatStore } from '../../src/main/platform/chat-store';
import { ChatResources } from '../../src/main/platform/chat-resources';
import { PlaybookScreenshots } from '../../src/main/platform/playbook-screenshots';
import type { ChatModels } from '../../src/main/features/chat/models';
import { encryption } from '../../src/main/platform/os-encryption';
import { PlaybookService } from '../../src/main/features/playbooks/service';
import { PilotMetrics } from '../../src/main/features/pilot-metrics/service';
import { registerPilotMetricsIpc } from '../../src/main/features/pilot-metrics/ipc';
// Test-only composition. Production cannot configure loopback APIs or fake WorkOS transport.
import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AuthStore } from '../../src/main/platform/auth-store';
import { LocalAccess } from '../../src/main/platform/local-access';
import { AuthKit } from '../../src/main/integrations/authkit';
import { AccountApi } from '../../src/main/integrations/account-api';
import { AccountService } from '../../src/main/features/accounts/service';
import {
  registerAccountsIpc,
  scopedFeatureIpc,
} from '../../src/main/features/accounts/ipc';
import { CaseStore } from '../../src/main/features/cases/store';
import { CaseService } from '../../src/main/features/cases/service';
import { registerCasesIpc } from '../../src/main/features/cases/ipc';
import { ChatService } from '../../src/main/features/chat/service';

export async function boot(
  profile: string,
  packagedRoot: string,
  origin: string,
  onboarding = false,
) {
  const guest = personalDirectory(profile, null);
  await mkdir(guest, { recursive: true, mode: 0o700 });
  const renderer = join(packagedRoot, '.vite/renderer/main_window/index.html'),
    location = pathToFileURL(renderer).href;
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
  const channels: string[] = [];
  const testIpc = {
    handle: (
      channel: string,
      listener: Parameters<typeof ipcMain.handle>[1],
    ) => {
      channels.push(channel);
      ipcMain.handle(channel, listener);
    },
  };

  let accounts: AccountService, api: AccountApi;
  const auth = new AuthKit({
    clientId: 'client_controlled',
    store: new AuthStore(join(profile, 'account.enc'), encryption),
    fetch: async (url, options) =>
      fetch(origin + '/workos' + new URL(String(url)).pathname, options),
    openExternal: async (url) => {
      const response = await fetch(origin + '/authorize', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      const { callback } = (await response.json()) as { callback: string };
      setImmediate(() => void accounts.receiveLink(callback).catch(() => {}));
    },
    logout: (token) => api.logout(token),
  });
  api = new AccountApi(origin, (signal) => auth.token(signal), fetch, true);
  // This fixture exercises accounts, not the separate post-sign-up onboarding journey.
  const accountView = api.view.bind(api);
  api.view = async (signal) => {
    const view = await accountView(signal);
    if (!onboarding) {
      delete view.onboarding;
      delete view.onboardingCompleted;
    }
    return view;
  };
  accounts = new AccountService({
    auth,
    api,
    access: new LocalAccess(join(profile, 'local-access.enc'), encryption),
    changed: (snapshot) =>
      window.webContents.send('accounts:changed', snapshot),
    invalidate: async (context) => personal.activate(context.accountId),
  });
  registerAccountsIpc(testIpc, () => window, location, accounts);
  const featureIpc = scopedFeatureIpc(
    testIpc,
    () => window,
    location,
    accounts,
    async () => 'claude',
    new Set(),
  );
  featureIpc.handle('sync:collaboration', async () => ({
    ok: false,
    error: 'Team sync is disabled in this account fixture.',
  }));
  featureIpc.handle('sync:status', async () => ({
    ok: true,
    value: { state: 'disabled', pending: 0 },
  }));
  featureIpc.handle('models:settings', async () => ({
    ok: true,
    value: {
      providers: [],
      models: [],
      selected: { provider: 'claude', model: 'sonnet' },
    },
  }));
  featureIpc.handle('connections:status', async () => ({
    ok: true,
    value: { revision: 0, connections: [], pendingReview: ['zendesk'] },
  }));
  for (const channel of ['linear:status', 'zendesk:status'])
    featureIpc.handle(channel, async () => ({
      ok: true,
      value: {
        revision: 0,
        state: 'disconnected',
        access: 'read-only',
        tools: [],
        actions: [],
        scopes: [],
      },
    }));
  featureIpc.handle('chat:projects', async () => ({ ok: true, value: [] }));
  featureIpc.handle('chat:discard-attachments', async () => ({
    ok: true,
    value: undefined,
  }));
  featureIpc.handle('chat:list', async () => ({
    ok: true,
    value: chats.snapshot(),
  }));
  const chatStore = await ChatStore.open(
    join(guest, 'chats'),
    'local-chats',
    encryption,
  );
  const chats = new ChatService(
    {
      open() {
        throw Error('No inference in account fixture');
      },
    },
    () => {},
    chatStore,
  );
  const store = new CaseStore(join(guest, 'cases.db')),
    cases = new CaseService(
      store,
      (snapshot) => {
        void accounts
          .scopeSnapshot('cases:changed', snapshot)
          .then((value) => window.webContents.send('cases:changed', value))
          .catch(() => {});
      },
      {
        context: () => accounts.snapshot().context,
        assertContext: (context) => accounts.assertCurrentContext(context),
        encryption,
      },
    );
  const screenshots = new PlaybookScreenshots(
    join(guest, 'playbook-screenshots'),
    {
      decode(data) {
        const image = nativeImage.createFromBuffer(data);
        return { ...image.getSize(), pixels: image.toBitmap() };
      },
      encode(image) {
        return nativeImage
          .createFromBitmap(image.pixels, {
            width: image.width,
            height: image.height,
          })
          .toPNG();
      },
    },
  );
  const recovery = new PersonalRecovery(profile, encryption);
  const personal = new PersonalWorkspace({
    recovery,
    root: profile,
    encryption,
    cases,
    chats,
    chatStore,
    screenshots,
    resources: new ChatResources(join(guest, 'projects.json')),
    models: {
      resetWorkspace() {},
      attachPlaybooks() {},
    } as unknown as ChatModels,
  });
  accounts.recovery = {
    available: () => recovery.available(),
    restore: (id, guard) => personal.restore(id, guard),
  };
  await personal.activate(null);
  const caseOp = {
    context: accounts.snapshot().context,
    selection: { provider: 'claude' as const, model: 'fixture-model' },
    signal: cases.operationSignal(),
  };
  await cases.prepare(caseOp);
  if (!cases.snapshot().cases.length)
    await cases.create(
      {
        id: 'controlled-local-chat',
        title: 'Controlled private local case',
        messages: [{ role: 'user', text: 'Zendesk ticket #123' }],
      },
      caseOp,
    );
  const books = new PlaybookService(cases, cases.store.books, () => {});
  if (!books.list(caseOp).length)
    await books.save(
      undefined,
      0,
      {
        title: 'Controlled personal Playbook',
        markdown: 'Keep local across sign-in',
      },
      caseOp,
    );
  featureIpc.handle('playbooks:list', async (_event, input) => {
    accounts.assertCurrentContext(input.context);
    if (input.context.context.kind === 'team')
      return {
        ok: true,
        value: { revision: 0, playbooks: [], resolutions: [] },
      };
    await cases.prepare({
      ...caseOp,
      context: input.context,
      signal: cases.operationSignal(),
    });
    return {
      ok: true,
      value: books.snapshot({
        ...caseOp,
        context: input.context,
        signal: cases.operationSignal(),
      }),
    };
  });
  registerCasesIpc(
    featureIpc,
    () => window,
    location,
    cases,
    chats,
    async () => ({ provider: 'claude', model: 'fixture-model' }),
  );

  // Keep the account fixture's disabled-team projection, but exercise production deletion IPC.
  registerPlaybooksIpc(
    {
      handle: (channel, listener) => {
        if (channel === 'playbooks:remove')
          featureIpc.handle(channel, listener);
      },
    },
    () => window,
    location,
    cases,
    books,
    new ResolveService(cases, books, () => false),
    {
      settings: async () => ({
        selected: { provider: 'claude', model: 'fixture-model' },
      }),
      cancelMasking() {},
      attachPlaybooks() {},
    } as unknown as ChatModels,
    chats,
    screenshots,
    async () => undefined,
  );

  registerPilotMetricsIpc(
    featureIpc,
    () => window,
    location,
    new PilotMetrics(cases),
    async () => false,
  );
  await accounts.refresh();
  await window.loadFile(renderer);
  return {
    window,
    accounts,
    async seedLegacy() {
      const store = await ChatStore.open(
        join(profile, 'chats'),
        'local-chats',
        encryption,
      );
      const service = new ChatService(
        {
          open() {
            throw Error('No inference');
          },
        },
        () => {},
        store,
      );
      const id = service.createLocalChat('Recovered legacy chat');
      await service.close();
      store.close();
      return id;
    },
    async seedPersonal() {
      const op = {
        ...caseOp,
        context: accounts.snapshot().context,
        signal: cases.operationSignal(),
      };
      await cases.prepare(op);
      const chatId = chats.createLocalChat('Account-owned private chat');
      await cases.create(
        {
          id: chatId,
          title: 'Account-owned private case',
          messages: [{ role: 'user', text: 'Controlled ticket #456' }],
        },
        op,
      );
      await books.save(
        undefined,
        0,
        {
          title: 'Account-owned private Playbook',
          markdown: 'Only for this account',
        },
        op,
      );
      return {
        chats: chats.snapshot().chats,
        cases: cases.snapshot().cases,
        playbooks: books.list(op),
      };
    },
    async close() {
      await accounts.close();
      await chats.close();
      personal.close();
      cases.close();
      channels.forEach((channel) => ipcMain.removeHandler(channel));
      window.destroy();
    },
  };
}
