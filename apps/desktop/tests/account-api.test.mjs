import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { AccountApi } from '../src/main/integrations/account-api.ts';
const account = {
  id: randomUUID(),
  name: 'Person',
  email: 'person@example.test',
};
test('profile edits use authenticated endpoints and organization icons are validated', async () => {
  const organizationId = randomUUID();
  const calls = [];
  let icon = 'data:image/jpeg;base64,/9j/AA==';
  const api = new AccountApi(
    'https://api.example.test',
    async () => 'token',
    async (url, options) => {
      calls.push({ url, method: options.method, body: options.body });
      if (options.method === 'PUT')
        return Response.json({ ok: true, value: { name: 'New name' } });
      return Response.json({
        ok: true,
        value: {
          account,
          organizations: [
            {
              id: organizationId,
              name: 'Acme',
              icon,
              ownerId: account.id,
              access: 'active',
              capacity: 5,
              assigned: 1,
              reserved: 0,
              source: 'pilot',
              expiresAt: null,
            },
          ],
          workspaces: [],
        },
      });
    },
  );
  const signal = new AbortController().signal;
  await api.renameAccount('New name', signal);
  assert.equal(calls.at(-1).url, 'https://api.example.test/v1/account/name');
  await api.setOrganizationIcon({ organizationId, icon }, signal);
  assert.equal(
    calls.at(-1).url,
    `https://api.example.test/v1/organizations/${organizationId}/icon`,
  );
  assert.equal((await api.view(signal)).organizations[0].icon, icon);
  icon = 'https://untrusted.example/icon';
  await assert.rejects(api.view(signal));
});
test('account client pins origins, validates public state and rejects secret-bearing response fields', async () => {
  assert.throws(() => new AccountApi('http://evil.test', async () => 'token'));
  const calls = [];
  const api = new AccountApi(
    'https://api.example.test',
    async () => 'private-token',
    async (url, options) => {
      calls.push({ url, options });
      return Response.json({
        ok: true,
        value: {
          account: { ...account, accessToken: 'must-not-escape' },
          organizations: [],
          workspaces: [],
          refreshToken: 'must-not-escape',
        },
      });
    },
  );
  const value = await api.view(new AbortController().signal);
  assert.deepEqual(value, { account, organizations: [], workspaces: [] });
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-token');
  await assert.rejects(
    api.createWorkspace(
      { organizationId: '../../evil', name: 'x', requestId: randomUUID() },
      new AbortController().signal,
    ),
  );
  assert.equal(calls.length, 1);
});
test('account client rejects malformed state and exposes only safe availability errors', async () => {
  const api = new AccountApi(
    'https://api.example.test',
    async () => 'token',
    async () => Response.json({ ok: true, value: { account: null } }),
  );
  await assert.rejects(
    api.view(new AbortController().signal),
    /account service|Account service/i,
  );
});

test('onboarding completion is validated and uses the dedicated authenticated endpoint', async () => {
  let value = {
    account,
    organizations: [],
    workspaces: [],
    onboarding: null,
    onboardingCompleted: false,
  };
  const calls = [];
  const api = new AccountApi(
    'https://api.example.test',
    async () => 'token',
    async (url, options) => {
      calls.push({ url, method: options.method });
      return Response.json({ ok: true, value });
    },
  );
  const signal = new AbortController().signal;
  assert.equal((await api.view(signal)).onboardingCompleted, false);
  value.onboardingCompleted = 'false';
  await assert.rejects(api.view(signal));
  value = { completed: true };
  assert.deepEqual(await api.completeOnboarding(signal), { completed: true });
  assert.deepEqual(calls.at(-1), {
    url: 'https://api.example.test/v1/account/onboarding/complete',
    method: 'POST',
  });
  value = { completed: 'yes' };
  await assert.rejects(api.completeOnboarding(signal));
});

test('billing reads as not available when the API build has no billing route', async () => {
  const org = randomUUID();
  const missing = new AccountApi(
    'https://api.example.test',
    async () => 'token',
    async () => new Response('404 Not Found', { status: 404 }),
  );
  const view = await missing.billingView(org, new AbortController().signal);
  assert.equal(view.enabled, false);
  assert.equal(view.hasSubscription, false);
  const down = new AccountApi(
    'https://api.example.test',
    async () => 'token',
    async () => new Response('Bad Gateway', { status: 502 }),
  );
  await assert.rejects(
    down.billingView(org, new AbortController().signal),
    /account service/i,
  );
});
