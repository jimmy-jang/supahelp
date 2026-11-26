import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  ConnectionAccess,
  ConnectionAction,
} from '../../contracts/connections';
import type { OAuthBroker } from './oauth-broker.ts';

// Message is safe to show: built only from the provider's own short error fields.
export class ProviderError extends Error {}
export async function providerError(response: Response, what: string) {
  let detail = '';
  try {
    const body = JSON.parse(await connectionText(response, 8000));
    const error = body?.error;
    detail = [
      typeof error === 'string' ? error : error?.status,
      body?.error_description ?? error?.message,
    ]
      .filter((part) => typeof part === 'string')
      .join(': ')
      .slice(0, 300);
  } catch {
    /* Non-JSON or oversized body: report the status alone. */
  }
  return new ProviderError(
    `${what} (HTTP ${response.status})${detail ? `: ${detail}` : '.'}`,
  );
}

export type CatalogRecord = {
  access: ConnectionAccess;
  actions: ConnectionAction[];
  values: Record<string, string>;
  tokens?: OAuthTokens;
  client?: Awaited<ReturnType<OAuthClientProvider['clientInformation']>>;
  expiresAt?: number;
  readTools?: Record<string, string>;
};
export type AuthEndpoints = {
  authorize: string;
  token: string;
  scopes: string;
  // Slack can register an HTTPS relay while completing sign-in on the local listener.
  providerRedirectUri?: string;
  pkce?: boolean;
  extra?: Record<string, string>;
  device?: string;
};

export function connectionUrl(value: string, allowLocal = false) {
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (!allowLocal &&
      (local ||
        isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
        url.hostname.endsWith('.localhost') ||
        url.hostname.endsWith('.local'))) ||
    (url.protocol !== 'https:' &&
      !(allowLocal && local && url.protocol === 'http:'))
  )
    throw Error('Use an HTTPS address, or HTTP for a local server.');
  return url;
}

export const toolFingerprint = (tool: Tool) =>
  createHash('sha256').update(JSON.stringify(tool.inputSchema)).digest('hex');

export function redactConnection(value: unknown, record: CatalogRecord) {
  const secrets = [
    record.tokens?.access_token,
    record.tokens?.refresh_token,
    record.client?.client_secret,
    ...Object.entries(record.values)
      .filter(([key]) => /secret|key/i.test(key))
      .map(([, value]) => value),
  ].filter((value): value is string => !!value);
  const text = JSON.stringify(value, (key, item) => {
    if (
      /^(attachments|credentials)$/i.test(key) ||
      (typeof item === 'string' &&
        /authorization|password|access.?token|refresh.?token|client.?secret|api.?key|^token$|^secret$|attachment_url/i.test(
          key,
        ))
    )
      return '[removed secret]';
    if (
      typeof item === 'string' &&
      /^https?:\/\//i.test(item) &&
      /[?&](token|signature|sig|x-amz-[^=]*|key)=/i.test(item)
    )
      return '[removed signed URL]';
    if (typeof item === 'string') {
      for (const secret of secrets)
        item = item
          .replaceAll(secret, '[removed secret]')
          .replaceAll(
            Buffer.from(`${secret}:X`).toString('base64'),
            '[removed secret]',
          );
    }
    return item;
  });
  return JSON.parse(text) as unknown;
}

