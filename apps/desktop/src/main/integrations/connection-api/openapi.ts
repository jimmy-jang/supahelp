import type { ApiOperationDraft } from '../../../contracts/catalog';
import { ProviderError } from '../connection-oauth.ts';

// Turns an OpenAPI 3 / Swagger 2 document into the operation definitions "Your REST API" stores.
// Only JSON bodies, path and query parameters are supported; anything else is skipped with a reason.
// The document's own server address is never used: the user's base address is the only destination.

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const KEEP = [
  'type',
  'description',
  'enum',
  'const',
  'default',
  'nullable',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'required',
  'items',
  'properties',
  'additionalProperties',
  'oneOf',
  'anyOf',
  'allOf',
];
const MAX_OPERATIONS = 500;
const MAX_SCHEMA = 20000;
const MAX_NODES = 2000;
const MAX_SKIPPED = 20;

function deref(ref: string, root: Json): unknown {
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (!isObject(node)) return undefined;
    node = node[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return node;
}

// Inline local $refs and drop everything the model does not need. `budget` stops cyclic or huge schemas.
function clean(node: unknown, root: Json, budget: { n: number }, depth = 0) {
  if (!isObject(node) || depth > 8 || ++budget.n > MAX_NODES) return {};
  if (typeof node.$ref === 'string')
    return clean(deref(node.$ref, root), root, budget, depth + 1);
  const out: Json = {};
  for (const key of KEEP) {
    const value = node[key];
    if (value === undefined) continue;
    if (key === 'properties' && isObject(value))
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [
          name,
          clean(schema, root, budget, depth + 1),
        ]),
      );
    else if (key === 'items' || key === 'additionalProperties')
      out[key] = isObject(value)
        ? clean(value, root, budget, depth + 1)
        : value;
    else if (['oneOf', 'anyOf', 'allOf'].includes(key) && Array.isArray(value))
      out[key] = value.map((schema) => clean(schema, root, budget, depth + 1));
    else if (key === 'required' && !Array.isArray(value)) continue;
    else out[key] = value;
  }
  return out;
}

// The named fields of a body schema, merging allOf members. Undefined when it has no named fields.
function fields(
  schema: Json,
): { properties: Json; required: string[] } | undefined {
  const properties: Json = isObject(schema.properties)
    ? { ...schema.properties }
    : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === 'string')
    : [];
  if (Array.isArray(schema.allOf))
    for (const member of schema.allOf) {
      const inner = isObject(member) ? fields(member) : undefined;
      if (inner) {
        Object.assign(properties, inner.properties);
        required.push(...inner.required);
      }
    }
  return Object.keys(properties).length ? { properties, required } : undefined;
}

const resolve = (value: unknown, root: Json) =>
  isObject(value) && typeof value.$ref === 'string'
    ? deref(value.$ref, root)
    : value;

