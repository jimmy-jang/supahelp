import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { connectionUrl, type CatalogRecord } from '../connection-oauth.ts';
import { asQuery, operation, type Operation } from './operations.ts';

// One credential header, or a throw. Shared with the spec import so a bad header fails the same way in both.
export function credentialHeader(name: string, value: string) {
  if (
    !/^[!#$%&'*+.^_`|~\w-]{1,100}$/.test(name) ||
    /^(host|cookie|content-length|connection|transfer-encoding|proxy-.*)$/i.test(
      name,
    ) ||
    /[\r\n]/.test(value)
  )
    throw Error('Invalid credential header.');
  return { [name]: value };
}

export function configureCustomApi(record: CatalogRecord) {
  const v = record.values;
  const headers: Record<string, string> = {};

  const endpoint = connectionUrl(v.endpoint, true);
  if (endpoint.search)
    throw Error('Use a base address without query parameters.');
  const base = endpoint.href.replace(/\/$/, '');
  v.endpoint = base;
  // Some APIs need no credential: an empty key sends none.
  if (v.key) Object.assign(headers, credentialHeader(v.header, v.key));
  const definitions: unknown = JSON.parse(v.operations);
  if (
    !Array.isArray(definitions) ||
    !definitions.length ||
    definitions.length > 50
  )
    throw Error('Describe between 1 and 50 operations.');
  const names = new Set();
  const operations: Operation[] = definitions.map((value) => {
    const o = value as Record<string, unknown>;
    if (
      !o ||
      typeof o.name !== 'string' ||
      !/^[\w-]{1,64}$/.test(o.name) ||
      names.has(o.name) ||
      !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(o.method)) ||
      typeof o.path !== 'string' ||
      !o.path.startsWith('/') ||
      o.path.startsWith('//') ||
      /[?#\\]/.test(o.path) ||
      o.path.split('/').some((part) => part === '.' || part === '..') ||
      typeof o.description !== 'string' ||
      typeof o.readOnly !== 'boolean' ||
      !o.inputSchema ||
      typeof o.inputSchema !== 'object' ||
      Array.isArray(o.inputSchema) ||
      (o.query !== undefined &&
        (!Array.isArray(o.query) ||
          o.query.length > 50 ||
          o.query.some(
            (n) => typeof n !== 'string' || !/^[\w.-]{1,64}$/.test(n),
          )))
    )
      throw Error('Invalid operation definition.');
    names.add(o.name);
    // With a `query` list, exactly those arguments go in the query string and the rest in the JSON body.
    // Without one (older definitions), GET sends every argument as query and other methods send them all as body.
    const queryNames = o.query as string[] | undefined;
    const pathNames = [...o.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    const routed = queryNames
      ? {
          query: (args: Record<string, unknown>) =>
            Object.fromEntries(
              queryNames
                .filter((n) => args[n] !== undefined)
                .map((n) => [n, String(args[n])]),
            ),
          body: (args: Record<string, unknown>) => {
            const rest = Object.entries(args).filter(
              ([n]) => !queryNames.includes(n) && !pathNames.includes(n),
            );
            return rest.length ? Object.fromEntries(rest) : undefined;
          },
        }
      : o.method === 'GET'
        ? { query: asQuery }
        : {};
    return operation(
      o.name,
      o.description,
      String(o.method),
      o.path,
      {},
      {
        inputSchema: o.inputSchema as Tool['inputSchema'],
        annotations: { readOnlyHint: o.readOnly },
        ...routed,
      },
    );
  });

  return { base, headers, operations, endpoints: undefined };
}