export async function connectionText(response: Response, limit = 2000000) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw Error('Provider result is too large.');
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw Error('Provider result is too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Each pending sign-in owns its state and verifier; pasted URLs use the same checks.
export class ConnectionReturn {
  ticket?: string;
  readonly state = randomBytes(32).toString('hex');
  readonly verifier = randomBytes(32).toString('base64url');
  readonly challenge = createHash('sha256')
    .update(this.verifier)
    .digest('base64url');
  private result = Promise.withResolvers<string>();
  private server?: ReturnType<typeof createServer>;
  private timer?: ReturnType<typeof setTimeout>;
  private used = false;
  readonly redirect: URL;
  constructor(redirect = 'http://127.0.0.1:49154/callback') {
    this.redirect = connectionUrl(redirect, true);
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(this.redirect.hostname) ||
      this.redirect.search
    )
      throw Error('Register a loopback return address on this device.');
    void this.result.promise.catch(() => {});
  }
  async start() {
    this.timer = setTimeout(() => this.cancel(), 180000);
    if (this.redirect.protocol === 'https:') return;
    this.server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      try {
        this.complete(new URL(request.url ?? '', this.redirect.origin).href);
        response.end('Return to Supahelp. You can close this tab.');
      } catch {
        response.writeHead(400).end('Invalid or expired sign-in response.');
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(
        Number(this.redirect.port) || 80,
        this.redirect.hostname === '[::1]' ? '::1' : '127.0.0.1',
        resolve,
      );
    });
  }
  complete(value: string) {
    const url = new URL(value);
    if (
      this.used ||
      url.origin !== this.redirect.origin ||
      url.pathname !== this.redirect.pathname ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.getAll('state').length !== 1 ||
      url.searchParams.get('state') !== this.state
    )
      throw Error('Invalid sign-in return.');
    if (url.searchParams.has('error')) {
      // The caller closes the listener after the browser response is written.
      const errors = url.searchParams.getAll('error');
      this.rejectReturn(
        errors.length === 1 && errors[0] === 'OAUTH_EC_APP_NOT_FOUND'
          ? new ProviderError(
              'Salesforce says the Supahelp External Client App is not installed in this org. Ask your Salesforce admin to check the app installation for this My Domain.',
            )
          : undefined,
      );
      return;
    }
    const code = url.searchParams.get('code');
    if (
      !code ||
      code.length > 8192 ||
      url.searchParams.getAll('code').length !== 1
    )
      throw Error('Invalid sign-in code.');
    this.used = true;
    const ticket = url.searchParams.get('ticket');
    if (
      ticket &&
      ticket.length <= 8192 &&
      url.searchParams.getAll('ticket').length === 1
    )
      this.ticket = ticket;
    this.result.resolve(code);
  }
  code() {
    return this.result.promise;
  }
  cancel() {
    this.rejectReturn();
    this.close();
  }
  private rejectReturn(error = Error('Sign-in cancelled or timed out.')) {
    this.used = true;
    this.result.reject(error);
  }
  close() {
    clearTimeout(this.timer);
    this.server?.close();
    this.server?.closeAllConnections();
  }
}