// The path a document's servers add in front of every path, unless the user's base address already ends with it.
function serverPrefix(doc: Json, base: URL) {
  const server = Array.isArray(doc.servers) ? doc.servers[0] : undefined;
  const raw =
    typeof doc.basePath === 'string'
      ? doc.basePath
      : isObject(server) && typeof server.url === 'string'
        ? server.url
        : '';
  let path = '';
  try {
    path = new URL(raw, 'https://spec.invalid').pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
  return !path ||
    /[{}?#\\]/.test(path) ||
    base.pathname.replace(/\/$/, '').endsWith(path)
    ? ''
    : path;
}

export function importOpenApi(doc: unknown, endpoint: string) {
  if (
    !isObject(doc) ||
    !(String(doc.openapi).startsWith('3') || doc.swagger === '2.0') ||
    !isObject(doc.paths)
  )
    throw new ProviderError('This is not an OpenAPI 3 or Swagger 2 document.');
  const prefix = serverPrefix(doc, new URL(endpoint));
  const operations: ApiOperationDraft[] = [];
  const skipped: string[] = [];
  const names = new Set<string>();
  let omitted = 0;
  const skip = (label: string, reason: string) => {
    if (skipped.length < MAX_SKIPPED) skipped.push(`${label}: ${reason}`);
    else omitted++;
  };
  for (const [rawPath, item] of Object.entries(doc.paths)) {
    if (!isObject(item)) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;
      const verb = method.toUpperCase() as ApiOperationDraft['method'];
      const label = `${verb} ${rawPath}`;
      if (operations.length >= MAX_OPERATIONS) {
        omitted++;
        continue;
      }
      const path = prefix + rawPath;
      if (
        !path.startsWith('/') ||
        path.startsWith('//') ||
        /[?#\\]/.test(path) ||
        path.split('/').some((part) => part === '.' || part === '..') ||
        [...path.matchAll(/\{([^}]*)\}/g)].some((m) => !/^\w+$/.test(m[1]!))
      ) {
        skip(label, 'unsupported path');
        continue;
      }
      const budget = { n: 0 };
      const properties: Json = {};
      const required: string[] = [];
      const query: string[] = [];
      let problem = '';
      let body: Json | undefined;
      const parameters = new Map<string, Json>();
      for (const value of [
        ...(Array.isArray(item.parameters) ? item.parameters : []),
        ...(Array.isArray(op.parameters) ? op.parameters : []),
      ]) {
        const p = resolve(value, doc);
        if (isObject(p) && typeof p.name === 'string')
          parameters.set(`${p.in}:${p.name}`, p);
      }
      for (const p of parameters.values()) {
        const name = p.name as string;
        if (p.in === 'path') continue; // Taken from the path template below: always a required string.
        if (p.in === 'query') {
          const schema = clean(
            isObject(p.schema)
              ? p.schema
              : Object.fromEntries(
                  KEEP.filter((key) => key in p && key !== 'required').map(
                    (key) => [key, p[key]],
                  ),
                ),
            doc,
            budget,
          ) as Json;
          if (typeof p.description === 'string' && !schema.description)
            schema.description = p.description.slice(0, 300);
          properties[name] = schema;
          query.push(name);
          if (p.required === true) required.push(name);
        } else if (p.in === 'body') body = clean(p.schema, doc, budget) as Json;
        else if (p.in === 'formData') problem = 'form bodies are not supported';
        else if (
          p.required === true &&
          !/^(accept|content-type|authorization)$/i.test(name)
        )
          problem = `needs the ${String(p.in)} parameter ${name}`;
      }
      const requestBody = resolve(op.requestBody, doc);
      if (isObject(requestBody) && isObject(requestBody.content)) {
        const type = Object.keys(requestBody.content).find((key) =>
          /json/i.test(key),
        );
        const media = type ? requestBody.content[type] : undefined;
        if (isObject(media)) body = clean(media.schema, doc, budget) as Json;
        else problem = 'only JSON bodies are supported';
      }
      for (const match of path.matchAll(/\{(\w+)\}/g)) {
        const name = match[1]!;
        const parameter = parameters.get(`path:${name}`);
        if (query.includes(name))
          problem ||= 'a query parameter has the same name as a path parameter';
        properties[name] = {
          type: 'string',
          ...(typeof parameter?.description === 'string'
            ? { description: parameter.description.slice(0, 300) }
            : {}),
        };
        required.push(name);
      }
      if (body) {
        const named = fields(body);
        if (!named) problem ||= 'the body has no named fields';
        else if (
          Object.keys(named.properties).some((name) => name in properties)
        )
          problem ||=
            'a body field has the same name as a path or query parameter';
        else {
          Object.assign(properties, named.properties);
          required.push(...named.required);
        }
      }
      const inputSchema = {
        type: 'object',
        properties,
        required: [...new Set(required)].filter((name) => name in properties),
        additionalProperties: false,
      };
      if (!problem && JSON.stringify(inputSchema).length > MAX_SCHEMA)
        problem = 'its inputs are too large';
      if (problem) {
        skip(label, problem);
        continue;
      }
      const slug = rawPath
        .replace(/\{(\w+)\}/g, '$1')
        .replace(/\W+/g, '_')
        .replace(/^_+|_+$/g, '');
      const base = (
        typeof op.operationId === 'string' && op.operationId
          ? op.operationId.replace(/[^\w-]/g, '_')
          : `${method}_${slug}`
      ).slice(0, 60);
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base}_${n}`;
      names.add(name);
      const text = [op.summary, op.description].find(
        (value): value is string => typeof value === 'string' && !!value.trim(),
      );
      operations.push({
        name,
        description: (text?.trim().split('\n')[0] ?? label).slice(0, 300),
        method: verb,
        path,
        inputSchema,
        readOnly: verb === 'GET',
        query,
      });
    }
  }
  if (omitted) skipped.push(`${omitted} more skipped.`);
  const info = isObject(doc.info) ? doc.info : {};
  return {
    title:
      typeof info.title === 'string' ? info.title.slice(0, 100) : undefined,
    operations,
    skipped,
  };
}
