import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { connectionUrl, type CatalogRecord } from '../connection-oauth.ts';
export type Operation = Tool & {
  method: string;
  path: string;
  query?: (args: Record<string, unknown>) => Record<string, string>;
  body?: (args: Record<string, unknown>) => unknown;
  // Non-JSON uploads (Drive media/multipart): sent as-is with this content type.
  raw?: (args: Record<string, unknown>) => { type: string; body: string };
};
export const string = { type: 'string', minLength: 1, maxLength: 10000 };
export function operation(
  name: string,
  description: string,
  method: string,
  path: string,
  properties: Record<string, object> = {},
  extra: Partial<Operation> = {},
): Operation {
  return {
    name,
    description,
    method,
    path,
    inputSchema: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
    annotations: { readOnlyHint: method === 'GET' },
    ...extra,
  };
}
export const id = { id: string };
export const query = { query: string };
export const text = { ...id, text: string };
export const remaining = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'id'));
export const asQuery = (args: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(args).map(([key, value]) => [key, String(value)]),
  );
export const scope = (record: CatalogRecord, read: string, write: string) =>
  record.access === 'write' ? `${read} ${write}` : read;
export const zohoDomains: Record<string, string> = {
  US: 'com',
  EU: 'eu',
  AU: 'com.au',
  IN: 'in',
  JP: 'jp',
  CA: 'ca',
};

export function tenant(value: string, suffix: string) {
  const url = connectionUrl(value.includes('://') ? value : `https://${value}`);
  if (
    !url.hostname.endsWith(suffix) ||
    url.port ||
    url.pathname !== '/' ||
    url.search
  )
    throw Error('Enter a canonical workspace address.');
  return url.origin;
}
