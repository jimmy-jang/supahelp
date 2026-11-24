import { parseCaseLink } from '../../../contracts/case-links.ts';
export type AppLink =
  | { kind: 'auth'; code: string; state: string }
  | { kind: 'invite'; token: string }
  | { kind: 'case'; id: string }
  | { kind: 'billing' };
const validToken = (token: string | null): token is string =>
  typeof token === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[1-9][0-9]{0,9}\.[A-Za-z0-9_-]{43}$/i.test(
    token,
  );
export function parseAppLink(value: string): AppLink | undefined {
  if (typeof value !== 'string' || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return;
    const id = parseCaseLink(value);
    if (id) return { kind: 'case', id };
    if (
      url.protocol === 'https:' &&
      ['supahelp.app', 'www.supahelp.app'].includes(url.host) &&
      url.pathname === '/invite' &&
      !url.search
    ) {
      const token = url.hash.slice(1);
      if (validToken(token)) return { kind: 'invite', token };
      return;
    }
    if (url.protocol !== 'supahelp:' || url.hash) return;
    if (url.host === 'billing' && url.pathname === '/return' && !url.search)
      return { kind: 'billing' };
    if (url.host === 'auth' && url.pathname === '/callback') {
      const code = url.searchParams.get('code'),
        state = url.searchParams.get('state');
      if (
        state &&
        state.length <= 256 &&
        url.searchParams.getAll('state').length === 1 &&
        url.searchParams.getAll('code').length <= 1
      ) {
        if (code && code.length <= 2048) return { kind: 'auth', code, state };
        if (url.searchParams.has('error'))
          return { kind: 'auth', code: '', state };
      }
    }
    if (
      url.host === 'invite' &&
      url.pathname === '/accept' &&
      url.searchParams.getAll('token').length === 1
    ) {
      const token = url.searchParams.get('token');
      if (validToken(token)) return { kind: 'invite', token };
    }
  } catch {
    /* Unrecognized links grant no capabilities. */
  }
}
