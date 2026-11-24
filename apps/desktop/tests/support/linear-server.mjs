import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export async function linearFixture() {
  let origin;
  let authorization;
  let scope;
  let issue = {
    id: 'issue-1',
    title: 'Checkout fails',
    description: 'A customer cannot check out.',
  };
  const mutations = [];
  const tools = [
    {
      name: 'get_issue',
      description: 'Read a Linear issue',
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'create_issue',
      description: 'Create a Linear issue',
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false,
      },
    },
  ];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const json = (value) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(value));
    };
    if (url.pathname.includes('.well-known/oauth-protected-resource'))
      return json({
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ['read', 'write'],
      });
    if (url.pathname.includes('.well-known'))
      return json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['read', 'write'],
      });
    if (url.pathname === '/register') {
      let body = '';
      for await (const chunk of req) body += chunk;
      return json({ ...JSON.parse(body), client_id: 'fixture-client' });
    }
    if (url.pathname === '/token') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body);
      if (
        params.get('grant_type') !== 'refresh_token' &&
        (!authorization ||
          createHash('sha256')
            .update(params.get('code_verifier') ?? '')
            .digest('base64url') !==
            authorization.searchParams.get('code_challenge'))
      ) {
        res.statusCode = 400;
        return json({ error: 'invalid_grant' });
      }
      return json({
        access_token: 'fixture-access-secret',
        token_type: 'Bearer',
        refresh_token: 'fixture-refresh-secret',
        expires_in: 3600,
        scope,
      });
    }
    if (url.pathname.startsWith('/mcp')) {
      if (req.headers.authorization !== 'Bearer fixture-access-secret') {
        res.writeHead(401, {
          'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${url.pathname.endsWith('readonly') ? 'read' : 'read write'}"`,
        });
        return res.end();
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const mcp = new Server(
        { name: 'fixture-linear', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );
      mcp.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: url.pathname.endsWith('readonly') ? tools.slice(0, 1) : tools,
      }));
      mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (request.params.name === 'create_issue') {
          mutations.push(request.params.arguments);
          issue = { id: 'issue-1', title: request.params.arguments.title };
        }
        return { content: [{ type: 'text', text: JSON.stringify(issue) }] };
      });
      res.on('close', () => void mcp.close());
      await mcp.connect(transport);
      return transport.handleRequest(req, res);
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    endpoint: `${origin}/mcp`,
    mutations,
    async authorize(address) {
      authorization = new URL(address);
      scope = authorization.searchParams.get('scope');
      const callback = new URL(authorization.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', 'wrong-state');
      callback.searchParams.set('code', 'fixture-code');
      if ((await fetch(callback)).status !== 400)
        throw Error('Incorrect OAuth state was accepted.');
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
