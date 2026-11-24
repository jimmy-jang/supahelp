import { type AuthEndpoints, type CatalogRecord } from '../connection-oauth.ts';
import { id, operation, query, text, type Operation } from './operations.ts';

export function configureIntercom(
  record: CatalogRecord,
  actorId: () => string | undefined,
) {
  const v = record.values;
  const headers: Record<string, string> = {};
  let endpoints: AuthEndpoints | undefined;

  const region = v.region === 'EU' ? 'eu.' : v.region === 'AU' ? 'au.' : '';
  const base = `https://api.${region}intercom.io`;
  endpoints = {
    authorize: `https://app.${region}intercom.com/oauth`,
    token: 'https://api.intercom.io/auth/eagle/token',
    scopes: '',
    pkce: false,
  };
  const operations: Operation[] = [
    operation(
      'search_conversations',
      'Find conversations matching text',
      'POST',
      '/conversations/search',
      query,
      {
        annotations: { readOnlyHint: true },
        body: (a) => ({
          query: { field: 'source.body', operator: '~', value: a.query },
        }),
      },
    ),
    operation(
      'get_conversation',
      'Read a conversation and its replies',
      'GET',
      '/conversations/{id}',
      id,
    ),
    operation('get_contact', 'Read a contact', 'GET', '/contacts/{id}', id),
    operation(
      'reply_to_customer',
      'Send a public customer reply from the connected admin',
      'POST',
      '/conversations/{id}/reply',
      text,
      {
        body: (a) => ({
          message_type: 'comment',
          type: 'admin',
          body: a.text,
          admin_id: actorId(),
        }),
      },
    ),
    operation(
      'add_internal_note',
      'Add an internal note',
      'POST',
      '/conversations/{id}/reply',
      text,
      {
        body: (a) => ({
          message_type: 'note',
          type: 'admin',
          body: a.text,
          admin_id: actorId(),
        }),
      },
    ),
  ];

  return { base, headers, operations, endpoints };
}
