import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { AuthKit } from '../src/main/integrations/authkit.ts';
import { parseAppLink } from '../src/main/features/accounts/links.ts';

const jwt = (exp) =>
  'eyJhbGciOiJSUzI1NiJ9.' +
  Buffer.from(
    JSON.stringify({ sub: 'user_a', sid: 'session_a', exp }),
  ).toString('base64url') +
  '.signature';
function setup() {
  let saved,
    opened,
    time = Date.now(),
    refreshes = 0,
    release;
  const requests = [];
  const store = {
    async assertAvailable() {},
    async load() {
      return saved;
    },
    async save(s) {
      saved = s;
    },
    async clear() {
      saved = undefined;
    },
  };
  const auth = new AuthKit({
    clientId: 'client_test',
    store,
    openExternal: async (url) => {
      opened = new URL(url);
    },
    now: () => time,
    fetch: async (url, options) => {
      assert.equal(new URL(url).pathname, '/user_management/authenticate');
      const body = JSON.parse(options.body);
      requests.push(body);
      assert.equal(body.client_secret, undefined);
      if (body.grant_type === 'refresh_token') {
        refreshes++;
        if (release) await release;
      }
      return Response.json({
        access_token: jwt(Math.floor(time / 1000) + 60),
        refresh_token: 'rotated-refresh',
        user: {
          object: 'user',
          id: 'user_a',
          email: 'a@example.test',
          email_verified: true,
          first_name: 'A',
          last_name: 'Person',
          profile_picture_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          metadata: {},
        },
        authentication_method: 'GoogleOAuth',
      });
    },
  });
  return {
    auth,
    requests,
    get saved() {
      return saved;
    },
    get opened() {
      return opened;
    },
    get refreshes() {
      return refreshes;
    },
    advance(ms) {
      time += ms;
    },
    defer() {
      let done;
      release = new Promise((r) => {
        done = r;
      });
      return done;
    },
  };
}
const callback = (s) =>
  `supahelp://auth/callback?code=code_test&state=${s.opened.searchParams.get('state')}`;

test('native sign-in uses public-client PKCE, verifies state and rejects callback replay', async () => {
  const s = setup();
  await s.auth.begin();
  assert.equal(s.opened.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    s.opened.searchParams.get('redirect_uri'),
    'https://www.supahelp.app/auth/callback',
  );
  await assert.rejects(
    s.auth.finish('supahelp://auth/callback?code=x&state=wrong'),
  );
  await s.auth.finish(callback(s));
  assert.equal(
    createHash('sha256')
      .update(s.requests[0].code_verifier)
      .digest('base64url'),
    s.opened.searchParams.get('code_challenge'),
  );
  assert.ok(await s.auth.token(new AbortController().signal));
  await assert.rejects(s.auth.finish(callback(s)));
  assert.equal(s.saved.subject, 'user_a');
});

test('expired pending flows and cancelled exchanges cannot save a session', async () => {
  const s = setup();
  await s.auth.begin();
  s.advance(600_001);
  await assert.rejects(s.auth.finish(callback(s)));
  await s.auth.begin();
  s.auth.cancel();
  await assert.rejects(s.auth.finish(callback(s)));
  assert.equal(s.saved, undefined);
});

test('refresh is single-flight and sign-out during refresh cannot resurrect credentials', async () => {
  const s = setup();
  await s.auth.begin();
  await s.auth.finish(callback(s));
  s.advance(55_000);
  await Promise.all([
    s.auth.token(new AbortController().signal),
    s.auth.token(new AbortController().signal),
  ]);
  assert.equal(s.refreshes, 1);
  s.advance(55_000);
  const release = s.defer();
  const pending = s.auth
    .token(new AbortController().signal)
    .catch(() => undefined);
  await new Promise((r) => setImmediate(r));
  await s.auth.signOut();
  release();
  await pending;
  assert.equal(s.saved, undefined);
  assert.equal(await s.auth.token(new AbortController().signal), undefined);
});

test('native callbacks and pasted invitation URLs have separate exact destinations', () => {
  const token = 'a4d3ae04-ab25-4d24-8eca-213d26e058bd.1.' + 'A'.repeat(43);
  assert.equal(
    parseAppLink('https://evil.test/auth/callback?code=x&state=y'),
    undefined,
  );
  assert.equal(
    parseAppLink('supahelp://auth/callback?code=x&state=y')?.kind,
    'auth',
  );
  assert.equal(
    parseAppLink(`supahelp://invite/accept?token=${token}`)?.kind,
    'invite',
  );
  assert.equal(
    parseAppLink(`https://supahelp.app/invite#${token}`)?.kind,
    'invite',
  );
  assert.equal(
    parseAppLink(`https://www.supahelp.app/invite#${token}`)?.kind,
    'invite',
  );
  assert.equal(
    parseAppLink(`https://supahelp.app.evil.test/invite#${token}`),
    undefined,
  );
  assert.equal(
    parseAppLink('supahelp://auth/callback/other?code=x&state=y'),
    undefined,
  );
});

test('desktop auth rejects an ambient WorkOS server key before making requests', () => {
  const previous = process.env.WORKOS_API_KEY;
  process.env.WORKOS_API_KEY = 'fixture-server-key';
  try {
    assert.throws(() => setup(), /server credentials/);
  } finally {
    if (previous === undefined) delete process.env.WORKOS_API_KEY;
    else process.env.WORKOS_API_KEY = previous;
  }
});

test('definitive refresh rejection is distinguishable from an offline retry and clears the retained subject', async () => {
  let stored = {
    accessToken: 'expired-fixture',
    refreshToken: 'refresh-fixture',
    subject: 'user_a',
    sessionId: 'session_a',
    expiresAt: 1,
  };
  const auth = new AuthKit({
    clientId: 'client_fixture',
    store: {
      load: async () => stored,
      save: async (s) => {
        stored = s;
      },
      clear: async () => {
        stored = undefined;
      },
      assertAvailable: async () => {},
    },
    openExternal: async () => {},
    fetch: async () =>
      Response.json(
        { error: 'invalid_grant', error_description: 'Controlled rejection' },
        { status: 401 },
      ),
  });
  await assert.rejects(
    auth.token(new AbortController().signal),
    (error) => error.code === 'account-session-revoked',
  );
  assert.equal(await auth.cachedSubject(), undefined);
  assert.equal(stored, undefined);
  await auth.close();
});

test('billing return links request a refresh and carry no payment authority', () => {
  assert.deepEqual(parseAppLink('supahelp://billing/return'), {
    kind: 'billing',
  });
  for (const value of [
    'supahelp://billing/return?paid=true',
    'supahelp://billing/return#paid',
    'https://evil.test/billing/return',
    'supahelp://billing/other',
    'supahelp://user@billing/return',
  ])
    assert.equal(parseAppLink(value), undefined);
});
