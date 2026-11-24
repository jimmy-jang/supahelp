import { connectionText, connectionUrl } from './connection-oauth.ts';

export class OAuthBrokerError extends Error {
  readonly code: 'sign-in-required' | 'unavailable';
  constructor(code: 'sign-in-required' | 'unavailable') {
    super(
      code === 'sign-in-required'
        ? 'Sign in to Supahelp to connect this service.'
        : 'Supahelp could not authorize this connection. Try again later.',
    );
    this.code = code;
  }
}

export class OAuthBroker {
  private origin: string;
  private token: (signal: AbortSignal) => Promise<string | undefined>;
  constructor(
    origin: string,
    token: (signal: AbortSignal) => Promise<string | undefined>,
    allowLoopback = false,
  ) {
    const url = connectionUrl(origin, allowLoopback);
    if (url.pathname !== '/' || url.search)
      throw Error('Configure the Supahelp account API origin.');
    this.origin = url.origin;
    this.token = token;
  }
  async requireSignIn(signal: AbortSignal) {
    try {
      const token = await this.token(signal);
      if (!token) throw new OAuthBrokerError('sign-in-required');
      return token;
    } catch (error) {
      if (error instanceof OAuthBrokerError) throw error;
      throw new OAuthBrokerError('unavailable');
    }
  }
  private async call(
    id: string,
    action: string,
    values: Record<string, string>,
    parameters: Record<string, string>,
    signal: AbortSignal,
  ) {
    if (!/^[a-z-]+$/.test(id)) throw Error('Invalid OAuth provider.');
    const token = await this.requireSignIn(signal);
    try {
      const response = await fetch(`${this.origin}/v1/oauth/${id}/${action}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          region: values.region,
          environment: values.environment,
          parameters,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new OAuthBrokerError(
          response.status === 401 ? 'sign-in-required' : 'unavailable',
        );
      }
      const body = JSON.parse(await connectionText(response, 64000));
      if (body.ok !== true || !body.value || typeof body.value !== 'object')
        throw new OAuthBrokerError('unavailable');
      return body.value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof OAuthBrokerError) throw error;
      throw new OAuthBrokerError('unavailable');
    }
  }
  async authorize(
    id: string,
    values: Record<string, string>,
    parameters: Record<string, string>,
    signal: AbortSignal,
  ) {
    const result = await this.call(id, 'authorize', values, parameters, signal);
    if (typeof result.url !== 'string')
      throw Error('Invalid OAuth authorization response.');
    const url = connectionUrl(result.url);
    const hosts: Record<string, string[]> = {
      intercom: [
        'app.intercom.com',
        'app.eu.intercom.com',
        'app.au.intercom.com',
      ],
      helpscout: ['secure.helpscout.net'],
      front: ['app.frontapp.com'],
      hubspot: ['mcp.hubspot.com'],
      'hubspot-service': ['mcp.hubspot.com'],
      'zoho-desk': [
        'accounts.zoho.com',
        'accounts.zoho.eu',
        'accounts.zoho.com.au',
        'accounts.zoho.in',
        'accounts.zoho.jp',
        'accounts.zohocloud.ca',
      ],
      stripe: ['marketplace.stripe.com'],
    };
    if (!hosts[id]?.includes(url.hostname) || url.port)
      throw Error('Invalid OAuth authorization host.');
    return url.href;
  }
  exchange(
    id: string,
    values: Record<string, string>,
    parameters: Record<string, string>,
    signal: AbortSignal,
  ) {
    return this.call(id, 'token', values, parameters, signal);
  }
}
