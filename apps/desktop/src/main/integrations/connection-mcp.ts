import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  ApiAuthorization,
  ConnectionReturn,
  connectionUrl,
  redactConnection,
  type CatalogRecord,
} from './connection-oauth.ts';
import type { ConnectionProvider } from './connection-providers.ts';
import { oauthApp } from './oauth-apps.ts';
import type { OAuthBroker } from './oauth-broker.ts';

export class McpConnection {
  private record: CatalogRecord;
  private provider: ConnectionProvider;
  private save: () => Promise<void>;
  private open: (url: string) => Promise<void>;
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private returning?: ConnectionReturn;
  private authQueue = Promise.resolve();
  private failedSave = false;
  private directAuth?: ApiAuthorization;
  private broker?: OAuthBroker;
  private changed: () => void;
  get verificationCode() {
    return this.directAuth?.verificationCode;
  }
  constructor(
    provider: ConnectionProvider,
    record: CatalogRecord,
    save: () => Promise<void>,
    open: (url: string) => Promise<void>,
    changed = () => {},
    broker?: OAuthBroker,
  ) {
    this.provider = provider;
    this.record = record;
    this.save = save;
    this.open = open;
    this.changed = changed;
    this.broker = broker;
  }
  async connect(interactive: boolean) {
    const endpoint = connectionUrl(
      (this.provider.regions?.[this.record.values.region] ??
        this.provider.endpoint) ||
        this.record.values.endpoint,
      this.provider.id === 'custom-mcp',
    );
    if (
      [...endpoint.searchParams.keys()].some((key) =>
        /token|secret|password|api.?key|signature|authorization/i.test(key),
      )
    )
      throw Error(
        'Put credentials in the credential field, not the server address.',
      );
    if (this.provider.id === 'github-issues' && this.record.access === 'read')
      endpoint.pathname += '/readonly';
    if (this.provider.id === 'github-issues' && !this.record.values.key) {
      this.directAuth = new ApiAuthorization(
        this.record,
        this.save,
        this.open,
        {
          authorize: 'https://github.com/login/oauth/authorize',
          token: 'https://github.com/login/oauth/access_token',
          device: 'https://github.com/login/device/code',
          scopes: 'repo',
        },
        oauthApp('github-issues'),
        this.changed,
      );
      await this.directAuth.connect(interactive);
    }
    if (
      this.provider.managedOAuth &&
      !this.record.values.clientId &&
      !this.record.values.key
    ) {
      this.directAuth = new ApiAuthorization(
        this.record,
        this.save,
        this.open,
        {
          authorize: endpoint.href,
          token: endpoint.href,
          scopes:
            this.provider.id === 'front' && this.record.access === 'read'
              ? 'read'
              : this.provider.scopes || '',
        },
        undefined,
        this.changed,
        { id: this.provider.id, broker: this.broker },
      );
      await this.directAuth.connect(interactive);
    }
    const returning = new ConnectionReturn(
      this.record.values.redirectUri ?? this.provider.redirectUri,
    );
    this.returning = returning;
    if (interactive && !this.record.values.key && !this.directAuth)
      await returning.start();
    if (this.record.values.clientId || this.provider.oauthClientId)
      this.record.client = {
        client_id: this.record.values.clientId || this.provider.oauthClientId!,
        ...(this.record.values.clientSecret
          ? { client_secret: this.record.values.clientSecret }
          : {}),
      };
    const auth: OAuthClientProvider = {
      redirectUrl: returning.redirect.href,
      clientMetadata: {
        client_name: 'Supahelp Desktop',
        redirect_uris: [returning.redirect.href],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: this.record.values.clientSecret
          ? 'client_secret_post'
          : 'none',
        ...(this.provider.scopes ? { scope: this.provider.scopes } : {}),
      },
      state: () => returning.state,
      clientInformation: () => this.record.client,
      saveClientInformation: async (value) => {
        this.record.client = value;
        await this.save();
      },
      tokens: () => this.record.tokens,
      saveTokens: async (value) => {
        this.record.tokens = value;
        try {
          await this.save();
        } catch (error) {
          this.failedSave = true;
          throw error;
        }
      },
      saveCodeVerifier: (value) => {
        verifier = value;
      },
      codeVerifier: () => verifier,
      redirectToAuthorization: async (url) => {
        if (!interactive) throw Error('Reconnect in Settings.');
        connectionUrl(
          url.href,
          this.provider.id === 'custom-mcp' && url.origin === endpoint.origin,
        );
        await this.open(url.href);
      },
    };
    let verifier = returning.verifier;
    const options = {
      ...(this.record.values.key || this.directAuth
        ? {
            requestInit: {
              headers: {
                Authorization:
                  this.provider.id === 'pagerduty'
                    ? `Token token=${this.record.values.key}`
                    : `Bearer ${this.record.values.key || this.record.tokens?.access_token}`,
              },
            },
          }
        : { authProvider: auth }),
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = connectionUrl(
          String(input instanceof Request ? input.url : input),
          this.provider.id === 'custom-mcp',
        );
        const authorization = new Headers(init?.headers).get('Authorization');
        const client = this.record.client;
        const clientAuthentication =
          client?.client_secret &&
          authorization ===
            `Basic ${Buffer.from(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`).toString('base64')}`;
        if (
          url.origin !== endpoint.origin &&
          authorization &&
          !clientAuthentication
        )
          throw Error('Credential redirect refused.');
        if (this.directAuth && url.origin === endpoint.origin) {
          await this.directAuth.ready();
          const headers = new Headers(init?.headers);
          headers.set(
            'Authorization',
            `Bearer ${this.record.tokens!.access_token}`,
          );
          init = { ...init, headers };
        }
        const response = await fetch(input, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(20000),
          ]),
        });
        if (!response.body) return response;
        let bytes = 0;
        const body = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bytes += chunk.byteLength;
              if (bytes > 8 * 1024 * 1024)
                throw Error('MCP response is too large.');
              controller.enqueue(chunk);
            },
          }),
        );
        const bounded = new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
        Object.defineProperty(bounded, 'url', { value: response.url });
        return bounded;
      },
    };
    let client = new Client({ name: 'supahelp-desktop', version: '1.0.0' });
    let transport = new StreamableHTTPClientTransport(endpoint, options);
    this.client = client;
    this.transport = transport;
    try {
      try {
        await client.connect(transport);
      } catch (error) {
        if (
          !(error instanceof UnauthorizedError) ||
          !interactive ||
          this.directAuth
        )
          throw error;
        await transport.finishAuth(await returning.code());
        await client.close();
        client = new Client({ name: 'supahelp-desktop', version: '1.0.0' });
        transport = new StreamableHTTPClientTransport(endpoint, options);
        this.client = client;
        this.transport = transport;
        await client.connect(transport);
      }
    } finally {
      returning.close();
      this.returning = undefined;
    }
  }
  finish(value: string) {
    if (!this.returning) throw Error('No sign-in pending.');
    this.returning.complete(value);
  }
  async listTools() {
    if (!this.client) throw Error('Reconnect in Settings.');
    const tools: Tool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.client.listTools({ cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (tools.length > 2000 || (cursor && cursors.has(cursor)))
        throw Error('Invalid tool discovery.');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  }
  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    // Serialize refresh and transport requests so rotating tokens are saved first.
    const next = this.authQueue
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted();
        if (this.failedSave)
          throw Error(
            'Credentials could not be saved. Reconnect this account.',
          );
        if (!this.client) throw Error('Reconnect in Settings.');
        return CallToolResultSchema.parse(
          redactConnection(
            await this.client.callTool({ name, arguments: args }, undefined, {
              signal,
              timeout: 60000,
            }),
            this.record,
          ),
        );
      });
    this.authQueue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  async close() {
    this.directAuth?.close();
    this.returning?.cancel();
    await this.client?.close();
    await this.transport?.close();
  }
}
