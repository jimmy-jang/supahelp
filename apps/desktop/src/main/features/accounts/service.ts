import { randomUUID } from 'node:crypto';
import type {
  AccountSnapshot,
  AccountView,
  ActiveContext,
  BillingRequest,
  ContextStamp,
} from '../../../contracts/accounts.ts';
import { AccountApi, AccountApiError } from '../../integrations/account-api.ts';
import type { AuthKit } from '../../integrations/authkit.ts';
import type { LocalAccess } from '../../platform/local-access.ts';
import { parseAppLink } from './links.ts';

const changedContext = () =>
  Error('The account or workspace changed. Try again.');
export class AccountService {
  private auth?: Pick<
    AuthKit,
    'begin' | 'cancel' | 'finish' | 'token' | 'signOut' | 'close'
  > &
    Partial<Pick<AuthKit, 'cachedSubject'>>;
  private api?: AccountApi;
  private access: Pick<LocalAccess, 'allows' | 'block' | 'bindAfterConnection'>;
  private changed: (snapshot: AccountSnapshot) => void;
  private invalidate: (
    context: ContextStamp,
    keepModelLogin: boolean,
  ) => Promise<void>;
  private saveExport?: (data: string) => Promise<boolean>;
  private requests = new AbortController();
  private cleanup: Promise<void> = Promise.resolve();
  private switching = false;
  private authenticationChanging = false;
  private authenticationEpoch = 0;
  // `found`: discovered by email after sign-in (not from a link), so it ends with the session.
  private pending?: { id: string; token: string; found?: boolean };
  private rosterRequest = 0;
  private refreshRequest = 0;
  private projections = new Map<string, { raw: number; revision: number }>();
  private attempts = new Map<
    string,
    { id: string; generation: number; accountId: string | null; done: boolean }
  >();
  private cache?: import('../../platform/account-cache').AccountCache;
  private state: AccountSnapshot = {
    revision: 0,
    context: { generation: 0, accountId: null, context: { kind: 'personal' } },
    status: 'signed-out',
    view: null,
    members: [],
    invitations: [],
  };
  constructor(options: {
    auth?: AccountService['auth'];
    cache?: import('../../platform/account-cache').AccountCache;
    api?: AccountApi;
    access: AccountService['access'];
    changed: (snapshot: AccountSnapshot) => void;
    invalidate: AccountService['invalidate'];
    saveExport?: (data: string) => Promise<boolean>;
  }) {
    this.auth = options.auth;
    this.cache = options.cache;
    this.api = options.api;
    this.access = options.access;
    this.changed = options.changed;
    this.invalidate = options.invalidate;
    this.saveExport = options.saveExport;
    if (!this.auth || !this.api)
      this.state.error = {
        code: 'not-configured',
        message:
          'Account sign-in is not configured yet. Personal work is available on this computer.',
      };
  }
  async settled() {
    await this.cleanup;
  }
  snapshot(): AccountSnapshot {
    const snapshot = structuredClone(this.state);
    if (snapshot.view?.account.id !== snapshot.context.accountId)
      snapshot.view = null;
    return snapshot;
  }
  generation(): number {
    return this.state.context.generation;
  }
  authenticationGeneration(): number {
    return this.authenticationEpoch;
  }
  principal(): string | null {
    return this.state.context.accountId;
  }
  assertCurrentContext(input: unknown) {
    const stamp = input as ContextStamp | undefined;
    const current = this.state.context;
    if (
      !stamp ||
      typeof stamp !== 'object' ||
      Array.isArray(stamp) ||
      Object.keys(stamp).sort().join(',') !== 'accountId,context,generation' ||
      this.switching ||
      this.state.status === 'signing-in' ||
      stamp.generation !== current.generation ||
      stamp.accountId !== current.accountId ||
      !stamp.context ||
      typeof stamp.context !== 'object' ||
      Array.isArray(stamp.context) ||
      stamp.context.kind !== current.context.kind ||
      (stamp.context.kind === 'personal' &&
        Object.keys(stamp.context).length !== 1) ||
      (stamp.context.kind === 'team' &&
        (Object.keys(stamp.context).sort().join(',') !==
          'kind,organizationId,workspaceId' ||
          current.context.kind !== 'team' ||
          stamp.context.organizationId !== current.context.organizationId ||
          stamp.context.workspaceId !== current.context.workspaceId))
    )
      throw Error('case-context');
  }
  recovery?: {
    available(): Promise<boolean>;
    restore(accountId: string, guard: () => void): Promise<void>;
  };
  async previousWork() {
    return { available: (await this.recovery?.available()) ?? false };
  }
  async recoverPersonal() {
    this.readyApi();
    if (this.state.status !== 'ready') throw changedContext();
    const accountId = this.principal();
    if (
      !accountId ||
      this.state.context.context.kind !== 'personal' ||
      !this.recovery
    )
      throw changedContext();
    const generation = this.generation() + 1;
    await this.transition({ kind: 'personal' }, accountId, () =>
      this.recovery!.restore(accountId, () => {
        if (generation !== this.generation()) throw changedContext();
      }),
    );
  }
  documentsVisible?: () => boolean;
  reconciled?: (
    view: AccountView | null,
    signedOut?: boolean,
    guard?: () => void,
  ) => Promise<void>;
  private publish() {
    this.state.revision++;
    this.changed(this.snapshot());
  }
  private async transition(
    context: ActiveContext,
    accountId = this.principal(),
    prepare?: () => Promise<void>,
  ) {
    this.requests.abort();
    this.requests = new AbortController();
    this.rosterRequest++;
    const generation = this.generation() + 1;
    // Personal connection setup belongs to the account across workspace switches.
    const sameSession =
      accountId === this.principal() &&
      !this.authenticationChanging &&
      this.state.status !== 'signing-in';
    if (!sameSession) this.authenticationEpoch++;
    const kept = sameSession
      ? [...this.attempts].filter(
          ([, attempt]) => attempt.accountId === accountId,
        )
      : [];
    this.attempts.clear();
    for (const [k, a] of kept) this.attempts.set(k, { ...a, generation });
    if (accountId !== this.principal()) this.state.view = null;
    this.state.context = {
      generation,
      accountId,
      context: structuredClone(context),
    };
    delete this.state.billingReturnId;
    this.state.members = [];
    this.state.invitations = [];
    this.state.membersWorkspaceId = undefined;
    this.switching = true;
    this.publish();
    const target = structuredClone(this.state.context);
    this.cleanup = this.cleanup
      .catch(() => {})
      .then(async () => {
        await prepare?.();
        await this.invalidate(target, sameSession);
      });
    try {
      await this.cleanup;
      if (this.generation() === generation) {
        this.switching = false;
        this.publish();
      }
    } catch (error) {
      if (this.generation() === generation) {
        this.state.view = null;
        this.state.status = 'unavailable';
        this.state.error = {
          code: 'unavailable',
          message: 'Personal storage could not open. Retry or sign out.',
        };
        this.publish();
      }
      throw error;
    }
    return generation;
  }
  async refresh(afterSignIn = false): Promise<void> {
    if (
      this.authenticationChanging ||
      (this.state.status === 'signing-in' && !afterSignIn)
    )
      return;
    if (!this.auth || !this.api) {
      this.publish();
      return;
    }
    const request = ++this.refreshRequest;
    let generation = this.generation();
    const signal = this.requests.signal;
    const current = () =>
      request === this.refreshRequest && generation === this.generation();
    try {
      const subject = await this.auth.cachedSubject?.();
      if (!current()) return;
      const view = await this.api.view(signal);
      if (!current() || subject !== (await this.auth.cachedSubject?.())) return;
      if (!current()) return;
      const context = this.state.context.context;
      const valid =
        context.kind === 'personal' ||
        view.workspaces.some(
          (w) =>
            w.id === context.workspaceId &&
            w.organizationId === context.organizationId &&
            view.organizations.some(
              (o) =>
                o.id === context.organizationId &&
                ['active', 'read-only'].includes(o.access),
            ),
        );
      if (view.account.id !== this.principal() || !valid || this.switching) {
        this.state.view = null;
        const firstTeam =
          view.account.id !== this.principal()
            ? view.workspaces.find((w) =>
                view.organizations.some(
                  (o) =>
                    o.id === w.organizationId &&
                    ['active', 'read-only'].includes(o.access),
                ),
              )
            : undefined;
        const transitioning = this.transition(
          firstTeam
            ? {
                kind: 'team',
                organizationId: firstTeam.organizationId,
                workspaceId: firstTeam.id,
              }
            : { kind: 'personal' },
          view.account.id,
        );
        generation = this.generation();
        await transitioning;
        if (!current()) return;
      }
      if (subject) await this.cache?.save({ subject, view, at: Date.now() });
      if (!current()) return;
      await this.reconciled?.(view, false, () => {
        if (!current()) throw changedContext();
      });
      if (!current()) return;
      this.state.view = view;
      this.state.status = 'ready';
      this.state.error = undefined;
      this.publish();
      await this.inspectPending();
      await this.findInvitations();
    } catch (error) {
      if (!current()) return;
      if (
        (error instanceof AccountApiError && error.status === 401) ||
        (error as { code?: string })?.code === 'account-session-revoked'
      ) {
        this.state.view = null;
        // Focus refreshes also run for guests. Reopening guest storage resets the renderer.
        const transitioning =
          this.principal() !== null || this.switching
            ? this.transition({ kind: 'personal' }, null)
            : undefined;
        generation = this.generation();
        await this.cache?.clear();
        if (!current()) return;
        await this.auth.signOut().catch(() => {});
        await transitioning;
        if (!current()) return;
        this.state.status = 'signed-out';
        this.state.error = undefined;
        this.dropFoundInvitation();
        if (this.pending)
          this.state.pendingInvitation = {
            id: this.pending.id,
            status: 'sign-in-required',
          };
      } else {
        if (!this.state.view && this.cache && !this.switching) {
          const subject = await this.auth.cachedSubject?.();
          const cached = await this.cache.load();
          if (!current()) return;
          if (
            cached &&
            cached.subject === subject &&
            subject === (await this.auth.cachedSubject?.()) &&
            Date.now() >= cached.at &&
            Date.now() - cached.at < 14 * 86400000 &&
            current()
          ) {
            const transitioning = this.transition(
              { kind: 'personal' },
              cached.view.account.id,
            );
            generation = this.generation();
            await transitioning;
            if (!current()) return;
            this.state.view = cached.view;
          }
        }
        if (!current()) return;
        this.state.status = 'unavailable';
        this.state.error = {
          code: 'unavailable',
          message:
            'Account or personal storage could not connect. Retry or sign out.',
        };
      }
      this.publish();
    }
  }
  async signIn() {
    this.refreshRequest++;
    this.state.view = null;
    if (!this.auth || !this.api)
      throw Error('Account sign-in is not configured yet.');
    this.state.status = 'signing-in';
    this.state.error = undefined;
    await this.transition({ kind: 'personal' }, null);
    await this.cache?.clear();
    try {
      await this.auth.begin();
    } catch {
      this.state.status = 'unavailable';
      this.state.error = {
        code: 'sign-in-failed',
        message: 'Sign-in could not start. Try again.',
      };
      this.publish();
      throw Error(this.state.error.message);
    }
    this.publish();
  }
  cancelSignIn() {
    this.refreshRequest++;
    this.auth?.cancel();
    this.state.status = 'signed-out';
    this.publish();
    void this.refresh();
  }
  async signOut() {
    this.authenticationChanging = true;
    try {
      const request = ++this.refreshRequest;
      const signingOut = this.auth?.signOut().then(
        () => true,
        () => false,
      );
      this.state.view = null;
      const transitioning = this.transition({ kind: 'personal' }, null);
      void transitioning.catch(() => {});
      await this.cache?.clear();
      if (request !== this.refreshRequest) return;
      await this.reconciled?.(null, true, () => {
        if (request !== this.refreshRequest || this.principal() !== null)
          throw changedContext();
      });
      if (request !== this.refreshRequest) return;
      this.state.status = 'signed-out';
      this.state.view = null;
      await transitioning;
      this.dropFoundInvitation();
      if (this.pending)
        this.state.pendingInvitation = {
          id: this.pending.id,
          status: 'sign-in-required',
        };
      try {
        const confirmed = await signingOut;
        if (confirmed === false) throw Error('sign-out-unconfirmed');
        if (request !== this.refreshRequest) return;
        this.state.error = undefined;
      } catch {
        this.state.error = {
          code: 'sign-out-unconfirmed',
          message:
            'Local account access stopped. Sign-out could not be fully confirmed.',
        };
      }
      this.publish();
    } finally {
      this.authenticationChanging = false;
    }
  }
  async select(context: ActiveContext) {
    if (!context || typeof context !== 'object') throw changedContext();
    if (context.kind !== 'personal') {
      if (
        context.kind !== 'team' ||
        !this.state.view?.workspaces.some(
          (w) =>
            w.id === context.workspaceId &&
            w.organizationId === context.organizationId,
        ) ||
        !this.state.view.organizations.some(
          (o) =>
            o.id === context.organizationId &&
            ['active', 'read-only'].includes(o.access),
        )
      )
        throw Error('This workspace is unavailable or needs an active seat.');
    }
    await this.transition(context);
  }
  async receiveLink(value: string) {
    const link = parseAppLink(value);
    if (!link) throw Error('Enter a valid Supahelp invitation link.');
    if (link.kind === 'billing') {
      this.state.billingReturnId = randomUUID();
      this.publish();
      await this.refresh();
      return;
    }
    if (link.kind === 'case') {
      this.state.pendingCaseLink = { id: randomUUID(), target: link.id };
      this.publish();
      return;
    }
    if (link.kind === 'auth') {
      if (!this.auth) throw Error('Account sign-in is not configured.');
      const request = this.refreshRequest;
      try {
        await this.auth.finish(value);
      } catch {
        if (
          request === this.refreshRequest &&
          this.state.status === 'signing-in'
        ) {
          this.auth.cancel();
          this.state.status = 'unavailable';
          this.state.error = {
            code: 'sign-in-failed',
            message: 'Sign-in was canceled or could not finish. Start again.',
          };
          this.publish();
        }
        throw Error('Sign-in was canceled or could not finish. Start again.');
      }
      if (request !== this.refreshRequest) return;
      await this.refresh(true);
      return;
    }
    this.pending = { id: randomUUID(), token: link.token };
    this.state.pendingInvitation = {
      id: this.pending.id,
      status: 'sign-in-required',
    };
    this.publish();
    await this.inspectPending();
  }
  receiveLocalCaseLink(target: string) {
    this.state.pendingCaseLink = { id: randomUUID(), target, local: true };
    this.publish();
  }
  clearCaseLink(id: string) {
    if (this.state.pendingCaseLink?.id === id) {
      delete this.state.pendingCaseLink;
      this.publish();
    }
  }
  private dropFoundInvitation() {
    if (!this.pending?.found) return;
    this.pending = undefined;
    this.state.pendingInvitation = undefined;
  }
  // Invitations sent to this account's verified email, so someone who installed the app
  // after getting the email can join without the link. One at a time, through the link's card.
  private async findInvitations() {
    if (this.pending || !this.api || !this.state.view) return;
    const generation = this.generation();
    const found = await this.api.mine(this.requests.signal).catch(() => []);
    const first = found[0];
    if (!first || this.pending || generation !== this.generation()) return;
    if (!this.state.view) return;
    const { token, ...offer } = first;
    this.pending = { id: randomUUID(), token, found: true };
    this.state.pendingInvitation = {
      id: this.pending.id,
      status: 'ready',
      offer,
    };
    this.publish();
  }
  private async inspectPending() {
    const pending = this.pending,
      generation = this.generation();
    if (!pending || !this.api) return;
    if (!this.state.view) {
      this.state.pendingInvitation = {
        id: pending.id,
        status: 'sign-in-required',
      };
      this.publish();
      return;
    }
    try {
      const offer = await this.api.inspect(pending.token, this.requests.signal);
      if (this.pending?.id === pending.id && this.generation() === generation) {
        this.state.pendingInvitation = {
          id: pending.id,
          status: 'ready',
          offer,
        };
        this.publish();
      }
    } catch (error) {
      if (this.pending?.id === pending.id && this.generation() === generation) {
        this.state.pendingInvitation = {
          id: pending.id,
          status:
            error instanceof AccountApiError && error.status === 403
              ? 'wrong-account'
              : error instanceof AccountApiError &&
                  [404, 410].includes(error.status)
                ? 'expired'
                : 'unavailable',
        };
        this.publish();
      }
    }
  }
  private readyApi() {
    if (
      !this.api ||
      !this.state.view ||
      this.state.view.account.id !== this.principal() ||
      this.switching ||
      this.state.status === 'signing-in'
    )
      throw Error('Sign in before changing organization settings.');
    return this.api;
  }
  private async change<T>(
    run: (api: AccountApi, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const api = this.readyApi(),
      generation = this.generation();
    const result = await run(api, this.requests.signal);
    if (generation !== this.generation()) throw changedContext();
    await this.refresh();
    return result;
  }
  renameAccount(name: string) {
    return this.change((api, s) => api.renameAccount(name, s));
  }
  saveOnboarding(answers: Parameters<AccountApi['saveOnboarding']>[0]) {
    return this.change((api, s) => api.saveOnboarding(answers, s));
  }
  completeOnboarding() {
    return this.change((api, s) => api.completeOnboarding(s));
  }
  createOrganization(input: Parameters<AccountApi['createOrganization']>[0]) {
    return this.change((api, s) => api.createOrganization(input, s));
  }
  createWorkspace(input: Parameters<AccountApi['createWorkspace']>[0]) {
    return this.change((api, s) => api.createWorkspace(input, s));
  }
  inviteWorkspaceMember(input: Parameters<AccountApi['invite']>[0]) {
    return this.change((api, s) => api.invite(input, s));
  }
  resendWorkspaceInvitation(input: Parameters<AccountApi['resend']>[0]) {
    return this.change((api, s) => api.resend(input, s));
  }
  revokeWorkspaceInvitation(input: Parameters<AccountApi['revoke']>[0]) {
    return this.change((api, s) => api.revoke(input, s));
  }
  setWorkspaceRole(input: Parameters<AccountApi['setRole']>[0]) {
    return this.change((api, s) => api.setRole(input, s));
  }
  removeWorkspaceMember(input: Parameters<AccountApi['removeWorkspace']>[0]) {
    return this.change((api, s) => api.removeWorkspace(input, s));
  }
  renameWorkspace(input: Parameters<AccountApi['renameWorkspace']>[0]) {
    return this.change((api, s) => api.renameWorkspace(input, s));
  }
  deleteWorkspace(input: Parameters<AccountApi['deleteWorkspace']>[0]) {
    return this.change((api, s) => api.deleteWorkspace(input, s));
  }
  removeOrganizationMember(
    input: Parameters<AccountApi['removeOrganization']>[0],
  ) {
    return this.change((api, s) => api.removeOrganization(input, s));
  }
  leaveOrganization(input: Parameters<AccountApi['leave']>[0]) {
    return this.change((api, s) => api.leave(input, s));
  }
  renameOrganization(input: Parameters<AccountApi['renameOrganization']>[0]) {
    return this.change((api, s) => api.renameOrganization(input, s));
  }
  deleteOrganization(input: Parameters<AccountApi['deleteOrganization']>[0]) {
    return this.change((api, s) => api.deleteOrganization(input, s));
  }
  setOrganizationIcon(input: Parameters<AccountApi['setOrganizationIcon']>[0]) {
    return this.change((api, s) => api.setOrganizationIcon(input, s));
  }
  transferOrganizationOwner(input: Parameters<AccountApi['transferOwner']>[0]) {
    return this.change((api, s) => api.transferOwner(input, s));
  }
  async getWorkspaceMembers(workspaceId: string) {
    const api = this.readyApi(),
      generation = this.generation(),
      request = ++this.rosterRequest;
    const result = await api.members(workspaceId, this.requests.signal);
    if (generation !== this.generation()) throw changedContext();
    if (request !== this.rosterRequest)
      throw Error('The workspace member request was superseded.');
    this.state.members = result.members;
    this.state.invitations = result.invitations;
    this.state.membersWorkspaceId = workspaceId;
    this.publish();
    return result;
  }
  async acceptWorkspaceInvitation(pendingId: string, requestId: string) {
    const pending = this.pending;
    if (
      !pending ||
      pending.id !== pendingId ||
      this.state.pendingInvitation?.status !== 'ready'
    )
      throw Error('Review the current invitation before joining.');
    const result = await this.change((api, s) =>
      api.accept(pending.token, requestId, s),
    );
    this.finishInvitation(pendingId);
    return result;
  }
  async declineWorkspaceInvitation(pendingId: string, requestId: string) {
    const pending = this.pending;
    if (
      !pending ||
      pending.id !== pendingId ||
      this.state.pendingInvitation?.status !== 'ready'
    )
      throw Error('Review the current invitation before declining.');
    await this.change((api, s) => api.decline(pending.token, requestId, s));
    this.finishInvitation(pendingId);
  }
  private finishInvitation(pendingId: string) {
    if (this.pending?.id !== pendingId) return;
    this.pending = undefined;
    this.state.pendingInvitation = undefined;
    this.publish();
    void this.findInvitations();
  }
  async exportOrganization(organizationId: string) {
    const data = await this.change((api, s) =>
      api.exportMetadata(organizationId, s),
    );
    return {
      saved: this.saveExport
        ? await this.saveExport(JSON.stringify(data, null, 2))
        : false,
    };
  }
  private assertOwner(organizationId: string) {
    this.readyApi();
    const organization = this.state.view?.organizations.find(
      (o) => o.id === organizationId,
    );
    if (!organization || organization.ownerId !== this.principal())
      throw Error('Only organization owners can manage billing.');
  }
  async billingView(organizationId: string) {
    this.assertOwner(organizationId);
    const generation = this.generation();
    const value = await this.readyApi().billingView(
      organizationId,
      this.requests.signal,
    );
    if (generation !== this.generation()) throw changedContext();
    return value;
  }
  async billingPreview(organizationId: string, capacity: number) {
    this.assertOwner(organizationId);
    const generation = this.generation();
    const value = await this.readyApi().billingPreview(
      organizationId,
      capacity,
      this.requests.signal,
    );
    if (generation !== this.generation()) throw changedContext();
    return value;
  }
  async billingChange(input: BillingRequest) {
    this.assertOwner(input.organizationId);
    const generation = this.generation();
    const value = await this.change((api, s) => api.billingChange(input, s));
    if (generation !== this.generation()) throw changedContext();
    if (value.url) {
      const { shell } = await import('electron');
      if (generation !== this.generation()) throw changedContext();
      await shell.openExternal(value.url);
    }
    return { opened: !!value.url };
  }
  async getOrganizationMembers(organizationId: string) {
    const api = this.readyApi(),
      generation = this.generation();
    const result = await api.organizationMembers(
      organizationId,
      this.requests.signal,
    );
    if (generation !== this.generation()) throw changedContext();
    return result;
  }
  // A connection follows the account that connected it, in every workspace.
  async canUse(capability: string): Promise<boolean> {
    return this.canManageConnection(capability);
  }
  async canManageConnection(
    capability: string,
    pendingAllowed = false,
  ): Promise<boolean> {
    if (this.switching || this.state.status === 'signing-in') return false;
    const generation = this.generation();
    const owns = await this.access.allows(capability, this.principal());
    if (generation !== this.generation()) return false;
    if (owns) return true;
    const pending = this.attempts.get(capability);
    return (
      pendingAllowed &&
      !!pending &&
      pending.generation === generation &&
      pending.accountId === this.principal()
    );
  }
  async beginConnection(capability: string) {
    if (this.switching || this.state.status === 'signing-in')
      throw changedContext();
    const generation = this.generation(),
      accountId = this.principal(),
      id = await this.access.block(capability);
    if (generation !== this.generation()) throw changedContext();
    this.attempts.set(capability, { id, generation, accountId, done: false });
    return id;
  }
  finishConnection(capability: string, id: string, success: boolean) {
    const attempt = this.attempts.get(capability);
    if (attempt?.id !== id) return;
    if (!success) this.attempts.delete(capability);
    else attempt.done = true;
  }
  private async observe(capability: string, ready: boolean) {
    const attempt = this.attempts.get(capability);
    if (
      !ready ||
      !attempt?.done ||
      attempt.generation !== this.generation() ||
      attempt.accountId !== this.principal()
    )
      return;
    await this.access.bindAfterConnection(
      capability,
      attempt.accountId,
      attempt.id,
    );
    if (this.attempts.get(capability)?.id === attempt.id)
      this.attempts.delete(capability);
  }
  async scopeSnapshot(
    channel: string,
    value: Record<string, any>,
  ): Promise<Record<string, any> & { context: ContextStamp }> {
    if (this.switching) throw changedContext();
    const generation = this.generation();
    const key = channel.split(':')[0],
      previous = this.projections.get(key);
    const raw = typeof value.revision === 'number' ? value.revision : undefined;
    if (raw !== undefined && previous && raw < previous.raw)
      throw changedContext();
    const revision = (previous?.revision ?? 0) + 1;
    if (raw !== undefined) this.projections.set(key, { raw, revision });
    if (this.switching) await this.cleanup;
    if (generation !== this.generation()) throw changedContext();
    const stamp = structuredClone(this.state.context),
      next: Record<string, any> = structuredClone(value),
      personal = stamp.context.kind === 'personal' && !this.switching;
    const actions = (list: any[]) =>
      list.filter((a) => (a.principal ?? null) === stamp.accountId);
    const connection = async (
      capability: string,
      entry: Record<string, any>,
    ) => {
      await this.observe(capability, entry.state === 'connected');
      if (await this.canManageConnection(capability))
        return {
          ...entry,
          actions: actions(entry.actions ?? []),
        };
      const connecting =
        entry.state === 'connecting' &&
        (await this.canManageConnection(capability, true));
      return {
        ...entry,
        state: connecting ? 'connecting' : 'disconnected',
        account: undefined,
        site: undefined,
        role: undefined,
        scopes: [],
        tools: [],
        actions: [],
        verificationCode: connecting ? entry.verificationCode : undefined,
        manualReturn: connecting ? entry.manualReturn : undefined,
        // Failure messages are fixed, account-free text from Connections; keep
        // them so a failed sign-in doesn't look like nothing happened.
        message:
          (connecting || entry.state === 'error') &&
          typeof entry.message === 'string'
            ? entry.message
            : 'Connect for this Supahelp account.',
        ...(entry.fields
          ? {
              fields: entry.fields.map((f: Record<string, any>) => {
                const { value: _value, ...field } = f;
                return field;
              }),
            }
          : {}),
      };
    };
    if (channel.startsWith('chat:'))
      // Chats are personal (never synced), so they stay visible in team workspaces.
      next.chats = this.switching ? [] : (next.chats ?? []);
    else if (channel.startsWith('cases:'))
      next.cases =
        personal || this.documentsVisible?.() ? (next.cases ?? []) : [];
    else if (channel.startsWith('playbooks:')) {
      const team =
        stamp.context.kind === 'team' && this.documentsVisible?.()
          ? stamp.context
          : undefined;
      next.playbooks = personal || team ? (next.playbooks ?? []) : [];
      next.resolutions = (next.resolutions ?? []).filter(
        (draft: import('../../../contracts/playbooks').ResolutionDraft) =>
          personal
            ? !draft.team
            : team &&
              draft.team?.workspaceId === team.workspaceId &&
              draft.team?.accountId === stamp.accountId,
      );
    } else if (channel.startsWith('linear:'))
      Object.assign(next, await connection('linear', next));
    else if (channel.startsWith('zendesk:'))
      Object.assign(next, await connection('zendesk', next));
    else if (channel.startsWith('connections:'))
      next.connections = await Promise.all(
        (next.connections ?? []).map((entry: Record<string, any>) =>
          connection(`catalog:${entry.id}`, entry),
        ),
      );
    else if (channel === 'models:settings') {
      const allowed = new Set<string>();
      for (const p of next.providers ?? []) {
        await this.observe(`model:${p.id}`, p.state === 'ready');
        if (await this.canUse(`model:${p.id}`)) allowed.add(p.id);
      }
      next.providers = (next.providers ?? []).map((p: Record<string, any>) =>
        allowed.has(p.id)
          ? p
          : {
              id: p.id,
              state: 'disconnected',
              message:
                p.id === 'chatgpt' &&
                p.state === 'signed-out' &&
                p.authentication === 'subscription' &&
                this.attempts.get('model:chatgpt')?.done
                  ? 'Finish ChatGPT sign-in in your browser, then check the connection.'
                  : 'Connect for this Supahelp account.',
            },
      );
      next.models = (next.models ?? []).filter((m: Record<string, any>) =>
        allowed.has(m.provider),
      );
      if (!allowed.has(next.selected?.provider))
        next.selected = { provider: 'claude', model: 'default' };
    } else if (channel === 'claude:status') {
      await this.observe('model:claude', next.state === 'ready');
      if (!(await this.canUse('model:claude'))) {
        if (this.generation() !== stamp.generation) throw changedContext();
        return {
          state: 'disconnected',
          model: 'default',
          message: 'Connect for this Supahelp account.',
          context: stamp,
        };
      }
    }
    if (this.generation() !== stamp.generation) throw changedContext();
    return {
      ...next,
      ...(raw !== undefined ? { revision } : {}),
      context: stamp,
    };
  }
  async close() {
    this.requests.abort();
    this.authenticationEpoch++;
    this.state.context.generation++;
    this.attempts.clear();
    await this.auth?.close();
  }
}
