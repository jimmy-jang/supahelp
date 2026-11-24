import { randomUUID } from 'node:crypto';
import type {
  AccountView,
  BillingPreview,
  BillingRequest,
  BillingView,
  InvitationOffer,
  InvitationView,
  MemberView,
  OrganizationView,
  PublicAccount,
  WorkspaceRole,
  WorkspaceView,
} from '../../contracts/accounts.ts';
import {
  parseOnboarding,
  type OnboardingAnswers,
} from '../../contracts/onboarding.ts';

export class AccountApiError extends Error {
  status: number;
  code: string;
  constructor(status = 503, code = 'unavailable') {
    const messages: Record<string, string> = {
      unauthenticated: 'Sign in again to continue.',
      forbidden: 'You do not have permission for this change.',
      capacity: 'This organization needs an available seat.',
      'invalid-input': 'Check the details and try again.',
      'access-inactive': 'Active organization access and a seat are required.',
      'invalid-invitation':
        'This invitation does not match the signed-in account, or it has expired. Ask your workspace admin to check it.',
      'invitation-limit':
        'Today’s invitation limit has been reached. Try tomorrow.',
      'operation-conflict':
        'This operation has already been used for another change.',
      'organization-exists': 'You already belong to an organization.',
      'trial-used':
        'This organization has already received access. Subscribe to continue.',
      'billing-pending':
        'A billing change is pending. Retry it or refresh billing.',
      'billing-active':
        'Finish pending billing changes and end the subscription before deleting the organization.',
      'billing-unavailable':
        'Billing is not enabled or this subscription needs review.',
      'preview-expired': 'Review a new price preview before changing seats.',
      'billing-review':
        'This billing change needs support review before retrying.',
      'billing-declined':
        'The billing change failed. Check payment details and refresh billing.',
    };
    super(messages[code] ?? 'The account service is unavailable. Try again.');
    this.status = status;
    this.code = code;
  }
}
const bad = () => new AccountApiError();
// A malformed server answer is a bad response, not a user input error.
const onboarding = (value: unknown) => {
  try {
    return parseOnboarding(value);
  } catch {
    throw bad();
  }
};
const record = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad();
  return v as Record<string, any>;
};
const text = (v: unknown, limit = 200): string => {
  if (typeof v !== 'string' || !v || v.length > limit) throw bad();
  return v;
};
export const accountId = (v: unknown): string => {
  const id = text(v, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw new AccountApiError(400, 'invalid-input');
  return id;
};
const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v) || v.length > 10_000) throw bad();
  return v;
};
const choice = <T extends string>(v: unknown, values: readonly T[]): T => {
  if (!values.includes(v as T)) throw bad();
  return v as T;
};
const timestamp = (v: unknown) => {
  const value = text(v, 100);
  if (!Number.isFinite(Date.parse(value))) throw bad();
  return value;
};
const person = (v: unknown): PublicAccount => {
  const a = record(v);
  return { id: accountId(a.id), name: text(a.name), email: text(a.email, 254) };
};
const number = (v: unknown): number => {
  if (!Number.isSafeInteger(v) || Number(v) < 0) throw bad();
  return Number(v);
};
const workspaceRole = (v: unknown) =>
  choice(v, ['admin', 'member', 'viewer'] as const);
const offer = (value: unknown): InvitationOffer => {
  const v = record(value);
  return {
    organizationName: text(v.organizationName, 100),
    workspaceName: text(v.workspaceName, 100),
    inviterName: text(v.inviterName),
    role: workspaceRole(v.role),
    expiresAt: timestamp(v.expiresAt),
  };
};
const invitation = (v: unknown): InvitationView => {
  const i = record(v);
  return {
    id: accountId(i.id),
    workspaceId: accountId(i.workspaceId),
    email: text(i.email, 254),
    role: workspaceRole(i.role),
    expiresAt: timestamp(i.expiresAt),
    status: choice(i.status, [
      'pending',
      'accepted',
      'expired',
      'revoked',
      'declined',
    ]),
    delivery: choice(i.delivery, ['queued', 'sent', 'failed', 'uncertain']),
  };
};

