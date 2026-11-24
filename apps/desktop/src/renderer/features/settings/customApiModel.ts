import type { ApiOperationDraft } from '../../../contracts/catalog';

// Pure helpers for the "Your REST API" setup form: credential headers and hand-written endpoints.
export const authKinds = [
  'No authentication',
  'Bearer token',
  'API key header',
  'Basic auth',
];
export const MAX_OPERATIONS = 50;
// The connect request is capped at 100 000 characters in total.
export const MAX_OPERATIONS_JSON = 80000;

export function credential(kind: string, secret: string, headerName: string) {
  const text = secret.trim();
  if (kind === 'No authentication' || !text) return { header: '', key: '' };
  if (kind === 'Basic auth') {
    const bytes = new TextEncoder().encode(text);
    return {
      header: 'Authorization',
      key: `Basic ${btoa(String.fromCharCode(...bytes))}`,
    };
  }
  if (kind === 'API key header')
    return { header: headerName.trim() || 'X-API-Key', key: text };
  return {
    header: 'Authorization',
    key: `Bearer ${text.replace(/^bearer\s+/i, '')}`,
  };
}

export type EndpointRow = {
  method: ApiOperationDraft['method'];
  path: string;
  description: string;
  // Comma or space separated argument names.
  query: string;
  body: string;
  readOnly: boolean;
};
export const blankRow = (): EndpointRow => ({
  method: 'GET',
  path: '',
  description: '',
  query: '',
  body: '',
  readOnly: true,
});

const names = (text: string) => [
  ...new Set(text.split(/[\s,]+/).filter(Boolean)),
];

// Rows with no path are ignored. A bad row stops the list with a message naming it.
export function rowsToOperations(rows: EndpointRow[]) {
  const operations: ApiOperationDraft[] = [];
  const used = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const path = row.path.trim();
    if (!path) continue;
    const fail = (reason: string) => ({
      operations: [],
      error: `Endpoint ${index + 1}: ${reason}`,
    });
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      /[?#\\\s]/.test(path) ||
      path.split('/').some((part) => part === '.' || part === '..')
    )
      return fail('use a path like /customers/{id} without a query string.');
    const pathNames = [...path.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!);
    if (pathNames.some((name) => !/^\w+$/.test(name)))
      return fail('path parameters may only use letters, numbers and _.');
    const query = names(row.query);
    const body = row.method === 'GET' ? [] : names(row.body);
    const all = [...pathNames, ...query, ...body];
    if (all.some((name) => !/^[\w.-]{1,64}$/.test(name)))
      return fail('field names may only use letters, numbers, _ . and -.');
    if (new Set(all).size !== all.length)
      return fail('a field name is used twice.');
    const slug = path
      .replace(/\{(\w+)\}/g, '$1')
      .replace(/\W+/g, '_')
      .replace(/^_+|_+$/g, '');
    const base = `${row.method.toLowerCase()}_${slug || 'root'}`.slice(0, 60);
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    operations.push({
      name,
      description:
        row.description.trim().slice(0, 300) || `${row.method} ${path}`,
      method: row.method,
      path,
      inputSchema: {
        type: 'object',
        properties: {
          ...Object.fromEntries(pathNames.map((n) => [n, { type: 'string' }])),
          ...Object.fromEntries(query.map((n) => [n, { type: 'string' }])),
          ...Object.fromEntries(body.map((n) => [n, {}])),
        },
        required: [...new Set(pathNames)],
        additionalProperties: false,
      },
      readOnly: row.readOnly,
      query,
    });
  }
  return { operations, error: undefined as string | undefined };
}

export const operationsJson = (operations: ApiOperationDraft[]) =>
  JSON.stringify(
    operations.map(
      ({ name, description, method, path, inputSchema, readOnly, query }) => ({
        name,
        description,
        method,
        path,
        inputSchema,
        readOnly,
        query,
      }),
    ),
  );