export class ApiAuthorization {
  private managed?: { id: string; broker?: OAuthBroker };
  verificationCode?: string;
  private deviceAbort = new AbortController();
  private credentials: {
    clientId: string;
    clientSecret?: string;
    redirectUri?: string;
  };
  private changed: () => void;
  private record: CatalogRecord;
  private save: () => Promise<void>;
  private open: (url: string) => Promise<void>;
  private endpoints: AuthEndpoints;
  private returning?: ConnectionReturn;
  private refresh?: Promise<void>;
  private failedRefresh = false;
  constructor(
    record: CatalogRecord,
    save: () => Promise<void>,
    open: (url: string) => Promise<void>,
    endpoints: AuthEndpoints,
    credentials: {
      clientId: string;
      clientSecret?: string;
      redirectUri?: string;
    } = {
      clientId: record.values.clientId,
      clientSecret: record.values.clientSecret,
    },
    changed = () => {},
    managed?: { id: string; broker?: OAuthBroker },
  ) {
    this.record = record;
    this.save = save;
    this.open = open;
    this.endpoints = endpoints;
    this.credentials = credentials;
    this.changed = changed;
    this.managed = managed;
  }
  async connect(interactive: boolean) {
    if (!interactive) {
      await this.ready();
      return;
    }
    if (this.endpoints.device) {
      await this.connectDevice();
      return;
    }
    const returning = new ConnectionReturn(
      this.credentials.redirectUri ?? this.record.values.redirectUri,
    );
    this.returning = returning;
    try {
      await returning.start();
      const providerRedirectUri =
        this.endpoints.providerRedirectUri ?? returning.redirect.href;
      const url = connectionUrl(this.endpoints.authorize);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: this.credentials.clientId,
        redirect_uri: providerRedirectUri,
        scope: this.endpoints.scopes,
        state: returning.state,
        ...(this.endpoints.pkce === false
          ? {}
          : {
              code_challenge: returning.challenge,
              code_challenge_method: 'S256',
            }),
        ...this.endpoints.extra,
      }).toString();
      await this.open(
        this.managed
          ? await this.broker().authorize(
              this.managed.id,
              this.record.values,
              Object.fromEntries(url.searchParams),
              this.deviceAbort.signal,
            )
          : url.href,
      );
      await this.exchange({
        grant_type: 'authorization_code',
        code: await returning.code(),
        redirect_uri: providerRedirectUri,
        ...(this.endpoints.pkce === false
          ? {}
          : { code_verifier: returning.verifier }),
      });
    } finally {
      returning.close();
      this.returning = undefined;
    }
  }
  finish(value: string) {
    if (!this.returning) throw Error('No sign-in is pending.');
    this.returning.complete(value);
  }
  private async connectDevice() {
    const response = await fetch(connectionUrl(this.endpoints.device!), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([
        this.deviceAbort.signal,
        AbortSignal.timeout(20000),
      ]),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        scope: this.endpoints.scopes,
      }),
    });
    if (!response.ok) throw Error('GitHub sign-in could not start.');
    const device = JSON.parse(await connectionText(response, 64000));
    if (
      typeof device.device_code !== 'string' ||
      !device.device_code ||
      device.device_code.length > 1024 ||
      typeof device.user_code !== 'string' ||
      !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(device.user_code) ||
      device.verification_uri !== 'https://github.com/login/device' ||
      !Number.isInteger(device.expires_in) ||
      device.expires_in < 1 ||
      device.expires_in > 900 ||
      !Number.isInteger(device.interval) ||
      device.interval < 1 ||
      device.interval > 60
    )
      throw Error('GitHub returned an invalid sign-in response.');
    const deadline = Date.now() + device.expires_in * 1000;
    let interval = device.interval * 1000;
    this.verificationCode = device.user_code;
    this.changed();
    try {
      await this.open(device.verification_uri);
      while (Date.now() < deadline) {
        await delay(Math.min(interval, deadline - Date.now()), undefined, {
          signal: this.deviceAbort.signal,
        });
        if (Date.now() >= deadline) break;
        const result = await this.exchange({
          client_id: this.credentials.clientId,
          device_code: device.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        });
        if (!result) return;
        if (result === 'slow_down') interval += 5000;
      }
      throw Error('GitHub sign-in expired. Click Connect to try again.');
    } finally {
      this.verificationCode = undefined;
      this.changed();
    }
  }
  private async exchange(parameters: Record<string, string>) {
    let body: Record<string, unknown>;
    if (this.managed) {
      body = await this.broker().exchange(
        this.managed.id,
        this.record.values,
        {
          ...parameters,
          ...(this.returning?.ticket ? { ticket: this.returning.ticket } : {}),
        },
        this.deviceAbort.signal,
      );
    } else {
      const response = await fetch(connectionUrl(this.endpoints.token), {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([
          this.deviceAbort.signal,
          AbortSignal.timeout(20000),
        ]),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: this.credentials.clientId,
          ...(this.credentials.clientSecret
            ? { client_secret: this.credentials.clientSecret }
            : {}),
          ...parameters,
        }),
      });
      if (!response.ok)
        throw await providerError(
          response,
          'The provider rejected the sign-in',
        );
      body = JSON.parse(await connectionText(response, 64000)) as Record<
        string,
        unknown
      >;
    }
    if (
      parameters.grant_type ===
        'urn:ietf:params:oauth:grant-type:device_code' &&
      this.endpoints.device &&
      (body.error === 'authorization_pending' || body.error === 'slow_down')
    )
      return body.error;
    const value = (body.authed_user ?? body) as Record<string, unknown>;
    const token = value.access_token ?? value.token;
    if (typeof token !== 'string' || !token || body.error)
      throw Error('The provider did not return a token.');
    const previous = this.record.tokens;
    this.record.tokens = {
      access_token: token,
      token_type: 'Bearer',
      ...(typeof value.refresh_token === 'string'
        ? { refresh_token: value.refresh_token }
        : previous?.refresh_token
          ? { refresh_token: previous.refresh_token }
          : {}),
      ...(typeof value.scope === 'string' ? { scope: value.scope } : {}),
      ...(typeof value.expires_in === 'number'
        ? { expires_in: value.expires_in }
        : {}),
    };
    this.record.expiresAt =
      typeof value.expires_in === 'number'
        ? Date.now() + value.expires_in * 1000
        : undefined;
    if (typeof body.instance_url === 'string') {
      const instance = connectionUrl(body.instance_url);
      if (!instance.hostname.endsWith('.salesforce.com'))
        throw Error('Invalid Salesforce instance.');
      this.record.values.instance = instance.origin;
    }
    try {
      await this.save();
      this.failedRefresh = false;
    } catch (error) {
      this.failedRefresh = true;
      throw error;
    }
  }
  async ready() {
    if (this.failedRefresh)
      throw Error('Credentials could not be saved. Reconnect this account.');
    if (this.refresh) {
      await this.refresh;
      return;
    }
    if (!this.record.tokens) throw Error('Reconnect this account.');
    if (this.record.expiresAt && this.record.expiresAt < Date.now() + 60000) {
      if (!this.record.tokens.refresh_token)
        throw Error('Sign in again to renew access.');
      this.refresh ??= this.exchange({
        grant_type: 'refresh_token',
        refresh_token: this.record.tokens.refresh_token,
      })
        .then(() => {})
        .finally(() => {
          this.refresh = undefined;
        });
      await this.refresh;
    }
  }
  private broker() {
    if (!this.managed?.broker)
      throw Error(
        'Sign in to Supahelp to use this connection. Supahelp’s integration must be configured on the account service.',
      );
    return this.managed.broker;
  }
  close() {
    this.deviceAbort.abort();
    this.returning?.cancel();
  }
}
