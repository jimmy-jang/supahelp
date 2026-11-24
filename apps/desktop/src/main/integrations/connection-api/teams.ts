import { type AuthEndpoints, type CatalogRecord } from '../connection-oauth.ts';
import { id, operation, scope, string, type Operation } from './operations.ts';

export function configureTeams(record: CatalogRecord) {
  const v = record.values;
  const headers: Record<string, string> = {};
  let endpoints: AuthEndpoints | undefined;

  v.tenant ||= 'organizations';
  if (!/^[a-zA-Z0-9.-]{1,150}$/.test(v.tenant) || !v.teamId || !v.channelId)
    throw Error('Select your tenant, team and channel.');
  const base = 'https://graph.microsoft.com/v1.0';
  endpoints = {
    authorize: `https://login.microsoftonline.com/${v.tenant}/oauth2/v2.0/authorize`,
    token: `https://login.microsoftonline.com/${v.tenant}/oauth2/v2.0/token`,
    scopes: scope(
      record,
      'offline_access User.Read ChannelMessage.Read.All',
      'ChannelMessage.Send',
    ),
  };
  const path = `/teams/${encodeURIComponent(v.teamId)}/channels/${encodeURIComponent(v.channelId)}/messages`;
  const operations: Operation[] = [
    operation(
      'read_channel',
      'Read messages in the selected Teams channel',
      'GET',
      path,
    ),
    operation(
      'read_thread',
      'Read replies to a channel message',
      'GET',
      `${path}/{id}/replies`,
      id,
    ),
    operation(
      'post_message',
      'Post the exact text to the selected channel',
      'POST',
      path,
      { text: string },
      {
        body: (a) => ({ body: { contentType: 'text', content: a.text } }),
      },
    ),
  ];

  return { base, headers, operations, endpoints };
}
