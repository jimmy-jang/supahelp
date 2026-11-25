/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare module '*?inline' {
  const data: string;
  export default data;
}

declare const __SUPAHELP_ACCOUNT_CONFIG__: {
  clientId: string;
  apiBaseUrl: string;
};

declare const __SUPAHELP_UPDATE_FEED__: string;

declare const __SUPAHELP_OAUTH_CONFIG__: {
  googleClientId: string;
  googleClientSecret: string;
  githubClientId: string;
  slackClientId: string;
  slackCallbackOrigin: string;
  teamsClientId: string;
  salesforceClientId: string;
  zendeskClientId: string;
};
