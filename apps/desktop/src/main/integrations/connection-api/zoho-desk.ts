import { type AuthEndpoints, type CatalogRecord } from '../connection-oauth.ts';
import {
  id,
  operation,
  query,
  remaining,
  scope,
  string,
  text,
  zohoDomains,
  type Operation,
} from './operations.ts';

export function configureZohoDesk(record: CatalogRecord) {
  const v = record.values;
  const headers: Record<string, string> = {};
  let endpoints: AuthEndpoints | undefined;

  const domain = zohoDomains[v.region];
  if (!domain || !/^\d{1,30}$/.test(v.orgId))
    throw Error('Select a region and organization.');
  const host = v.region === 'CA' ? 'zohocloud.ca' : `zoho.${domain}`;
  const base = `https://desk.${host}/api/v1`;
  headers.orgId = v.orgId;
  endpoints = {
    authorize: `https://accounts.${host}/oauth/v2/auth`,
    token: `https://accounts.${host}/oauth/v2/token`,
    scopes: scope(
      record,
      'Desk.tickets.READ,Desk.contacts.READ,Desk.basic.READ',
      'Desk.tickets.UPDATE,Desk.tickets.CREATE',
    ),
    extra: { access_type: 'offline', prompt: 'consent' },
  };
  // Zoho scope lists use commas, not OAuth's usual space separator.
  endpoints.scopes = endpoints.scopes.replace(' ', ',');
  const operations: Operation[] = [
    operation(
      'find_tickets',
      'Search Desk tickets',
      'GET',
      '/tickets/search',
      query,
      { query: (a) => ({ subject: String(a.query) }) },
    ),
    operation('get_ticket', 'Read a ticket', 'GET', '/tickets/{id}', id),
    operation(
      'get_threads',
      'Read ticket threads',
      'GET',
      '/tickets/{id}/threads',
      id,
    ),
    operation('get_contact', 'Read a customer', 'GET', '/contacts/{id}', id),
    operation(
      'reply_to_customer',
      'Send an EMAIL reply to the exact reviewed address',
      'POST',
      '/tickets/{id}/sendReply',
      { ...text, to: string, fromEmailAddress: string },
      {
        body: (a) => ({
          channel: 'EMAIL',
          content: a.text,
          contentType: 'plainText',
          to: a.to,
          fromEmailAddress: a.fromEmailAddress,
        }),
      },
    ),
    operation(
      'add_internal_note',
      'Add a private ticket comment',
      'POST',
      '/tickets/{id}/comments',
      text,
      { body: (a) => ({ content: a.text, isPublic: false }) },
    ),
    operation(
      'change_status',
      'Change ticket status',
      'PATCH',
      '/tickets/{id}',
      { ...id, status: string },
      { body: remaining },
    ),
  ];

  return { base, headers, operations, endpoints };
}