export class AccountApi {
  private origin: string;
  private token: (signal: AbortSignal) => Promise<string | undefined>;
  private fetch: typeof fetch;
  constructor(
    origin: string,
    token: (signal: AbortSignal) => Promise<string | undefined>,
    request: typeof fetch = fetch,
    allowLoopback = false,
  ) {
    const url = new URL(origin);
    if (
      (url.protocol !== 'https:' &&
        !(
          allowLoopback &&
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw Error('Configure a trusted HTTPS account API origin.');
    this.origin = url.origin;
    this.token = token;
    this.fetch = request;
  }
  private async call(
    path: string,
    method: string,
    body: unknown,
    signal: AbortSignal,
    suppliedToken?: string,
    maximumBytes = 1_048_576,
  ): Promise<Record<string, any>> {
    const token = suppliedToken ?? (await this.token(signal));
    if (!token) throw new AccountApiError(401, 'unauthenticated');
    try {
      const response = await this.fetch(this.origin + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      const reader = response.body?.getReader();
      if (!reader) throw bad();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > maximumBytes) {
            await reader.cancel();
            throw bad();
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        // A non-JSON error (e.g. a proxy 404 for a route this API build lacks) keeps its status.
        throw new AccountApiError(response.ok ? 503 : response.status);
      }
      const envelope = record(parsed);
      if (!response.ok || envelope.ok !== true) {
        const code =
          typeof envelope.error?.code === 'string' &&
          /^[a-z-]{1,60}$/.test(envelope.error.code)
            ? envelope.error.code
            : 'unavailable';
        throw new AccountApiError(response.status, code);
      }
      return record(envelope.value);
    } catch (error) {
      if (error instanceof AccountApiError) throw error;
      if (signal.aborted) throw signal.reason;
      throw bad();
    }
  }
  async view(signal: AbortSignal): Promise<AccountView> {
    const v = await this.call('/v1/account', 'GET', undefined, signal);
    const organizations: OrganizationView[] = list(v.organizations).map(
      (value) => {
        const o = record(value);
        return {
          id: accountId(o.id),
          name: text(o.name, 100),
          ...(o.icon === undefined
            ? {}
            : {
                icon:
                  o.icon === null
                    ? null
                    : (() => {
                        const icon = text(o.icon, 12000);
                        if (
                          !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(
                            icon,
                          )
                        )
                          throw bad();
                        return icon;
                      })(),
              }),
          ownerId: accountId(o.ownerId),
          access: choice(o.access, [
            'setup',
            'active',
            'read-only',
            'locked',
            'revoked',
          ]),
          capacity: number(o.capacity),
          assigned: number(o.assigned),
          reserved: number(o.reserved),
          source: choice(o.source, ['none', 'pilot', 'trial', 'paid']),
          expiresAt: o.expiresAt === null ? null : timestamp(o.expiresAt),
        };
      },
    );
    const workspaces: WorkspaceView[] = list(v.workspaces).map((value) => {
      const w = record(value);
      if (!organizations.some((o) => o.id === w.organizationId)) throw bad();
      return {
        id: accountId(w.id),
        organizationId: accountId(w.organizationId),
        name: text(w.name, 100),
        role: workspaceRole(w.role),
      };
    });
    if (
      v.onboardingCompleted !== undefined &&
      typeof v.onboardingCompleted !== 'boolean'
    )
      throw bad();
    return {
      account: person(v.account),
      organizations,
      workspaces,
      ...(v.onboardingCompleted === undefined
        ? {}
        : { onboardingCompleted: v.onboardingCompleted }),
      ...(v.onboarding === undefined
        ? {}
        : {
            onboarding: v.onboarding === null ? null : onboarding(v.onboarding),
          }),
    };
  }
  async renameAccount(name: string, signal: AbortSignal) {
    const v = await this.call('/v1/account/name', 'PUT', { name }, signal);
    return { name: text(v.name, 100) };
  }
  async saveOnboarding(answers: OnboardingAnswers, signal: AbortSignal) {
    const v = await this.call(
      '/v1/account/onboarding',
      'PUT',
      { answers: parseOnboarding(answers) },
      signal,
    );
    return { onboarding: onboarding(v.onboarding) };
  }
  async completeOnboarding(signal: AbortSignal) {
    const v = await this.call(
      '/v1/account/onboarding/complete',
      'POST',
      {},
      signal,
    );
    if (v.completed !== true) throw bad();
    return { completed: true as const };
  }
  async createOrganization(
    input: { name: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    const v = await this.call('/v1/organizations', 'POST', input, signal);
    return {
      organizationId: accountId(v.organizationId),
      workspaceId: accountId(v.workspaceId),
    };
  }
  async createWorkspace(
    input: { organizationId: string; name: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    const v = await this.call(
      `/v1/organizations/${accountId(input.organizationId)}/workspaces`,
      'POST',
      { name: input.name, requestId: input.requestId },
      signal,
    );
    return { workspaceId: accountId(v.workspaceId) };
  }
  async members(
    workspaceId: string,
    signal: AbortSignal,
  ): Promise<{ members: MemberView[]; invitations: InvitationView[] }> {
    const members: MemberView[] = [],
      invitations: InvitationView[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const v = await this.call(
        `/v1/workspaces/${accountId(workspaceId)}/members${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
        'GET',
        undefined,
        signal,
      );
      members.push(
        ...list(v.members).map((value) => {
          const m = record(value);
          if (typeof m.seated !== 'boolean') throw bad();
          return {
            account: person(m.account),
            role: workspaceRole(m.role),
            seated: m.seated,
          };
        }),
      );
      invitations.push(...list(v.invitations).map(invitation));
      if (!v.nextCursor) return { members, invitations };
      cursor = text(v.nextCursor, 512);
      if (seen.has(cursor)) throw bad();
      seen.add(cursor);
    }
    throw bad();
  }
  async invite(
    input: {
      workspaceId: string;
      email: string;
      role: WorkspaceRole;
      requestId: string;
    },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    return invitation(
      await this.call(
        `/v1/workspaces/${accountId(input.workspaceId)}/invitations`,
        'POST',
        { email: input.email, role: input.role, requestId: input.requestId },
        signal,
      ),
    );
  }
  async resend(
    input: { invitationId: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    return invitation(
      await this.call(
        `/v1/invitations/${accountId(input.invitationId)}/resend`,
        'POST',
        { requestId: input.requestId },
        signal,
      ),
    );
  }
  async revoke(
    input: { invitationId: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    await this.call(
      `/v1/invitations/${accountId(input.invitationId)}/revoke`,
      'POST',
      { requestId: input.requestId },
      signal,
    );
  }
  async inspect(token: string, signal: AbortSignal): Promise<InvitationOffer> {
    const v = await this.call(
      '/v1/invitations/inspect',
      'POST',
      { token },
      signal,
    );
    return offer(v);
  }
  /** Pending invitations sent to the signed-in account's verified email. */
  async mine(
    signal: AbortSignal,
  ): Promise<Array<InvitationOffer & { token: string }>> {
    const v = await this.call('/v1/invitations/mine', 'GET', undefined, signal);
    if (!Array.isArray(v.invitations) || v.invitations.length > 20)
      throw Error('invalid-response');
    return v.invitations.map((i: unknown) => ({
      ...offer(i),
      token: text(record(i).token, 256),
    }));
  }
  async decline(token: string, requestId: string, signal: AbortSignal) {
    accountId(requestId);
    await this.call(
      '/v1/invitations/decline',
      'POST',
      { token, requestId },
      signal,
    );
  }
  async accept(token: string, requestId: string, signal: AbortSignal) {
    accountId(requestId);
    const v = await this.call(
      '/v1/invitations/accept',
      'POST',
      { token, requestId },
      signal,
    );
    return {
      organizationId: accountId(v.organizationId),
      workspaceId: accountId(v.workspaceId),
    };
  }
  async setRole(
    input: {
      workspaceId: string;
      accountId: string;
      role: WorkspaceRole;
      requestId: string;
    },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    await this.call(
      `/v1/workspaces/${accountId(input.workspaceId)}/members/${accountId(input.accountId)}`,
      'PATCH',
      { role: input.role, requestId: input.requestId },
      signal,
    );
  }
  async removeWorkspace(
    input: { workspaceId: string; accountId: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    await this.call(
      `/v1/workspaces/${accountId(input.workspaceId)}/members/${accountId(input.accountId)}/remove`,
      'POST',
      { requestId: input.requestId },
      signal,
    );
  }
  async renameWorkspace(
    input: { workspaceId: string; name: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    const v = await this.call(
      `/v1/workspaces/${accountId(input.workspaceId)}/rename`,
      'POST',
      { name: input.name, requestId: input.requestId },
      signal,
    );
    return { workspaceId: accountId(v.workspaceId), name: String(v.name) };
  }
  async deleteWorkspace(
    input: { workspaceId: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    await this.call(
      `/v1/workspaces/${accountId(input.workspaceId)}/delete`,
      'POST',
      { requestId: input.requestId },
      signal,
    );
  }
  async removeOrganization(
    input: { organizationId: string; accountId: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    await this.call(
      `/v1/organizations/${accountId(input.organizationId)}/members/${accountId(input.accountId)}/remove`,
      'POST',
      { requestId: input.requestId },
      signal,
    );
  }
  async leave(
    input: { organizationId: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    await this.call(
      `/v1/organizations/${accountId(input.organizationId)}/leave`,
      'POST',
      { requestId: input.requestId },
      signal,
    );
  }
  async deleteOrganization(
    input: { organizationId: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    await this.call(
      `/v1/organizations/${accountId(input.organizationId)}/delete`,
      'POST',
      { requestId: input.requestId },
      signal,
    );
  }
  async transferOwner(
    input: { organizationId: string; accountId: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    await this.call(
      `/v1/organizations/${accountId(input.organizationId)}/transfer-owner`,
      'POST',
      { accountId: input.accountId, requestId: input.requestId },
      signal,
    );
  }
  async setOrganizationIcon(
    input: { organizationId: string; icon: string | null },
    signal: AbortSignal,
  ) {
    await this.call(
      `/v1/organizations/${accountId(input.organizationId)}/icon`,
      'PUT',
      { icon: input.icon },
      signal,
    );
  }
  async renameOrganization(
    input: { organizationId: string; name: string; requestId: string },
    signal: AbortSignal,
  ) {
    accountId(input.requestId);
    const v = await this.call(
      `/v1/organizations/${accountId(input.organizationId)}/rename`,
      'POST',
      { name: input.name, requestId: input.requestId },
      signal,
    );
    return {
      organizationId: accountId(v.organizationId),
      name: String(v.name),
    };
  }
  async exportMetadata(organizationId: string, signal: AbortSignal) {
    // shortcut: JSON exports buffer up to 64 MiB; stream before supporting larger exports.
    return this.call(
      `/v1/organizations/${accountId(organizationId)}/export`,
      'GET',
      undefined,
      signal,
      undefined,
      67_108_864,
    );
  }
  async billingView(
    organizationId: string,
    signal: AbortSignal,
  ): Promise<BillingView> {
    let v: Record<string, any>;
    try {
      v = await this.call(
        `/v1/organizations/${accountId(organizationId)}/billing`,
        'GET',
        undefined,
        signal,
      );
    } catch (error) {
      // An API build without billing routes answers a bare 404: billing is not available yet.
      if (
        error instanceof AccountApiError &&
        error.status === 404 &&
        error.code === 'unavailable'
      )
        return {
          enabled: false,
          trialAvailable: false,
          status: 'none',
          capacity: 5,
          pendingCapacity: null,
          pendingAt: null,
          cancelAtPeriodEnd: false,
          hasSubscription: false,
          reviewRequired: false,
          pendingAction: false,
        };
      throw error;
    }
    for (const k of [
      'enabled',
      'trialAvailable',
      'cancelAtPeriodEnd',
      'hasSubscription',
      'reviewRequired',
      'pendingAction',
    ])
      if (typeof v[k] !== 'boolean') throw bad();
    return {
      enabled: v.enabled,
      trialAvailable: v.trialAvailable,
      status: text(v.status, 60),
      capacity: number(v.capacity),
      pendingCapacity:
        v.pendingCapacity === null ? null : number(v.pendingCapacity),
      pendingAt: v.pendingAt === null ? null : timestamp(v.pendingAt),
      cancelAtPeriodEnd: v.cancelAtPeriodEnd,
      hasSubscription: v.hasSubscription,
      reviewRequired: v.reviewRequired,
      pendingAction: v.pendingAction,
    };
  }
  async billingPreview(
    organizationId: string,
    capacity: number,
    signal: AbortSignal,
  ): Promise<BillingPreview> {
    const v = await this.call(
      `/v1/organizations/${accountId(organizationId)}/billing/preview`,
      'POST',
      { capacity },
      signal,
    );
    if (v.currency !== 'usd') throw bad();
    return {
      id: accountId(v.id),
      capacity: number(v.capacity),
      amount: number(v.amount),
      currency: 'usd',
      effectiveAt: timestamp(v.effectiveAt),
      expiresAt: timestamp(v.expiresAt),
    };
  }
  async billingChange(input: BillingRequest, signal: AbortSignal) {
    accountId(input.requestId);
    const v = await this.call(
      `/v1/organizations/${accountId(input.organizationId)}/billing`,
      'POST',
      input,
      signal,
    );
    if (v.url !== undefined && v.url !== null) {
      const url = new URL(text(v.url, 4096));
      if (
        url.protocol !== 'https:' ||
        ![
          'checkout.stripe.com',
          'billing.stripe.com',
          'invoice.stripe.com',
        ].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw bad();
    }
    return { url: typeof v.url === 'string' ? v.url : null };
  }
  async logout(token: string) {
    await this.call(
      '/v1/session/logout',
      'POST',
      { requestId: randomUUID() },
      AbortSignal.timeout(10_000),
      token,
    );
  }
  async organizationMembers(organizationId: string, signal: AbortSignal) {
    const v = await this.call(
      `/v1/organizations/${accountId(organizationId)}/members`,
      'GET',
      undefined,
      signal,
    );
    return list(v.members).map((value) => {
      const m = record(value);
      if (typeof m.seated !== 'boolean') throw bad();
      return {
        account: person(m.account),
        seated: m.seated,
        workspaceCount: number(m.workspaceCount),
      };
    });
  }
}
