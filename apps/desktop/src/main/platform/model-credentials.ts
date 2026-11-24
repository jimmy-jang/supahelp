import type { ProviderId } from '../../contracts/chat';
import type { Encryption } from './auth-store';
import { ConnectionStore } from './connection-store.ts';

export function assertSubscriptionEnabled() {
  if (process.env.SUPAHELP_DISABLE_SUBSCRIPTIONS === '1')
    throw Error('subscription-tests-disabled');
}

type Credential = {
  access: 'read';
  actions: [];
  owner: string | null;
  mode: 'subscription' | 'api-key' | 'disconnected';
  key?: string;
};

export function isApiKey(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{20,4096}$/.test(value);
}

// One local credential per provider; replacing it never changes a shared workspace.
export class ModelCredentials {
  private stores: Record<ProviderId, ConnectionStore<Credential>>;
  private principal: () => string | null;
  constructor(
    directory: string,
    encryption: Encryption,
    principal: () => string | null,
  ) {
    this.principal = principal;
    this.stores = {
      claude: new ConnectionStore(`${directory}/claude.enc`, encryption),
      chatgpt: new ConnectionStore(`${directory}/chatgpt.enc`, encryption),
    };
  }
  async get(provider: ProviderId): Promise<Pick<Credential, 'mode' | 'key'>> {
    const owner = this.principal();
    const value = await this.stores[provider].load();
    if (owner !== this.principal()) throw Error('account-access');
    if (!value) return { mode: 'subscription' };
    if (value.owner !== owner) return { mode: 'disconnected' };
    if (
      !['subscription', 'api-key', 'disconnected'].includes(value.mode) ||
      (value.mode === 'api-key' && !isApiKey(value.key))
    )
      throw Error('model-credentials');
    return {
      mode: value.mode,
      ...(value.mode === 'api-key' ? { key: value.key } : {}),
    };
  }
  async set(provider: ProviderId, mode: Credential['mode'], key?: string) {
    if (mode === 'api-key' && !isApiKey(key)) throw Error('invalid-api-key');
    const owner = this.principal();
    await this.stores[provider].save({
      access: 'read',
      actions: [],
      owner,
      mode,
      ...(mode === 'api-key' ? { key } : {}),
    });
    if (owner !== this.principal()) throw Error('account-access');
  }
}
