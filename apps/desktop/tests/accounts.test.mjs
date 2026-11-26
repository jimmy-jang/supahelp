import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { AccountService } from '../src/main/features/accounts/service.ts';
import { AccountApi } from '../src/main/integrations/account-api.ts';

function fixture() {
  const accountId = randomUUID(),
    organizationId = randomUUID(),
    workspaceId = randomUUID();
  let value = {
    account: { id: accountId, name: 'A', email: 'a@example.test' },
    organizations: [
      {
        id: organizationId,
        name: 'Acme',
        ownerId: accountId,
        access: 'active',
        capacity: 5,
        assigned: 1,
        reserved: 0,
        source: 'pilot',
        expiresAt: '2099-01-01T00:00:00Z',
      },
    ],
    workspaces: [
      { id: workspaceId, organizationId, name: 'General', role: 'admin' },
    ],
  };
  const listeners = [];
  let stopped = 0,
    accepted = 0;
  const auth = {
    token: async () => 'token',
    begin: async () => {},
    finish: async () => {},
    cancel() {},
    signOut: async () => {},
    close: async () => {},
  };
  const api = {
    view: async () => structuredClone(value),
    members: async () => ({ members: [], invitations: [] }),
    inspect: async () => ({
      organizationName: 'Acme',
      workspaceName: 'General',
      inviterName: 'Owner',
      role: 'viewer',
      expiresAt: '2099-01-01T00:00:00Z',
    }),
    accept: async () => {
      accepted++;
      return { organizationId, workspaceId };
    },
    mine: async () => [],
  };
  const access = {
    allows: async (_cap, id) => id === null,
    block: async () => randomUUID(),
    bindAfterConnection: async () => {},
  };
  const service = new AccountService({
    auth,
    api,
    access,
    changed: (s) => listeners.push(s),
    invalidate: async () => {
      stopped++;
    },
  });
  return {
    service,
    api,
    auth,
    workspaceId,
    organizationId,
    listeners,
    get stopped() {
      return stopped;
    },
    get accepted() {
      return accepted;
    },
    set value(v) {
      value = v;
    },
  };
}
test('refreshing without a session keeps the active guest context', async () => {
  const f = fixture();
  const service = new AccountService({
    auth: f.auth,
    api: new AccountApi('https://example.test', async () => undefined),
    access: { allows: async () => false },
    changed() {},
    invalidate: async () => {},
  });
  const context = service.snapshot().context;

  await service.refresh();
  await Promise.all([service.refresh(), service.refresh()]);

  assert.equal(service.snapshot().status, 'signed-out');
  assert.deepEqual(service.snapshot().context, context);
  assert.doesNotThrow(() => service.assertCurrentContext(context));
});

test('a rejected signed-in session invalidates the old workspace context', async () => {
  const f = fixture();
  let rejected = false;
  const service = new AccountService({
    auth: f.auth,
    api: new AccountApi(
      'https://example.test',
      async () => 'token',
      async () =>
        rejected
          ? Response.json(
              { ok: false, error: { code: 'unauthenticated' } },
              { status: 401 },
            )
          : Response.json({ ok: true, value: await f.api.view() }),
    ),
    access: { allows: async () => false },
    changed() {},
    invalidate: async () => {},
  });
  await service.refresh();
  const context = service.snapshot().context;
  assert.equal(context.context.kind, 'team');

  rejected = true;
  await service.refresh();

  assert.equal(service.snapshot().status, 'signed-out');
  assert.equal(service.principal(), null);
  assert.throws(() => service.assertCurrentContext(context), /case-context/);
});

