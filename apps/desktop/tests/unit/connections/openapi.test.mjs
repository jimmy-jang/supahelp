import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiConnection } from '../../../src/main/integrations/connection-api.ts';
import { loadApiSpec } from '../../../src/main/integrations/connection-api/api-spec.ts';
import { importOpenApi } from '../../../src/main/integrations/connection-api/openapi.ts';
import { providerFor } from '../../../src/main/integrations/connection-providers.ts';

const Pet = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', example: 'Rex', xml: { name: 'x' } },
    owner: { $ref: '#/components/schemas/Owner' },
  },
};
const spec = {
  openapi: '3.0.3',
  info: { title: 'Pets' },
  servers: [{ url: 'https://elsewhere.test/v1' }],
  components: {
    schemas: {
      Pet,
      Owner: {
        type: 'object',
        properties: { pet: { $ref: '#/components/schemas/Pet' } },
      },
    },
    parameters: {
      Limit: { name: 'limit', in: 'query', schema: { type: 'integer' } },
    },
  },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List pets',
        parameters: [{ $ref: '#/components/parameters/Limit' }],
      },
      post: {
        summary: 'Create a pet',
        requestBody: {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Pet' },
            },
          },
        },
      },
    },
    '/pets/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, description: 'Pet id' },
      ],
      delete: {
        operationId: 'listPets',
        parameters: [
          { name: 'force', in: 'query', schema: { type: 'boolean' } },
        ],
      },
    },
    '/upload': {
      post: {
        requestBody: { content: { 'multipart/form-data': { schema: {} } } },
      },
    },
    '/hook': {
      post: {
        parameters: [{ name: 'X-Tenant', in: 'header', required: true }],
      },
    },
    '/pets/{pet-id}': { get: {} },
  },
};

test('OpenAPI import builds tool definitions, ignores the spec server host and skips what it cannot call', () => {
  const { operations, skipped, title } = importOpenApi(
    spec,
    'https://api.example.test',
  );
  assert.equal(title, 'Pets');
  const by = Object.fromEntries(operations.map((o) => [o.name, o]));
  assert.deepEqual(Object.keys(by), ['listPets', 'post_pets', 'listPets_2']);
  // Paths take the spec's server path prefix because the base address lacks it, never its host.
  assert.equal(by.listPets.path, '/v1/pets');
  assert.deepEqual(by.listPets.query, ['limit']);
  assert.equal(by.listPets.readOnly, true);
  assert.equal(by.post_pets.readOnly, false);
  assert.deepEqual(by.post_pets.inputSchema.required, ['name']);
  assert.deepEqual(by.post_pets.query, []);
  // $ref inlined, junk dropped, cycle cut off.
  assert.deepEqual(by.post_pets.inputSchema.properties.name, {
    type: 'string',
  });
  assert.equal(by.post_pets.inputSchema.properties.owner.type, 'object');
  assert.deepEqual(by.listPets_2.inputSchema.required, ['id']);
  assert.equal(by.listPets_2.inputSchema.properties.id.description, 'Pet id');
  assert.equal(skipped.length, 3);
  assert.match(skipped.join('\n'), /multipart|only JSON/);
  assert.match(skipped.join('\n'), /X-Tenant/);
  assert.match(skipped.join('\n'), /unsupported path/);
  // No double prefix when the user's base address already ends with it.
  assert.equal(
    importOpenApi(spec, 'https://api.example.test/v1').operations[0].path,
    '/pets',
  );
});

test('OpenAPI import rejects other documents and reads Swagger 2 bodies', () => {
  assert.throws(
    () => importOpenApi({ hello: 1 }, 'https://a.test'),
    /not an OpenAPI/,
  );
  const { operations } = importOpenApi(
    {
      swagger: '2.0',
      basePath: '/',
      paths: {
        '/items': {
          post: {
            parameters: [
              {
                name: 'body',
                in: 'body',
                schema: {
                  type: 'object',
                  properties: { title: { type: 'string' } },
                },
              },
            ],
          },
        },
      },
    },
    'https://a.test',
  );
  assert.deepEqual(Object.keys(operations[0].inputSchema.properties), [
    'title',
  ]);
});

test('generated definitions connect, route query and body arguments, and send no empty query string', async (t) => {
  const { operations } = importOpenApi(spec, 'https://api.example.test/v1');
  const api = new ApiConnection(
    providerFor('custom-api'),
    {
      access: 'write',
      actions: [],
      values: {
        name: 'Pets',
        endpoint: 'https://api.example.test/v1',
        header: 'Authorization',
        key: 'Bearer secret',
        operations: JSON.stringify(operations),
      },
    },
    async () => {},
    async () => {},
  );
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    seen.push([String(url), init.method, init.body]);
    return new Response('{}', {
      headers: { 'content-type': 'application/json' },
    });
  });
  await api.callTool('listPets_2', { id: 'a', force: true });
  await api.callTool('post_pets', { name: 'Rex' });
  await api.callTool('listPets', {});
  assert.deepEqual(seen, [
    ['https://api.example.test/v1/pets/a?force=true', 'DELETE', undefined],
    ['https://api.example.test/v1/pets', 'POST', '{"name":"Rex"}'],
    ['https://api.example.test/v1/pets', 'GET', undefined],
  ]);
});

test('spec loading tries usual addresses, keeps the credential on the API origin and explains YAML', async (t) => {
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    asked.push([String(url), init.headers.Authorization]);
    if (String(url).endsWith('/swagger.json') && String(url).includes('/v1/'))
      return new Response(JSON.stringify(spec));
    return new Response('nope', { status: 404 });
  });
  const preview = await loadApiSpec({
    endpoint: 'https://api.example.test/v1',
    header: 'Authorization',
    key: 'secret',
  });
  assert.equal(preview.operations.length, 3);
  assert.equal(preview.source, 'https://api.example.test/v1/swagger.json');
  assert.ok(asked.every(([, auth]) => auth === 'secret'));
  asked.length = 0;
  await loadApiSpec({
    endpoint: 'https://api.example.test',
    header: 'Authorization',
    key: 'secret',
    url: 'https://specs.example.test/spec.json',
  }).catch(() => {});
  assert.equal(asked[0][1], undefined);
  await assert.rejects(
    loadApiSpec({
      endpoint: 'https://api.example.test',
      text: 'openapi: 3.0.0\n',
    }),
    /YAML/,
  );
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('x', { status: 404 }),
  );
  await assert.rejects(
    loadApiSpec({ endpoint: 'https://api.example.test' }),
    /No OpenAPI spec was found/,
  );
});

test('a REST API with no credential connects without an auth header', async () => {
  const { configureCustomApi } =
    await import('../../../src/main/integrations/connection-api/custom-api.ts');
  const { headers } = configureCustomApi({
    values: {
      endpoint: 'https://api.example.com/v1',
      header: '',
      key: '',
      operations: JSON.stringify([
        {
          name: 'list',
          description: 'List',
          method: 'GET',
          path: '/items',
          inputSchema: { type: 'object', properties: {} },
          readOnly: true,
        },
      ]),
    },
  });
  assert.deepEqual(headers, {});
});
