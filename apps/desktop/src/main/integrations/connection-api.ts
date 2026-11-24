import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Operation } from './connection-api/operations.ts';
import { configureProvider } from './connection-api/providers.ts';
import { stripeChange, verifyStripe } from './connection-api/stripe-actions.ts';
import {
  ApiAuthorization,
  connectionText,
  connectionUrl,
  providerError,
  redactConnection,
  type CatalogRecord,
} from './connection-oauth.ts';
import type { ConnectionProvider } from './connection-providers.ts';
import { oauthApp } from './oauth-apps.ts';
import type { OAuthBroker } from './oauth-broker.ts';

export class ApiConnection {
  private provider: ConnectionProvider;
  private record: CatalogRecord;
  private auth?: ApiAuthorization;
  private base: string;
  private headers: Record<string, string> = {};
  private operations: Operation[] = [];
  private account?: string;
  private actorId?: string;
  constructor(
    provider: ConnectionProvider,
    record: CatalogRecord,
    save: () => Promise<void>,
    open: (url: string) => Promise<void>,
    broker?: OAuthBroker,
  ) {
    this.provider = provider;
    this.record = record;
    this.base = '';
    const configured = configureProvider(provider, record, () => this.actorId);
    this.base = configured.base;
    this.headers = configured.headers;
    this.operations = configured.operations;
    const endpoints = configured.endpoints;
    if (endpoints)
      this.auth = new ApiAuthorization(
        record,
        save,
        open,
        endpoints,
        !record.values.clientId && provider.id === 'google-drive'
          ? oauthApp('google-drive')
          : !record.values.clientId && provider.id === 'slack'
            ? {
                ...oauthApp('slack'),
                redirectUri: 'http://localhost:49154/callback',
              }
            : !record.values.clientId && provider.id === 'teams'
              ? oauthApp('teams')
              : !record.values.clientId && provider.id.startsWith('salesforce')
                ? {
                    ...oauthApp('salesforce'),
                    // Salesforce rejects http://127.0.0.1 callbacks; only localhost
                    // is accepted for the external client app's loopback return.
                    redirectUri: 'http://localhost:49154/callback',
                  }
                : undefined,
        undefined,
        !record.values.clientId &&
          ['intercom', 'helpscout', 'zoho-desk', 'stripe'].includes(
            provider.id,
          ) &&
          !record.values.key
          ? { id: provider.id, broker }
          : undefined,
      );
  }
  async connect(interactive: boolean) {
    await this.auth?.connect(interactive);
    if (
      this.provider.id.startsWith('salesforce') &&
      this.record.values.instance
    )
      this.base = `${this.record.values.instance}/services/data/v64.0`;
    const identity: Record<string, string> = {
      intercom: '/me',
      helpscout: '/users/me',
      freshdesk: '/agents/me',
      'zoho-desk': '/myinfo',
      shortcut: '/member',
      gitbook: '/user',
      'google-drive': '/drive/v3/about?fields=user',
      slack: '/auth.test',
      teams: '/me',
      stripe: '/account',
    };
    if (identity[this.provider.id]) {
      const result = await this.request('GET', identity[this.provider.id]);
      const v = result as Record<string, unknown>;
      if (this.provider.id === 'intercom') {
        if (typeof v.id !== 'number' && typeof v.id !== 'string')
          throw Error('The acting Intercom admin could not be identified.');
        this.actorId = String(v.id);
      }
      this.account =
        typeof v.name === 'string'
          ? v.name
          : typeof v.user === 'string'
            ? v.user
            : undefined;
      if (this.provider.id !== 'stripe') {
        const user =
          v.user && typeof v.user === 'object'
            ? (v.user as Record<string, unknown>)
            : {};
        const app =
          v.app && typeof v.app === 'object'
            ? (v.app as Record<string, unknown>)
            : {};
        const actor = [
          v.displayName,
          v.email,
          user.emailAddress,
          user.displayName,
          user.name,
          this.account,
        ].find((value) => typeof value === 'string');
        const target =
          this.provider.id === 'teams'
            ? `${this.record.values.tenant} · team ${this.record.values.teamId} · channel ${this.record.values.channelId}`
            : (v.team_id ??
              app.id ??
              this.record.values.site ??
              this.record.values.orgId ??
              this.record.values.spaceId ??
              this.provider.name);
        this.account = `${target}${actor ? ` · ${actor}` : ''}`.slice(0, 500);
      }
      if (this.provider.id === 'stripe') {
        if (typeof v.id !== 'string' || !v.id.startsWith('acct_'))
          throw Error('Stripe account identity was not returned.');
        this.account = `${v.id} · ${this.record.values.environment}`;
      }
    } else if (this.provider.id.startsWith('salesforce'))
      await this.request('GET', '/limits');
    if (this.provider.id.startsWith('salesforce'))
      this.account = this.record.values.instance || this.record.values.site;
    // Custom APIs have no universal identity endpoint; validate their declared schema locally.
    return this.account;
  }
  listTools() {
    return Promise.resolve(
      this.operations.map(
        ({
          method: _method,
          path: _path,
          body: _body,
          query: _query,
          raw: _raw,
          ...tool
        }) => tool,
      ),
    );
  }
  finish(value: string) {
    if (!this.auth) throw Error('No OAuth sign-in pending.');
    this.auth.finish(value);
  }
  private async request(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    extraHeaders: Record<string, string> = {},
  ) {
    await this.auth?.ready();
    const base = connectionUrl(this.base, this.provider.id === 'custom-api');
    const url = new URL(`${this.base}${path}`);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')
    )
      throw Error('Operation left the selected API.');
    const response = await fetch(url, {
      method,
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        ...this.headers,
        ...(this.auth
          ? { Authorization: `Bearer ${this.record.tokens!.access_token}` }
          : {}),
        ...(body === undefined
          ? {}
          : {
              'Content-Type':
                this.provider.id === 'stripe'
                  ? 'application/x-www-form-urlencoded'
                  : 'application/json',
            }),
        ...extraHeaders,
      },
      ...(body === undefined
        ? {}
        : {
            body:
              typeof body === 'string'
                ? body
                : this.provider.id === 'stripe'
                  ? new URLSearchParams(
                      Object.entries(body as Record<string, unknown>).map(
                        ([key, value]) => [key, String(value)],
                      ),
                    )
                  : JSON.stringify(body),
          }),
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(30000),
      ]),
    });
    if (!response.ok)
      throw await providerError(response, 'The provider rejected the request');
    const text = await connectionText(response);
    const value: unknown =
      text && response.headers.get('content-type')?.includes('json')
        ? JSON.parse(text)
        : text;
    if (
      this.provider.id === 'slack' &&
      (!value ||
        typeof value !== 'object' ||
        !('ok' in value) ||
        value.ok !== true)
    )
      throw Error('The provider rejected the operation.');
    return redactConnection(value, this.record);
  }
  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const op = this.operations.find((item) => item.name === name);
    if (!op) throw Error('Tool unavailable.');
    if (this.provider.id === 'helpscout' && name === 'reply_to_customer') {
      const conversation = (await this.request(
        'GET',
        `/conversations/${encodeURIComponent(String(args.id))}`,
        undefined,
        signal,
      )) as { primaryCustomer?: { id?: number } };
      if (conversation.primaryCustomer?.id !== args.customer_id)
        throw Error(
          'The conversation customer changed. Read it again before replying.',
        );
    }
    if (this.provider.id === 'stripe' && op.annotations?.readOnlyHint !== true)
      return stripeChange(
        this.request.bind(this),
        this.record,
        name,
        args,
        signal,
      );
    const path = op.path.replace(/\{(\w+)\}/g, (_match, key: string) => {
      if (
        typeof args[key] !== 'string' ||
        !args[key] ||
        args[key] === '.' ||
        args[key] === '..'
      )
        throw Error('Invalid target ID.');
      return encodeURIComponent(args[key]);
    });
    const parameters = op.query?.(args);
    const body = Object.fromEntries(
      Object.entries(args).filter(([key]) => !op.path.includes(`{${key}}`)),
    );
    const raw = op.raw?.(args);
    let value = await this.request(
      op.method,
      path +
        (parameters && Object.keys(parameters).length
          ? `?${new URLSearchParams(parameters)}`
          : ''),
      op.method === 'GET'
        ? undefined
        : raw
          ? raw.body
          : op.body
            ? op.body(args)
            : body,
      signal,
      raw ? { 'Content-Type': raw.type } : {},
    );
    if (this.provider.id === 'helpscout' && name === 'search_customers') {
      const result = value as {
        _embedded?: {
          customers?: {
            id: number;
            firstName?: string;
            lastName?: string;
            _embedded?: { emails?: { value: string }[] };
          }[];
        };
        page?: { number: number; totalPages: number };
      };
      value = {
        customers: (result._embedded?.customers ?? []).map((customer) => ({
          id: customer.id,
          name: [customer.firstName, customer.lastName]
            .filter(Boolean)
            .join(' '),
          emails: customer._embedded?.emails?.map((email) => email.value) ?? [],
        })),
        page: result.page?.number ?? 1,
        has_more: !!result.page && result.page.number < result.page.totalPages,
      };
    }
    return CallToolResultSchema.parse({
      content: [{ type: 'text', text: JSON.stringify(value) }],
    });
  }
  async verify(
    name: string,
    result: { content: { type: string; text?: string }[] },
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    if (this.provider.id === 'stripe')
      return verifyStripe(this.request.bind(this), name, result, args, signal);
  }
  close() {
    this.auth?.close();
    return Promise.resolve();
  }
}