test('defaults to the first accessible team and preserves an explicit personal selection', async () => {
  const f = fixture();
  await f.service.refresh();
  assert.deepEqual(f.service.snapshot().context.context, {
    kind: 'team',
    organizationId: f.organizationId,
    workspaceId: f.workspaceId,
  });
  await f.service.select({ kind: 'personal' });
  await f.service.refresh();
  assert.deepEqual(f.service.snapshot().context.context, { kind: 'personal' });
});
test('uses personal when no team is accessible', async () => {
  const f = fixture();
  f.value = {
    account: { id: randomUUID(), name: 'A', email: 'a@example.test' },
    organizations: [{ id: f.organizationId, access: 'inactive' }],
    workspaces: [{ id: f.workspaceId, organizationId: f.organizationId }],
  };
  await f.service.refresh();
  assert.deepEqual(f.service.snapshot().context.context, { kind: 'personal' });
});
test('main validates workspace selection, keeps personal chats in team context and stops old capabilities', async () => {
  const f = fixture();
  await f.service.refresh();
  const before = f.service.snapshot().context.generation;
  await assert.rejects(
    f.service.select({
      kind: 'team',
      organizationId: randomUUID(),
      workspaceId: randomUUID(),
    }),
  );
  await f.service.select({
    kind: 'team',
    organizationId: f.organizationId,
    workspaceId: f.workspaceId,
  });
  assert.ok(f.service.snapshot().context.generation > before);
  assert.equal(await f.service.canUse('linear'), false);
  const result = await f.service.scopeSnapshot('chat:changed', {
    revision: 99,
    chats: [{ id: 'private-chat' }],
  });
  // Chats are personal and never synced, so they stay visible in team workspaces.
  assert.deepEqual(result.chats, [{ id: 'private-chat' }]);
  assert.ok(f.stopped >= 2);
});
test('resolution snapshots expose only drafts for the active account and workspace', async () => {
  const f = fixture();
  await f.service.refresh();
  const { accountId } = f.service.snapshot().context;
  const draft = (id, team) => ({
    id,
    caseId: 'case',
    text: 'Draft',
    version: 1,
    source: '',
    team,
  });
  const team = { accountId, workspaceId: f.workspaceId };
  const resolutions = [
    draft('personal', undefined),
    draft('team', team),
    draft('other-team', { ...team, workspaceId: randomUUID() }),
    draft('other-account', { ...team, accountId: randomUUID() }),
  ];
  const visible = async () =>
    (
      await f.service.scopeSnapshot('playbooks:changed', { resolutions })
    ).resolutions.map((draft) => draft.id);
  f.service.documentsVisible = () => true;
  assert.deepEqual(await visible(), ['team']);
  f.service.documentsVisible = () => false;
  assert.deepEqual(await visible(), []);
  await f.service.select({ kind: 'personal' });
  assert.deepEqual(await visible(), ['personal']);
});
test('late account refresh cannot restore identity after sign-out', async () => {
  const f = fixture();
  await f.service.refresh();
  let resolve;
  f.api.view = () =>
    new Promise((r) => {
      resolve = r;
    });
  const refreshing = f.service.refresh();
  await new Promise((r) => setImmediate(r));
  await f.service.signOut();
  resolve({
    account: { id: randomUUID(), name: 'Old', email: 'old@example.test' },
    organizations: [],
    workspaces: [],
  });
  await refreshing;
  assert.equal(f.service.snapshot().view, null);
  assert.equal(f.service.snapshot().context.accountId, null);
});
test('pending invitation secrets stay in main and an old acceptance button cannot join a replacement invite', async () => {
  const f = fixture();
  await f.service.refresh();
  const link = (id) =>
    `supahelp://invite/accept?token=${id}.1.${'A'.repeat(43)}`;
  await f.service.receiveLink(link(randomUUID()));
  const old = f.service.snapshot().pendingInvitation.id;
  await f.service.receiveLink(link(randomUUID()));
  await assert.rejects(f.service.acceptWorkspaceInvitation(old, randomUUID()));
  assert.equal(f.accepted, 0);
  assert.doesNotMatch(
    JSON.stringify(f.service.snapshot()),
    /AAAAAA|accessToken|refreshToken/,
  );
});

