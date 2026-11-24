const appIds = [
  'google-drive',
  'github-issues',
  'slack',
  'teams',
  'salesforce',
  'salesforce-service',
  'zendesk',
] as const;
type AppId = (typeof appIds)[number];

// False when a connection needs a build-time public client ID this build lacks.
export function oauthAvailable(id: string): boolean {
  if (!(appIds as readonly string[]).includes(id)) return true;
  try {
    oauthApp(id as AppId);
    return true;
  } catch {
    return false;
  }
}

export function oauthApp(id: AppId) {
  const config =
    typeof __SUPAHELP_OAUTH_CONFIG__ === 'undefined'
      ? {
          googleClientId: process.env.SUPAHELP_GOOGLE_CLIENT_ID || '',
          googleClientSecret:
            process.env.SUPAHELP_GOOGLE_DESKTOP_CLIENT_SECRET || '',
          githubClientId: process.env.SUPAHELP_GITHUB_CLIENT_ID || '',
          slackClientId: process.env.SUPAHELP_SLACK_CLIENT_ID || '',
          teamsClientId: process.env.SUPAHELP_TEAMS_CLIENT_ID || '',
          salesforceClientId: process.env.SUPAHELP_SALESFORCE_CLIENT_ID || '',
          zendeskClientId: process.env.SUPAHELP_ZENDESK_CLIENT_ID || '',
        }
      : __SUPAHELP_OAUTH_CONFIG__;
  const client: { clientId: string; clientSecret?: string } = {
    clientId: {
      'google-drive': config.googleClientId,
      'github-issues': config.githubClientId,
      slack: config.slackClientId,
      teams: config.teamsClientId,
      salesforce: config.salesforceClientId,
      'salesforce-service': config.salesforceClientId,
      zendesk: config.zendeskClientId,
    }[id],
  };
  if (id === 'google-drive' && config.googleClientSecret)
    client.clientSecret = config.googleClientSecret;
  if (!client.clientId)
    throw Error(
      `Supahelp’s ${id} sign-in is not configured in this build. Contact Supahelp support.`,
    );
  return client;
}
