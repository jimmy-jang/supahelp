import { ModelCredentials } from '../../src/main/platform/model-credentials';
import { AccountService } from '../../src/main/features/accounts/service';
import { LocalAccess } from '../../src/main/platform/local-access';
import {
  registerAccountsIpc,
  scopedFeatureIpc,
} from '../../src/main/features/accounts/ipc';
// Test composition only: production feature/IPC/provider code with controlled external services.
import { BrowserWindow, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConnectionStore } from '../../src/main/platform/connection-store';
import type { LinearRecord } from '../../src/main/platform/linear-store';
import { LinearConnector } from '../../src/main/features/linear/service';
import { LinearRemote } from '../../src/main/integrations/linear';
import { registerLinearIpc } from '../../src/main/features/linear/ipc';
import { registerChatIpc } from '../../src/main/features/chat/ipc';
import { ChatModels } from '../../src/main/features/chat/models';
import { ChatService } from '../../src/main/features/chat/service';
import { Codex } from '../../src/main/integrations/codex';
import type { ClaudeCode } from '../../src/main/integrations/claude-code';
import { ChatResources } from '../../src/main/platform/chat-resources';
import { ZendeskConnector } from '../../src/main/features/zendesk/service';
import {
  ZendeskRemote,
  type ZendeskRecord,
} from '../../src/main/integrations/zendesk';
import { registerZendeskIpc } from '../../src/main/features/zendesk/ipc';
import { Connections } from '../../src/main/features/connections/service';
import { registerConnectionsIpc } from '../../src/main/features/connections/ipc';
import type { CatalogRecord } from '../../src/main/integrations/connection-oauth';
import { OAuthBroker } from '../../src/main/integrations/oauth-broker';
import {
  AccountApi,
  AccountApiError,
} from '../../src/main/integrations/account-api';