test('a context switch while connection ownership is being blocked cannot bind an old attempt', async () => {
  const f = fixture();
  await f.service.refresh();
  const blocked = Promise.withResolvers();
  const access = {
    allows: async () => false,
    block: () => blocked.promise,
    bindAfterConnection: async () => {
      throw Error('must not bind');
    },
  };
  const service = new AccountService({
    auth: f.auth,
    api: f.api,
    access,
    changed() {},
    invalidate: async () => {},
  });
  await service.refresh();
  await service.select({ kind: 'personal' });
  const connecting = service.beginConnection('linear');
  await service.signOut();
  blocked.resolve('nonce');
  await assert.rejects(connecting, /changed/);
  assert.equal(await service.canManageConnection('linear', true), false);
});

test('a failed browser callback leaves a recoverable sign-in state', async () => {
  const f = fixture();
  f.auth.finish = async () => {
    throw Error('Private provider details');
  };
  await f.service.signIn();
  await assert.rejects(
    f.service.receiveLink(
      'supahelp://auth/callback?code=cancelled&state=state',
    ),
  );
  assert.equal(f.service.snapshot().status, 'unavailable');
  assert.doesNotMatch(
    JSON.stringify(f.service.snapshot()),
    /Private provider details/,
  );
});

test('granting a connection publishes a newer projection even when its provider revision stays the same', async () => {
  const f = fixture();
  await f.service.refresh();
  let allowed = false;
  const service = new AccountService({
    auth: f.auth,
    api: f.api,
    access: {
      allows: async () => allowed,
      block: async () => 'nonce',
      bindAfterConnection: async () => {
        allowed = true;
      },
    },
    changed() {},
    invalidate: async () => {},
  });
  await service.refresh();
  await service.select({ kind: 'personal' });
  const nonce = await service.beginConnection('linear');
  const before = await service.scopeSnapshot('linear:changed', {
    revision: 10,
    state: 'connected',
    actions: [],
  });
  service.finishConnection('linear', nonce, true);
  const after = await service.scopeSnapshot('linear:status', {
    revision: 10,
    state: 'connected',
    actions: [],
  });
  assert.equal(before.state, 'disconnected');
  assert.equal(after.state, 'connected');
  assert.ok(after.revision > before.revision);
});

test('billing return refreshes account state without granting payment access', async () => {
  const f = fixture();
  await f.service.refresh();
  const before = f.service.snapshot();
  await f.service.receiveLink('supahelp://billing/return');
  const after = f.service.snapshot();
  assert.ok(after.billingReturnId);
  assert.deepEqual(after.view.organizations, before.view.organizations);
  assert.equal(after.pendingInvitation, undefined);
  assert.equal(after.context.generation, before.context.generation);
  await f.service.select({
    kind: 'team',
    organizationId: f.organizationId,
    workspaceId: f.workspaceId,
  });
  assert.equal(f.service.snapshot().billingReturnId, undefined);
});

test('late reconciliation cannot replace B identity or team lists with A', async () => {
  const f = fixture();
  const gate = Promise.withResolvers();
  let entered = false;
  f.service.reconciled = async (view) => {
    if (view?.account.name === 'A') {
      entered = true;
      await gate.promise;
    }
  };
  const old = f.service.refresh();
  while (!entered) await new Promise((r) => setImmediate(r));
  await f.service.signOut();
  const id = randomUUID();
  f.value = {
    account: { id, name: 'B', email: 'b@example.test' },
    organizations: [],
    workspaces: [],
  };
  await f.service.refresh();
  gate.resolve();
  await old;
  assert.equal(f.service.snapshot().context.accountId, id);
  assert.equal(f.service.snapshot().view.account.id, id);
  assert.deepEqual(f.service.snapshot().view.organizations, []);
});
test('the newest refresh wins within the same account generation', async () => {
  const f = fixture();
  await f.service.refresh();
  const stale = structuredClone(f.service.snapshot().view),
    gate = Promise.withResolvers();
  f.api.view = () => gate.promise;
  const old = f.service.refresh();
  await new Promise((r) => setImmediate(r));
  f.api.view = async () => ({ ...stale, organizations: [], workspaces: [] });
  await f.service.refresh();
  gate.resolve(stale);
  await old;
  assert.deepEqual(f.service.snapshot().view.organizations, []);
});
test('failed workspace activation stays locked until a successful retry', async () => {
  const f = fixture();
  let fail = true;
  const service = new AccountService({
    auth: f.auth,
    api: f.api,
    access: { allows: async () => true },
    changed() {},
    invalidate: async () => {
      if (fail) throw Error('disk failure');
    },
  });
  await service.refresh();
  assert.throws(() => service.assertCurrentContext(service.snapshot().context));
  assert.equal(service.snapshot().view, null);
  fail = false;
  await service.refresh();
  service.assertCurrentContext(service.snapshot().context);
  assert.ok(service.snapshot().view);
});

