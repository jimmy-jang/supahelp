import { type CatalogRecord } from '../connection-oauth.ts';
import {
  id,
  operation,
  query,
  remaining,
  tenant,
  text,
  type Operation,
} from './operations.ts';

export function configureFreshdesk(record: CatalogRecord) {
  const v = record.values;
  const headers: Record<string, string> = {};
  v.site = tenant(v.site, '.freshdesk.com');
  const base = `${v.site}/api/v2`;
  headers.Authorization = `Basic ${Buffer.from(`${v.key}:X`).toString('base64')}`;
  const operations: Operation[] = [
    operation(
      'find_tickets',
      'Search tickets using Freshdesk search syntax',
      'GET',
      '/search/tickets',
      query,
      {
        query: (a) => ({
          query: `"${String(a.query).replaceAll('"', '')}"`,
        }),
      },
    ),
    operation('get_ticket', 'Read a ticket', 'GET', '/tickets/{id}', id),
    operation(
      'get_replies',
      'Read ticket replies and notes',
      'GET',
      '/tickets/{id}/conversations',
      id,
    ),
    operation('get_contact', 'Read a customer', 'GET', '/contacts/{id}', id),
    operation(
      'reply_to_customer',
      'Send a public ticket reply',
      'POST',
      '/tickets/{id}/reply',
      text,
      { body: (a) => ({ body: a.text }) },
    ),
    operation(
      'add_internal_note',
      'Add a private ticket note',
      'POST',
      '/tickets/{id}/notes',
      text,
      { body: (a) => ({ body: a.text, private: true }) },
    ),
    operation(
      'change_status',
      'Change ticket status',
      'PUT',
      '/tickets/{id}',
      { ...id, status: { type: 'integer', enum: [2, 3, 4, 5] } },
      { body: remaining },
    ),
  ];

  return { base, headers, operations, endpoints: undefined };
}
