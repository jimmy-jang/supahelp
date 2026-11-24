import type {
  ApiSpecPreview,
  ApiSpecRequest,
} from '../../../contracts/catalog';
import {
  connectionText,
  connectionUrl,
  ProviderError,
} from '../connection-oauth.ts';
import { credentialHeader } from './custom-api.ts';
import { importOpenApi } from './openapi.ts';

const LIMIT = 2_000_000;
const usual = ['openapi.json', 'swagger.json'];

function parse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(
      /^\s*(openapi|swagger)\s*:/m.test(text)
        ? 'YAML specs are not supported yet. Use the JSON version of the spec.'
        : 'The spec is not valid JSON.',
    );
  }
}

// Reads an OpenAPI spec from pasted file text, an explicit address, or the usual addresses under the API's base.
// The credential is sent only to the API's own origin.
export async function loadApiSpec(
  request: ApiSpecRequest,
): Promise<ApiSpecPreview> {
  const base = connectionUrl(request.endpoint, true);
  if (base.search)
    throw new ProviderError('Use a base address without query parameters.');
  const endpoint = base.href.replace(/\/$/, '');
  if (typeof request.text === 'string')
    return {
      source: 'file',
      ...importOpenApi(parse(request.text.slice(0, LIMIT)), endpoint),
    };
  const explicit = request.url?.trim();
  const candidates = explicit
    ? [connectionUrl(explicit, true)]
    : [
        ...new Set(
          usual.flatMap((name) => [
            `${endpoint}/${name}`,
            `${base.origin}/${name}`,
          ]),
        ),
      ].map((address) => new URL(address));
  let failure = '';
  for (const url of candidates) {
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (url.origin === base.origin && request.header && request.key)
        Object.assign(headers, credentialHeader(request.header, request.key));
      const response = await fetch(url, {
        redirect: 'error',
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        failure = `The spec address answered HTTP ${response.status}.`;
        continue;
      }
      return {
        source: url.href,
        ...importOpenApi(
          parse(await connectionText(response, LIMIT)),
          endpoint,
        ),
      };
    } catch (error) {
      failure =
        error instanceof ProviderError
          ? error.message
          : 'Could not read a spec from that address.';
    }
  }
  throw new ProviderError(
    explicit
      ? failure
      : 'No OpenAPI spec was found at the usual addresses. Enter its address, choose a file, or add endpoints by hand.',
  );
}