test('a superseded browser callback cannot refresh or cancel a newer sign-in', async () => {
  const f = fixture(),
    gate = Promise.withResolvers();
  let calls = 0;
  f.auth.finish = () => gate.promise;
  f.api.view = async () => {
    calls++;
    throw Error('must not refresh a pending sign-in');
  };
  await f.service.signIn();
  const old = f.service.receiveLink(
    'supahelp://auth/callback?code=old&state=state',
  );
  await new Promise((r) => setImmediate(r));
  await f.service.signOut();
  await f.service.signIn();
  gate.resolve();
  await old;
  assert.equal(calls, 0);
  assert.equal(f.service.snapshot().status, 'signing-in');
});

test('a browser sign-in that finishes after a same-account context rebuild still binds the connection', async () => {
  const f = fixture();
  await f.service.refresh();
  const bound = [];
  const access = {
    allows: async (cap, id) => bound.includes(`${cap}:${id}`),
    block: async () => 'nonce',
    bindAfterConnection: async (cap, id) => {
      bound.push(`${cap}:${id}`);
    },
  };
  const service = new AccountService({
    auth: f.auth,
    api: f.api,
    access,
    changed() {},
    invalidate: async () => {},
  });
  await service.refresh();
  const authentication = service.authenticationGeneration();
  const id = await service.beginConnection('model:chatgpt');
  service.finishConnection('model:chatgpt', id, true);
  await service.select({ kind: 'personal' });
  await service.select({
    kind: 'team',
    organizationId: f.organizationId,
    workspaceId: f.workspaceId,
  });
  assert.equal(service.authenticationGeneration(), authentication);
  const settings = {
    providers: [{ id: 'chatgpt', state: 'ready', message: '' }],
    models: [],
    selected: { provider: 'claude', model: 'sonnet' },
  };
  const value = await service.scopeSnapshot('models:settings', settings);
  assert.equal(value.providers[0].state, 'ready');
  assert.deepEqual(bound, [`model:chatgpt:${service.principal()}`]);
  const second = await service.beginConnection('model:chatgpt');
  service.finishConnection('model:chatgpt', second, true);
  await service.signOut();
  await service.refresh();
  assert.notEqual(service.authenticationGeneration(), authentication);
  await service.scopeSnapshot('models:settings', settings);
  assert.equal(bound.length, 1);
});