export async function boot(
  profile: string,
  packagedRoot: string,
  executable: string,
  endpoint: string,
  authorize: (url: string) => Promise<void>,
  zendeskEndpoint?: string,
  authorizeZendesk?: (url: string) => Promise<void>,
) {
  const window = new BrowserWindow({
    width: 1250,
    height: 850,
    title: 'Supahelp Linear E2E',
    webPreferences: {
      preload: join(packagedRoot, '.vite/build/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  let fixtureAccount: string | undefined;
  let fixtureTeam = false;
  const organizationId = 'cb7fea51-c049-4f03-a9ce-7910fd1e2aa1';
  const workspaceId = 'c6efd519-ff27-4785-bb65-470e86509b8f';
  let catalogConsents = 0;
  const accounts = new AccountService({
    auth: {
      begin: async () => {},
      cancel: () => {},
      finish: async () => {},
      token: async () => (fixtureAccount ? 'fixture-session' : undefined),
      signOut: async () => {
        fixtureAccount = undefined;
      },
      close: async () => {},
    },
    api: {
      view: async () => {
        if (!fixtureAccount) throw new AccountApiError(401, 'unauthenticated');
        return {
          account: {
            id: fixtureAccount,
            name: 'Fixture',
            email: 'fixture@example.test',
          },
          organizations: fixtureTeam
            ? [
                {
                  id: organizationId,
                  name: 'Fixture team',
                  ownerId: fixtureAccount,
                  access: 'active',
                  capacity: 5,
                  assigned: 1,
                  reserved: 0,
                },
              ]
            : [],
          workspaces: fixtureTeam
            ? [
                {
                  id: workspaceId,
                  organizationId,
                  name: 'Support',
                  role: 'member',
                },
              ]
            : [],
          onboardingCompleted: true,
        };
      },
    } as unknown as AccountApi,
    access: new LocalAccess(join(profile, 'local-access.enc'), {
      isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptStringAsync(value),
      decryptString: async (value) =>
        (await safeStorage.decryptStringAsync(value)).result,
    }),
    changed: (snapshot) =>
      window.webContents.send('accounts:changed', snapshot),
    invalidate: async () => {
      chats.refreshTools();
    },
  });
  const publish = (channel: string, snapshot: Record<string, any>) => {
    void accounts
      .scopeSnapshot(channel, snapshot)
      .then((value) => window.webContents.send(channel, value))
      .catch(() => {});
  };
  const linear = new LinearConnector(
    new ConnectionStore<LinearRecord>(join(profile, 'linear.enc'), {
      isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptStringAsync(value),
      decryptString: async (value) =>
        (await safeStorage.decryptStringAsync(value)).result,
    }),
    authorize,
    (snapshot) => publish('linear:changed', snapshot),
    (record, save, open) => new LinearRemote(record, save, open, endpoint),
  );
  const claude = {
    status: async () => ({
      state: 'missing',
      model: 'sonnet',
      message: 'Controlled test',
    }),
    models: async () => [],
  } as unknown as ClaudeCode;
  const zendesk = new ZendeskConnector(
    new ConnectionStore<ZendeskRecord>(join(profile, 'zendesk.enc'), {
      isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptStringAsync(value),
      decryptString: async (value) =>
        (await safeStorage.decryptStringAsync(value)).result,
    }),
    authorizeZendesk ?? authorize,
    (snapshot) => publish('zendesk:changed', snapshot),
    (record, save, open) =>
      new ZendeskRemote(
        record,
        save,
        open,
        zendeskEndpoint,
        zendeskEndpoint ? 0 : 49153,
      ),
    'public-client',
  );
  const connections = new Connections(
    (id) =>
      new ConnectionStore<CatalogRecord>(
        join(profile, 'connections', `${id}.enc`),
        {
          isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
          encryptString: (value) => safeStorage.encryptStringAsync(value),
          decryptString: async (value) =>
            (await safeStorage.decryptStringAsync(value)).result,
        },
      ),
    async (url) => {
      catalogConsents++;
      await authorize(url);
    },
    (snapshot) => publish('connections:changed', snapshot),
    undefined,
    undefined,
    new OAuthBroker('https://accounts.test', async () => undefined),
  );
  const credentials = new ModelCredentials(
    join(profile, 'fixture-model-credentials'),
    {
      isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
      encryptString: (v) => safeStorage.encryptStringAsync(v),
      decryptString: async (b) =>
        (await safeStorage.decryptStringAsync(b)).result,
    },
    () => null,
  );
  await credentials.set(
    'chatgpt',
    'api-key',
    'fixture-openai-api-key-not-a-real-key',
  );
  const models = new ChatModels(
    join(profile, 'models.json'),
    claude,
    new Codex(join(profile, 'codex'), executable, credentials),
    linear,
    zendesk,
    connections,
    undefined,
    undefined,
    undefined,
    credentials,
  );
  const chats = new ChatService(models, (snapshot) =>
    publish('chat:changed', snapshot),
  );
  const renderer = join(packagedRoot, '.vite/renderer/main_window/index.html');
  const location = pathToFileURL(renderer).href;
  registerAccountsIpc(ipcMain, () => window, location, accounts);
  const featureIpc = scopedFeatureIpc(
    ipcMain,
    () => window,
    location,
    accounts,
    async () => (await models.settings()).selected.provider,
    new Set(connections.snapshot().connections.map((item) => item.id)),
  );
  featureIpc.handle('cases:list', async () => ({
    ok: true,
    value: { revision: 0, cases: [] },
  }));
  registerLinearIpc(featureIpc, () => window, location, linear, chats);
  registerZendeskIpc(featureIpc, () => window, location, zendesk, chats);
  registerConnectionsIpc(
    featureIpc,
    () => window,
    location,
    connections,
    chats,
  );
  registerChatIpc({
    ipcMain: featureIpc,
    getWindow: () => window,
    location,
    provider: claude,
    chats,
    models,
    resources: new ChatResources(join(profile, 'projects.json')),
    choosePaths: async () => [],
    chooseExecutable: async () => undefined,
    openInstall: async () => {},
    openExternal: authorize,
  });
  await window.loadFile(renderer);
  return {
    window,
    linear,
    zendesk,
    connections,
    catalogConsents: () => catalogConsents,
    async setAccount(id?: string, team = false) {
      fixtureAccount = id;
      fixtureTeam = team;
      await accounts.refresh(true);
    },
    async close() {
      await chats.close();
      models.close();
      await linear.close();
      await zendesk.close();
      await connections.close();
      window.destroy();
    },
  };
}
