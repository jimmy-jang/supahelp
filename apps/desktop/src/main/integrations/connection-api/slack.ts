import {
  connectionUrl,
  type AuthEndpoints,
  type CatalogRecord,
} from '../connection-oauth.ts';
import {
  asQuery,
  operation,
  scope,
  string,
  type Operation,
} from './operations.ts';

export function configureSlack(record: CatalogRecord) {
  const v = record.values;
  const headers: Record<string, string> = {};
  let endpoints: AuthEndpoints | undefined;

  const base = 'https://slack.com/api';
  const channels = v.channels.split(',').map((x) => x.trim());
  v.channels = [...new Set(channels)].sort().join(',');
  if (!channels.length || channels.some((x) => !/^[CG][A-Z0-9]{5,30}$/.test(x)))
    throw Error('Enter allowed Slack channel IDs.');
  const channel = { type: 'string', enum: channels };
  // This is a build-time, operator-owned origin. Never take it from connection form data.
  const origin =
    typeof __SUPAHELP_OAUTH_CONFIG__ === 'undefined'
      ? process.env.SUPAHELP_SLACK_CALLBACK_ORIGIN
      : __SUPAHELP_OAUTH_CONFIG__.slackCallbackOrigin;
  let providerRedirectUri: string | undefined;
  if (origin && !v.clientId) {
    const relay = connectionUrl(origin);
    if (
      relay.port ||
      (origin !== relay.origin && origin !== relay.origin + '/')
    )
      throw Error('Configure a plain HTTPS origin for the Slack callback.');
    providerRedirectUri = relay.origin + '/oauth/slack/desktop-callback';
  }
  endpoints = {
    providerRedirectUri,
    authorize: 'https://slack.com/oauth/v2/authorize',
    token: 'https://slack.com/api/oauth.v2.access',
    scopes: '',
    extra: {
      user_scope: scope(
        record,
        'channels:history,groups:history',
        'chat:write',
      ).replace(' ', ','),
    },
  };
  const operations: Operation[] = [
    operation(
      'read_channel',
      'Read recent messages in a selected channel',
      'GET',
      '/conversations.history',
      { channel },
      { query: asQuery },
    ),
    operation(
      'read_thread',
      'Read a thread in a selected channel',
      'GET',
      '/conversations.replies',
      { channel, ts: string },
      { query: asQuery },
    ),
    operation(
      'post_message',
      'Post the exact message in a selected channel',
      'POST',
      '/chat.postMessage',
      { channel, text: string },
    ),
  ];

  return { base, headers, operations, endpoints };
}
