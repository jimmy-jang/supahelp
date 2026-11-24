import { defineConfig, loadEnv } from 'vite';

// https://vitejs.dev/config
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'SUPAHELP_');
  return {
    // The SDK uses import.meta.url; main.cjs needs the equivalent CommonJS file URL.
    define: {
      'import.meta.url': 'require("node:url").pathToFileURL(__filename).href',
      __SUPAHELP_UPDATE_FEED__: JSON.stringify(
        env.SUPAHELP_UPDATE_FEED?.trim() || '',
      ),
      __SUPAHELP_ACCOUNT_CONFIG__: JSON.stringify({
        clientId: env.SUPAHELP_WORKOS_CLIENT_ID || '',
        apiBaseUrl: env.SUPAHELP_API_BASE_URL || '',
      }),
      __SUPAHELP_OAUTH_CONFIG__: JSON.stringify({
        googleClientId: env.SUPAHELP_GOOGLE_CLIENT_ID || '',
        // Google's token endpoint requires the Desktop client's secret even with PKCE.
        // Google documents installed-app secrets as non-confidential.
        googleClientSecret: env.SUPAHELP_GOOGLE_DESKTOP_CLIENT_SECRET || '',
        githubClientId: env.SUPAHELP_GITHUB_CLIENT_ID || '',
        slackClientId: env.SUPAHELP_SLACK_CLIENT_ID || '',
        teamsClientId: env.SUPAHELP_TEAMS_CLIENT_ID || '',
        salesforceClientId: env.SUPAHELP_SALESFORCE_CLIENT_ID || '',
        zendeskClientId: env.SUPAHELP_ZENDESK_CLIENT_ID || '',
      }),
    },
  };
});
