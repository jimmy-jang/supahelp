import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { ConnectionReturn } from '../../../src/main/integrations/connection-oauth.ts';
import { ApiConnection } from '../../../src/main/integrations/connection-api.ts';
import { configureSlack } from '../../../src/main/integrations/connection-api/slack.ts';
import { providerFor } from '../../../src/main/integrations/connection-providers.ts';
const rec = () => ({
  values: { channels: 'C1234567' },
  access: 'read',
  actions: [],
});
function env(t, key, value) {
  const old = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  });
}
const key = 'SUPAHELP_SLACK_CALLBACK_ORIGIN';

test('the loopback listener answers the browser after denying sign-in', async (t) => {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const { port } = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));
  const returning = new ConnectionReturn(`http://127.0.0.1:${port}/callback`);
  t.after(() => returning.close());
  await returning.start();
  const callback = new URL(returning.redirect);
  callback.searchParams.set('state', returning.state);
  callback.searchParams.set('error', 'access_denied');

  const denied = assert.rejects(returning.code(), /Sign-in cancelled/);
  const response = await fetch(callback);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Return to Supahelp/);
  await denied;
});

test('Slack HTTPS relay is opt-in, build-owned, HTTPS only and does not alter BYO apps', (t) => {
  const record = rec();
  record.values.callbackOrigin = 'https://untrusted.test';
  env(t, key, undefined);
  assert.equal(configureSlack(record).endpoints.providerRedirectUri, undefined);
  for (const origin of [
    'http://relay.example',
    'https://localhost',
    'https://relay.example:8443',
    'https://name@relay.example',
    'https://relay.example/path',
    'https://relay.example/?next=elsewhere',
    'https://relay.example/#bad',
  ]) {
    process.env[key] = origin;
    assert.throws(() => configureSlack(record));
  }
  process.env[key] = 'https://relay.example';
  record.values.clientId = 'byo';
  assert.equal(configureSlack(record).endpoints.providerRedirectUri, undefined);
});
test('Slack authorizes and exchanges with identical HTTPS URI and matching desktop-only PKCE', async (t) => {
  env(t, key, 'https://relay.example');
  env(t, 'SUPAHELP_SLACK_CLIENT_ID', 'test-client');
  t.mock.method(ConnectionReturn.prototype, 'start', async function () {
    assert.equal(this.redirect.href, 'http://127.0.0.1:49154/callback');
  });
  const record = rec();
  const redirect = 'https://relay.example/oauth/slack/desktop-callback';
  let challenge,
    saves = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) === 'https://slack.com/api/auth.test')
      return Response.json({ ok: true, user: 'test' });
    assert.equal(String(url), 'https://slack.com/api/oauth.v2.access');
    assert.equal(init.body.get('redirect_uri'), redirect);
    assert.equal(init.body.has('client_secret'), false);
    assert.equal(init.body.get('code'), 'test-code');
    assert.equal(
      createHash('sha256')
        .update(init.body.get('code_verifier'))
        .digest('base64url'),
      challenge,
    );
    return Response.json({
      ok: true,
      authed_user: { access_token: 'test-user-token' },
    });
  });
  const api = new ApiConnection(
    providerFor('slack'),
    record,
    async () => {
      saves++;
    },
    async (href) => {
      const u = new URL(href);
      assert.equal(
        u.origin + u.pathname,
        'https://slack.com/oauth/v2/authorize',
      );
      const p = u.searchParams;
      assert.equal(p.get('redirect_uri'), redirect);
      assert.equal(p.get('scope'), '');
      assert.equal(p.get('user_scope'), 'channels:history,groups:history');
      assert.equal(p.get('code_challenge_method'), 'S256');
      assert.equal(p.has('code_verifier'), false);
      challenge = p.get('code_challenge');
      const local = 'http://127.0.0.1:49154/callback';
      const query = `?state=${p.get('state')}&code=test-code`;
      assert.throws(() => api.finish(redirect + query));
      assert.throws(() => api.finish(local + '?state=wrong&code=test-code'));
      api.finish(local + query);
      assert.throws(() => api.finish(local + query));
    },
  );
  t.after(() => api.close());
  await api.connect(true);
  assert.equal(record.tokens.access_token, 'test-user-token');
  assert.equal(saves, 1);
});