test('personal connection setup can finish in Team and stays private to its owner', async () => {
  const f = fixture();
  let owner;
  const access = {
    allows: async (_cap, accountId) => accountId === owner,
    block: async () => 'nonce',
    bindAfterConnection: async (_cap, accountId) => {
      owner = accountId;
    },
  };
  const service = new AccountService({
    auth: f.auth,
    api: f.api,
    access,
    changed() {},
    invalidate: async () => {},
  });
  await service.refresh();
  await service.select({ kind: 'personal' });
  const capability = 'catalog:github-issues';
  const id = await service.beginConnection(capability);
  const view = service.snapshot().view;
  await service.select({
    kind: 'team',
    organizationId: view.organizations[0].id,
    workspaceId: view.workspaces[0].id,
  });
  const snapshot = (state, fields) =>
    service
      .scopeSnapshot('connections:status', {
        connections: [{ id: 'github-issues', state, ...fields }],
      })
      .then((value) => value.connections[0]);
  const pending = await snapshot('connecting', {
    verificationCode: 'fixture-code',
    manualReturn: true,
  });
  assert.equal(pending.verificationCode, 'fixture-code');
  assert.equal(pending.manualReturn, true);
  service.finishConnection(capability, id, true);
  const details = {
    account: 'Fixture',
    actions: [{ principal: service.principal() }],
  };
  const connected = await snapshot('connected', details);
  assert.equal(connected.state, 'connected');
  assert.equal(connected.account, 'Fixture');
  assert.equal(connected.actions.length, 1);
  assert.equal(await service.canManageConnection(capability), true);
  assert.equal(await service.canUse(capability), true);
  await service.signOut();
  const guest = await snapshot('connected', {
    ...details,
    verificationCode: 'fixture-code',
  });
  assert.equal(guest.state, 'disconnected');
  assert.equal(guest.account, undefined);
  assert.equal(guest.verificationCode, undefined);
});
test('an invite sent to the signed-in email shows without a link, declines in main, and ends with the session', async () => {
  const f = fixture();
  const token = `${randomUUID()}.1.${'B'.repeat(43)}`;
  const offer = {
    organizationName: 'Beta',
    workspaceName: 'Support',
    inviterName: 'Jo',
    role: 'member',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  let invites = [{ ...offer, token }];
  const declined = [];
  f.api.mine = async () => invites;
  f.api.decline = async (t) => {
    declined.push(t);
    invites = [];
  };
  await f.service.refresh();
  const pending = f.service.snapshot().pendingInvitation;
  assert.equal(pending.status, 'ready');
  assert.deepEqual(pending.offer, offer);
  assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /BBBBBB/);
  await f.service.declineWorkspaceInvitation(pending.id, randomUUID());
  assert.deepEqual(declined, [token]);
  assert.equal(f.service.snapshot().pendingInvitation, undefined);

  invites = [{ ...offer, token }];
  await f.service.refresh();
  assert.equal(f.service.snapshot().pendingInvitation.status, 'ready');
  await f.service.signOut();
  assert.equal(f.service.snapshot().pendingInvitation, undefined);
});

test('an account can use its own connections and approvals in Team', async () => {
  const f = fixture();
  let owner;
  const access = {
    allows: async (_cap, accountId) => accountId === owner,
    block: async () => 'nonce',
    bindAfterConnection: async (_cap, accountId) => {
      owner = accountId;
    },
  };
  const service = new AccountService({
    auth: f.auth,
    api: f.api,
    access,
    changed() {},
    invalidate: async () => {},
  });
  await service.refresh();
  await service.select({ kind: 'personal' });
  for (const capability of [
    'catalog:custom-api-0000abcd',
    'catalog:custom-mcp-0000abcd',
    'catalog:github-issues',
  ]) {
    const id = await service.beginConnection(capability);
    service.finishConnection(capability, id, true);
  }
  const view = service.snapshot().view;
  await service.select({
    kind: 'team',
    organizationId: view.organizations[0].id,
    workspaceId: view.workspaces[0].id,
  });
  const scoped = async (id) =>
    (
      await service.scopeSnapshot('connections:status', {
        connections: [
          {
            id,
            state: 'connected',
            actions: [{ principal: service.principal() }],
          },
        ],
      })
    ).connections[0];
  // Seeing each connection as connected binds it to the account.
  for (const id of [
    'custom-api-0000abcd',
    'custom-mcp-0000abcd',
    'github-issues',
  ]) {
    assert.equal((await scoped(id)).actions.length, 1);
    assert.equal(await service.canUse(`catalog:${id}`), true);
  }
  // Another account on this computer still can't use them.
  owner = 'someone-else';
  assert.equal(await service.canUse('catalog:github-issues'), false);
  assert.deepEqual((await scoped('github-issues')).actions, []);
});
