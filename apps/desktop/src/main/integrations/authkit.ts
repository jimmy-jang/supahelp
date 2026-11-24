import type { AuthenticationResponse, PublicWorkOS } from '@workos-inc/node';
import { WorkOS } from '@workos-inc/node';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { parseAppLink } from '../features/accounts/links.ts';
import type { AuthStore, StoredSession } from '../platform/auth-store.ts';

export class AuthKit {
  private sdk: Pick<PublicWorkOS, 'pkce' | 'userManagement'>;
  private store: Pick<AuthStore, 'load' | 'save' | 'clear' | 'assertAvailable'>;
  private openExternal: (url: string) => Promise<void>;
  private logout?: (token: string) => Promise<void>;
  private now: () => number;
  private session?: StoredSession;
  private pending?: { verifier: string; state: string; expiresAt: number };
  private generation = 0;
  private loaded: Promise<void>;
  private loadError = false;
  private refreshing?: Promise<void>;
  constructor(options: {
    clientId: string;
    store: Pick<AuthStore, 'load' | 'save' | 'clear' | 'assertAvailable'>;
    openExternal: (url: string) => Promise<void>;
    logout?: (token: string) => Promise<void>;
    fetch?: typeof fetch;
    now?: () => number;
  }) {
    if (process.env.WORKOS_API_KEY)
      throw Error(
        'Desktop account sign-in cannot use server credentials. Remove the WorkOS server key from its environment.',
      );
    if (!/^client_[A-Za-z0-9]+$/.test(options.clientId))
      throw Error('Supahelp account sign-in is not configured.');
    this.sdk = new WorkOS({
      clientId: options.clientId,
      ...(options.fetch ? { fetchFn: options.fetch } : {}),
      timeout: 10_000,
      maxRetries: 0,
    });
    this.store = options.store;
    this.openExternal = options.openExternal;
    this.logout = options.logout;
    this.now = options.now ?? Date.now;
    this.loaded = this.store
      .load()
      .then((session) => {
        this.session = session;
      })
      .catch(() => {
        this.loadError = true;
      });
  }
  async begin(): Promise<void> {
    await this.loaded;
    await this.store.assertAvailable();
    await this.refreshing?.catch(() => {});
    if (this.loadError) {
      await this.store.clear();
      this.loadError = false;
    }
    const generation = ++this.generation;
    const { codeVerifier, codeChallenge } = await this.sdk.pkce.generate();
    if (generation !== this.generation) return;
    const state = randomBytes(32).toString('base64url');
    this.pending = {
      verifier: codeVerifier,
      state,
      expiresAt: this.now() + 600_000,
    };
    try {
      await this.openExternal(
        this.sdk.userManagement.getAuthorizationUrl({
          provider: 'authkit',
          // The web relay at this URL forwards the code to supahelp://auth/callback.
          redirectUri: 'https://www.supahelp.app/auth/callback',
          state,
          codeChallenge,
          codeChallengeMethod: 'S256',
        }),
      );
    } catch {
      this.cancel();
      throw Error('Sign-in could not open. Try again.');
    }
  }
  cancel(): void {
    this.generation++;
    this.pending = undefined;
  }
  async finish(value: string): Promise<void> {
    await this.loaded;
    const link = parseAppLink(value),
      pending = this.pending;
    if (
      !pending ||
      link?.kind !== 'auth' ||
      pending.expiresAt <= this.now() ||
      link.state.length !== pending.state.length ||
      !timingSafeEqual(Buffer.from(link.state), Buffer.from(pending.state))
    )
      throw Error('This sign-in has expired or does not match. Start again.');
    this.pending = undefined;
    const generation = this.generation;
    if (!link.code) throw Error('Sign-in was canceled.');
    try {
      const response =
        await this.sdk.userManagement.authenticateWithCodeAndVerifier({
          code: link.code,
          codeVerifier: pending.verifier,
        });
      await this.persist(response, generation);
    } catch {
      throw Error('Sign-in could not be completed. Try again.');
    }
  }
  private record(response: AuthenticationResponse): StoredSession {
    // Claims schedule refresh only. The cloud API verifies identity and permissions.
    let payload;
    try {
      payload = JSON.parse(
        Buffer.from(response.accessToken.split('.')[1], 'base64url').toString(),
      );
    } catch {
      throw Error('Invalid account response.');
    }
    if (
      response.user.emailVerified !== true ||
      payload.sub !== response.user.id ||
      typeof payload.sid !== 'string' ||
      !Number.isSafeInteger(payload.exp) ||
      typeof response.refreshToken !== 'string' ||
      !response.refreshToken
    )
      throw Error('Invalid account response.');
    return {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      subject: response.user.id,
      sessionId: payload.sid,
      expiresAt: payload.exp * 1000,
    };
  }
  private async persist(response: AuthenticationResponse, generation: number) {
    if (generation !== this.generation) return;
    const next = this.record(response);
    await this.store.save(next);
    if (generation === this.generation) this.session = next;
  }
  async cachedSubject(): Promise<string | undefined> {
    await this.loaded;
    return this.loadError || this.pending ? undefined : this.session?.subject;
  }
  async token(signal: AbortSignal): Promise<string | undefined> {
    await this.loaded;
    signal.throwIfAborted();
    if (this.loadError)
      throw Error('Account credentials could not be read. Sign in again.');
    if (this.pending || !this.session) return;
    if (this.session.expiresAt <= this.now() + 10_000) {
      if (!this.refreshing)
        this.refreshing = this.refresh().finally(() => {
          this.refreshing = undefined;
        });
      await this.refreshing;
    }
    signal.throwIfAborted();
    return this.session?.accessToken;
  }
  private async refresh() {
    const previous = this.session,
      generation = this.generation;
    if (!previous) return;
    try {
      const response =
        await this.sdk.userManagement.authenticateWithRefreshToken({
          refreshToken: previous.refreshToken,
        });
      if (response.user.id !== previous.subject)
        throw Error('Account identity changed during refresh.');
      await this.persist(response, generation);
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error
          ? error.status
          : undefined;
      if (
        generation === this.generation &&
        [400, 401, 403].includes(Number(status))
      ) {
        this.session = undefined;
        await this.store.clear();
      }
      throw Object.assign(
        Error('Account sign-in could not refresh. Try again or reconnect.'),
        {
          code: [400, 401, 403].includes(Number(status))
            ? 'account-session-revoked'
            : 'account-session-unavailable',
        },
      );
    }
  }
  async signOut(): Promise<void> {
    await this.loaded;
    const previous = this.session;
    this.cancel();
    this.session = undefined;
    this.loadError = false;
    let failed = false;
    try {
      await this.store.clear();
    } catch {
      failed = true;
    }
    if (previous && this.logout) {
      try {
        await this.logout(previous.accessToken);
      } catch {
        failed = true;
      }
    }
    if (failed)
      throw Error(
        'Sign-out could not be fully confirmed. Account access on this computer has stopped.',
      );
  }
  async close(): Promise<void> {
    this.cancel();
    await this.refreshing?.catch(() => {});
  }
}
