import type { AuthEndpoints } from '../connection-oauth.ts';
import {
  asQuery,
  id,
  operation,
  query,
  text,
  type Operation,
} from './operations.ts';

export function configureHelpscout() {
  const headers: Record<string, string> = {};
  let endpoints: AuthEndpoints | undefined;
  const base = 'https://api.helpscout.net/v2';
  endpoints = {
    authorize:
      'https://secure.helpscout.net/authentication/authorizeClientApplication',
    token: 'https://api.helpscout.net/v2/oauth2/token',
    scopes: '',
    pkce: false,
  };
  const operations: Operation[] = [
    operation(
      'find_conversations',
      'Find conversations',
      'GET',
      '/conversations',
      query,
      { query: asQuery },
    ),
    operation(
      'get_conversation',
      'Read conversation metadata',
      'GET',
      '/conversations/{id}',
      id,
    ),
    operation(
      'get_threads',
      'Read conversation replies and notes',
      'GET',
      '/conversations/{id}/threads',
      id,
    ),
    operation(
      'search_customers',
      'Find Help Scout customers using a name or email query, for example (firstName:"Jane" AND lastName:"Doe") or (email:"jane@example.com"). Requires access to the contacts directory.',
      'GET',
      '/customers',
      {},
      {
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', minLength: 1, maxLength: 500 },
            page: { type: 'integer', minimum: 1, maximum: 40 },
          },
          required: ['query'],
          additionalProperties: false,
        },
        query: (args) => {
          if (typeof args.query !== 'string' || !args.query.trim())
            throw Error('Enter a customer name or email.');
          return asQuery(args);
        },
      },
    ),
    operation(
      'reply_to_customer',
      'Send a reply to the specified conversation customer with an explicit resulting conversation status',
      'POST',
      '/conversations/{id}/reply',
      {
        ...text,
        customer_id: { type: 'integer', minimum: 1 },
        status: { enum: ['active', 'closed', 'open', 'pending'] },
      },
      {
        body: (a) => ({
          customer: { id: a.customer_id },
          text: a.text,
          status: a.status,
        }),
      },
    ),
    operation(
      'add_note',
      'Add an internal note',
      'POST',
      '/conversations/{id}/notes',
      text,
      { body: (a) => ({ text: a.text }) },
    ),
  ];

  return { base, headers, operations, endpoints };
}
