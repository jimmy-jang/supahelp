import type { SyncLease, SyncPage, SyncReceipt } from '../../contracts/sync';
import type { SyncTransport } from '../features/sync/service';
import { AccountApiError } from './account-api.ts';

export function teamApi(
  origin: string,
  token: (signal: AbortSignal) => Promise<string | undefined>,
  request: typeof fetch = fetch,
  allowLoopback = false,
): SyncTransport {
  const url = new URL(origin);
  if (
    (url.protocol !== 'https:' &&
      !(
        allowLoopback &&
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw Error('invalid-sync-origin');
  async function call(
    path: string,
    method: string,
    body: unknown,
    signal: AbortSignal,
    binary = false,
  ): Promise<unknown> {
    const bearer = await token(signal);
    if (!bearer) throw new AccountApiError(401, 'unauthenticated');
    const response = await request(url.origin + path, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': binary ? 'image/png' : 'application/json',
        ...(binary ? { 'X-Screenshot-Confirmed': 'true' } : {}),
      },
      body:
        body === undefined
          ? undefined
          : binary
            ? (body as Uint8Array<ArrayBuffer>)
            : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new AccountApiError();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 2097152) {
          await reader.cancel();
          throw new AccountApiError();
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    if (!response.ok) {
      let code = 'unavailable';
      try {
        code = JSON.parse(bytes.toString()).error.code;
      } catch {}
      throw new AccountApiError(response.status, code);
    }
    if (response.headers.get('content-type')?.startsWith('image/png'))
      return bytes;
    const value = JSON.parse(bytes.toString());
    if (value.ok !== true || !value.value || typeof value.value !== 'object')
      throw new AccountApiError();
    return value.value;
  }
  const root = (workspace: string) => {
    if (!/^[a-f0-9-]{36}$/.test(workspace)) throw new AccountApiError();
    return `/v1/workspaces/${workspace}`;
  };
  return {
    allNotifications: async (s) =>
      (await call('/v1/notifications', 'GET', undefined, s)) as {
        events: import('../../contracts/sync').CaseNotification[];
        preferences: import('../../contracts/sync').NotificationPreferences;
      },
    getPreferences: async (s) =>
      (await call(
        '/v1/account/notification-preferences',
        'GET',
        undefined,
        s,
      )) as import('../../contracts/sync').NotificationPreferences,
    collaboration: async (w, s) =>
      (await call(
        root(w) + '/collaboration',
        'GET',
        undefined,
        s,
      )) as import('../../contracts/sync').CollaborationSnapshot,
    lookup: async (id, s) => {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new AccountApiError();
      return (await call('/v1/cases/' + id, 'GET', undefined, s)) as {
        workspaceId: string;
        caseId: string;
      };
    },
    preferences: async (v, s) =>
      (await call(
        '/v1/account/notification-preferences',
        'PUT',
        v,
        s,
      )) as import('../../contracts/sync').NotificationPreferences,
    readEvent: async (w, id, s) =>
      call(root(w) + '/collaboration/read', 'POST', { id }, s),
    holdAnswer: async (w, v, s) =>
      call(root(w) + '/collaboration/answers', 'POST', v, s),
    cancelAnswer: async (w, id, s) =>
      call(root(w) + `/collaboration/answers/${id}/cancel`, 'POST', {}, s),
    checkAnswer: async (w, id, text, s) =>
      call(root(w) + `/collaboration/answers/${id}/check`, 'POST', { text }, s),
    privacy: async (w, id, s) =>
      (await call(
        root(w) + `/documents/${id}/privacy`,
        'GET',
        undefined,
        s,
      )) as {
        kind: 'case' | 'playbook';
        version: number;
        generation: number;
      },
    authorize: async (w, s) =>
      (await call(
        root(w) + '/sync/authorize',
        'POST',
        undefined,
        s,
      )) as SyncLease,
    page: async (w, a, n, s) =>
      (await call(
        root(w) +
          `/sync/changes?after=${a}${n === undefined ? '' : `&sequence=${n}`}`,
        'GET',
        undefined,
        s,
      )) as SyncPage,
    operation: async (w, op, s) =>
      (await call(root(w) + '/sync/operations', 'POST', op, s)) as SyncReceipt,
    upload: async (w, d, id, b, s) => {
      await call(root(w) + `/documents/${d}/assets/${id}`, 'PUT', b, s, true);
    },
    download: async (w, d, id, s) =>
      (await call(
        root(w) + `/documents/${d}/assets/${id}`,
        'GET',
        undefined,
        s,
      )) as Buffer,
  };
}
