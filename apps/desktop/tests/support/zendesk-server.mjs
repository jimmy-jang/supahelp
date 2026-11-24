import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
export async function zendeskFixture() {
  let origin;
  let authorization;
  let version = 0;
  let token = 'zendesk-fixture-access';
  const requests = [];
  const writes = [];
  const comments = [];
  const audits = new Map();
  const failures = new Map();
  const ticket = {
    id: 123,
    subject: 'Checkout fails',
    status: 'open',
    description: 'Customer cannot check out.',
    updated_at: '2026-11-07T00:00:00Z',
    requester_id: 456,
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const json = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    let text = '';
    for await (const part of req) text += part;
    const body = text ? JSON.parse(text) : undefined;
    requests.push({ path: url.pathname, method: req.method, body });
    if (failures.has(url.pathname))
      return json({ error: 'fixture_failure' }, failures.get(url.pathname));
    if (url.pathname === '/oauth/tokens') {
      if ('client_secret' in body || body.client_id !== 'public-client')
        return json({ error: 'invalid_client' }, 400);
      if (
        body.grant_type === 'authorization_code' &&
        (!authorization ||
          createHash('sha256')
            .update(body.code_verifier)
            .digest('base64url') !==
            authorization.searchParams.get('code_challenge'))
      )
        return json({ error: 'invalid_grant' }, 400);
      if (body.grant_type === 'refresh_token')
        token = `zendesk-fixture-access-${++version}`;
      return json({
        access_token: token,
        token_type: 'bearer',
        refresh_token: `zendesk-fixture-refresh-${version}`,
        scope: authorization.searchParams.get('scope'),
        expires_in: 1800,
      });
    }
    if (req.headers.authorization !== `Bearer ${token}`)
      return json({ error: 'unauthorized' }, 401);
    if (url.pathname === '/api/v2/users/me.json')
      return json({ user: { id: 7, name: 'Test Agent', role: 'agent' } });
    if (url.pathname === '/api/v2/search.json')
      return json({
        results: [{ ...ticket, result_type: 'ticket' }],
        count: 1,
      });
    if (url.pathname === '/api/v2/tickets/123/comments.json')
      return json({ comments, next_page: null });
    const match = url.pathname.match(
      /^\/api\/v2\/tickets\/123\/audits\/(\d+)\.json$/,
    );
    if (match) return json({ audit: audits.get(Number(match[1])) });
    if (url.pathname === '/api/v2/tickets/123.json') {
      if (req.method === 'GET') return json({ ticket });
      if (req.method === 'PUT') {
        if (!authorization.searchParams.get('scope').includes('tickets:write'))
          return json({ error: 'forbidden' }, 403);
        if (
          !body.ticket.safe_update ||
          body.ticket.updated_stamp !== ticket.updated_at
        )
          return json({ error: 'UpdateConflict' }, 409);
        writes.push(body.ticket);
        const audit = { id: writes.length, ticket_id: 123, events: [] };
        if (body.ticket.status) ticket.status = body.ticket.status;
        if (body.ticket.comment) {
          const comment = { id: writes.length, ...body.ticket.comment };
          comments.push(comment);
          audit.events.push({ type: 'Comment', ...comment });
        }
        ticket.updated_at = `2026-11-07T00:00:${String(writes.length).padStart(2, '0')}Z`;
        audits.set(audit.id, audit);
        return json({ ticket, audit });
      }
    }
    return json({ error: 'not_found' }, 404);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    writes,
    requests,
    ticket,
    comments,
    failures,
    async authorize(address) {
      authorization = new URL(address);
      const callback = new URL(authorization.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', 'wrong');
      callback.searchParams.set('code', 'fixture-code');
      if ((await fetch(callback)).status !== 400)
        throw Error('Invalid OAuth state accepted.');
      callback.searchParams.set(
        'state',
        authorization.searchParams.get('state'),
      );
      if ((await fetch(callback)).status !== 200)
        throw Error('OAuth callback failed.');
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
