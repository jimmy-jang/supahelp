import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { LinearRecord } from '../platform/linear-store';

export class LinearRemote {
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private cancel?: () => void;
  private record: LinearRecord;
  private save: () => Promise<void>;
  private openExternal: (url: string) => Promise<void>;
  private endpoint: string;
  constructor(
    record: LinearRecord,
    save: () => Promise<void>,
    openExternal: (url: string) => Promise<void>,
    endpoint = 'https://mcp.linear.app/mcp',
  ) {
    this.record = record;
    this.save = save;
    this.openExternal = openExternal;
    this.endpoint = endpoint;
  }

  async connect(interactive: boolean) {
    const state = randomBytes(32).toString('hex');
    let verifier = '';
    let complete: ((code: string) => void) | undefined;
    let fail: ((error: Error) => void) | undefined;
    const callback = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (
        url.pathname !== '/callback' ||
        url.searchParams.get('state') !== state
      ) {
        response.writeHead(400).end('Invalid sign-in callback.');
        return;
      }
      const code = url.searchParams.get('code');
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(
        code
          ? 'Return to Supahelp to finish connecting Linear.'
          : 'Linear sign-in was cancelled. Return to Supahelp.',
      );
      if (code) complete?.(code);
      else fail?.(Error('Linear sign-in was cancelled.'));
    });
    if (interactive) {
      await new Promise<void>((resolve, reject) => {
        callback.once('error', reject);
        callback.listen(0, '127.0.0.1', resolve);
      });
      const address = callback.address();
      if (!address || typeof address === 'string')
        throw Error('Linear sign-in could not start.');
      this.record.redirect = `http://127.0.0.1:${address.port}/callback`;
      delete this.record.client;
      delete this.record.tokens;
    }
    const code = interactive
      ? new Promise<string>((resolve, reject) => {
          complete = resolve;
          fail = reject;
        })
      : undefined;
    // The callback may be cancelled before the first HTTP request finishes.
    void code?.catch(() => {});
    this.cancel = () => fail?.(Error('Linear sign-in was cancelled.'));
    const timer = setTimeout(() => this.cancel?.(), 180000);
    const provider: OAuthClientProvider = {
      redirectUrl: this.record.redirect,
      clientMetadata: {
        client_name: 'Supahelp Desktop',
        redirect_uris: this.record.redirect ? [this.record.redirect] : [],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: this.record.access === 'read' ? 'read' : 'read write',
      },
      state: () => state,
      clientInformation: () => this.record.client,
      saveClientInformation: async (value) => {
        this.record.client = value;
        await this.save();
      },
      tokens: () => this.record.tokens,
      saveTokens: async (value) => {
        this.record.tokens = value;
        await this.save();
      },
      saveCodeVerifier: (value) => {
        verifier = value;
      },
      codeVerifier: () => verifier,
      redirectToAuthorization: async (url) => {
        if (!interactive) throw Error('Reconnect Linear in Settings.');
        const allowed = this.endpoint.startsWith('http://127.0.0.1:')
          ? url.origin === new URL(this.endpoint).origin
          : url.protocol === 'https:' &&
            ['linear.app', 'mcp.linear.app', 'api.linear.app'].includes(
              url.hostname,
            );
        if (!allowed || url.username || url.password)
          throw Error('Linear returned an untrusted sign-in address.');
        await this.openExternal(url.href);
      },
    };
    const endpoint = new URL(
      this.record.access === 'read'
        ? `${this.endpoint}/readonly`
        : this.endpoint,
    );
    const transportOptions: ConstructorParameters<
      typeof StreamableHTTPClientTransport
    >[1] = {
      authProvider: provider,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const allowed = this.endpoint.startsWith('http://127.0.0.1:')
          ? url.origin === new URL(this.endpoint).origin
          : url.protocol === 'https:' &&
            ['linear.app', 'mcp.linear.app', 'api.linear.app'].includes(
              url.hostname,
            );
        if (!allowed || url.username || url.password)
          throw Error('Untrusted Linear endpoint.');
        return fetch(input, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(20000),
          ]),
        });
      },
    };
    let transport = new StreamableHTTPClientTransport(
      endpoint,
      transportOptions,
    );
    this.transport = transport;
    let client = new Client({ name: 'supahelp-desktop', version: '1.0.0' });
    try {
      try {
        await client.connect(transport);
      } catch (error) {
        if (!(error instanceof UnauthorizedError) || !code) throw error;
        await transport.finishAuth(await code);
        await client.close();
        transport = new StreamableHTTPClientTransport(
          endpoint,
          transportOptions,
        );
        this.transport = transport;
        client = new Client({ name: 'supahelp-desktop', version: '1.0.0' });
        await client.connect(transport);
      }
      this.client = client;
    } finally {
      clearTimeout(timer);
      callback.close();
      callback.closeAllConnections();
      this.cancel = undefined;
    }
  }
  async listTools() {
    if (!this.client) throw Error('Reconnect Linear in Settings.');
    const tools = [];
    let cursor: string | undefined;
    do {
      const page = await this.client.listTools({ cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (tools.length > 500) throw Error('Linear returned too many tools.');
    } while (cursor);
    return tools;
  }
  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (!this.client) throw Error('Reconnect Linear in Settings.');
    const result = CallToolResultSchema.parse(
      await this.client.callTool({ name, arguments: args }, undefined, {
        signal,
        timeout: 60000,
      }),
    );
    let serialized = JSON.stringify(result);
    for (const secret of [
      this.record.tokens?.access_token,
      this.record.tokens?.refresh_token,
      this.record.client?.client_secret,
    ]) {
      if (secret)
        serialized = serialized.replaceAll(secret, '[removed secret]');
    }
    return CallToolResultSchema.parse(JSON.parse(serialized));
  }
  async close() {
    this.cancel?.();
    await this.client?.close();
    await this.transport?.close();
  }
}
