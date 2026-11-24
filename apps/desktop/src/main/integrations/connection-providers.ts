import type {
  ConnectionDefinition,
  ConnectionField,
} from '../../contracts/catalog';

export type ConnectionProvider = ConnectionDefinition & {
  transport: 'mcp' | 'api';
  endpoint?: string;
  regions?: Record<string, string>;
  scopes?: string;
  reads?: RegExp;
  managedOAuth?: boolean;
  oauthClientId?: string;
  redirectUri?: string;
};
const field = (
  key: string,
  label: string,
  extra: Partial<ConnectionField> = {},
): ConnectionField => ({ key, label, ...extra });
const key = field('key', 'API key or token', { secret: true });
const region = (choices: string[]) =>
  field('region', 'Account region', { choices, value: choices[0] });
const site = field('site', 'Workspace address');
const mcp = (
  id: string,
  name: string,
  endpoint: string,
  documentation: string,
  extra: Partial<ConnectionProvider> = {},
): ConnectionProvider => ({
  id,
  name,
  transport: 'mcp',
  endpoint,
  documentation,
  fields: [],
  instructions:
    'Sign in in your browser. Your existing account permissions apply. Changes require approval in Supahelp.',
  requiresSupahelpAccount: extra.managedOAuth || undefined,
  ...extra,
});
const api = (
  id: string,
  name: string,
  fields: ConnectionField[],
  documentation: string,
  instructions: string,
): ConnectionProvider => ({
  id,
  name,
  transport: 'api',
  fields,
  documentation,
  instructions,
  requiresSupahelpAccount:
    ['intercom', 'helpscout', 'zoho-desk', 'stripe'].includes(id) || undefined,
});
const jiraReads =
  /^(getJira(Issue|IssueRemoteIssueLinks|IssueTypeMetaWithFields|ProjectIssueTypesMetadata|AllProjects|Transitions|IssueComments|CurrentUser)|listJira(IssueComments|IssueTransitions|Projects|ProjectIssueTypesMetadata)|searchJiraIssuesUsingJql|getAccessibleAtlassianResources|atlassianUserInfo)$/;
const atlassian = 'https://mcp.atlassian.com/v2/mcp?tools=all';
const salesforceFields = [site];

// Provider facts stay in main. Only public form descriptions cross IPC.
export const connectionProviders: ConnectionProvider[] = [
  api(
    'intercom',
    'Intercom',
    [region(['US', 'EU', 'AU'])],
    'https://developers.intercom.com/docs/build-an-integration/learn-more/authentication/setting-up-oauth',
    'Choose your region and sign in with Intercom. Your teammate permissions apply. Supahelp handles the app setup and secure browser return.',
  ),
  mcp(
    'front',
    'Front',
    'https://mcp.frontapp.com/mcp',
    'https://dev.frontapp.com/docs/mcp-server',
    {
      managedOAuth: true,
      // Front rejects read/write/send as OAuth scopes (invalid_scope); the MCP feature carries those permissions.
      scopes: 'feature:mcp',
      reads:
        /^(search_conversations|get_conversation|read_conversation|list_messages|read_message|list_comments|list_channels|list_inboxes|get_contact|search_contacts)$/,
      instructions:
        'Sign in with Front in your browser. Your company may need to approve or install Supahelp’s Front app once; each teammate then authorizes their own account.',
    },
  ),
  api(
    'helpscout',
    'Help Scout',
    [],
    'https://developer.helpscout.com/mailbox-api/overview/authentication/',
    'Sign in with Help Scout in your browser. Your existing account permissions apply.',
  ),
  api(
    'freshdesk',
    'Freshdesk',
    [site, key],
    'https://support.freshdesk.com/support/solutions/articles/215517-how-to-find-your-api-key-',
    'Sign in to Freshdesk and copy your workspace address from the browser address bar, ending in freshdesk.com without any path after it. Click your profile picture in the top right and select Profile Settings. Click View API key and complete the CAPTCHA. Copy the key and paste it into Supahelp. Your agent role limits access.',
  ),
  ...['hubspot-service', 'hubspot'].map((id) =>
    mcp(
      id,
      id === 'hubspot' ? 'HubSpot' : 'HubSpot Service Hub',
      'https://mcp.hubspot.com/',
      'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-hubspot-mcp-server',
      {
        managedOAuth: true,
        reads:
          /^(get_user_details|search|fetch|search_crm_objects|get_crm_objects|get_properties|get_associations|list_owners|get_owner|hubspot_read|crm_search|crm_get)$/,
        instructions:
          'Sign in with HubSpot and choose your account. Available tools depend on your permissions, subscription and Supahelp’s approved connector.',
      },
    ),
  ),
  mcp(
    'jsm',
    'Jira Service Management',
    atlassian,
    'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/',
    {
      reads:
        /^(getJsmRequest|getJsmRequestComments|searchJsmRequests|getJsmRequestTransitions|getJsmRequestActionMetadata|listJiraIssueComments|getAccessibleAtlassianResources|atlassianUserInfo|getJiraIssue)$/,
      instructions:
        'Authorize your Atlassian Cloud site. Request comments can be public or internal; review visibility before approving.',
    },
  ),
  mcp(
    'plain',
    'Plain',
    'https://mcp.plain.com/mcp',
    'https://www.plain.com/docs/integrations/mcp-server',
    {
      scopes: 'openid offline_access',
      reads:
        /^(get|list|search|read|find|fetch)(?:[_-]|[A-Z]).*(thread|customer|account|message|note)/i,
    },
  ),
  mcp(
    'pylon',
    'Pylon',
    'https://mcp.usepylon.com',
    'https://docs.usepylon.com/pylon-docs/integrations/pylon-mcp',
    {
      fields: [region(['US', 'EU'])],
      regions: {
        US: 'https://mcp.usepylon.com',
        EU: 'https://mcp.eu.usepylon.com',
      },
      reads:
        /^(search_issues|get_issue|search_accounts|get_account|search_contacts|get_contact)$/,
      instructions:
        'Enable MCP Access for your user in Pylon. Select your account region. Email replies can include the original recipients.',
    },
  ),
  ...['salesforce-service', 'salesforce'].map((id) =>
    api(
      id,
      id === 'salesforce' ? 'Salesforce' : 'Salesforce Service Cloud',
      salesforceFields,
      'https://help.salesforce.com/s/articleView?id=release-notes.rn_api_use_my_domain.htm&language=en_US&release=250&type=5',
      'In Salesforce, open Setup and enter My Domain in the Quick Find box. Select My Domain and copy Current My Domain URL under My Domain Details. Paste it here and sign in with Salesforce. Your organization may need to install or approve Supahelp’s app. Object and record permissions still apply.',
    ),
  ),
  api(
    'zoho-desk',
    'Zoho Desk',
    [
      region(['US', 'EU', 'AU', 'IN', 'JP', 'CA']),
      field('orgId', 'Desk organization ID'),
    ],
    'https://help.zoho.com/portal/en/kb/desk/developer-space/apidashboard/articles/working-with-api-credits',
    'In Zoho Desk, click Setup, then select APIs under Developer Space. Under API Plan Details, copy the Org ID and paste it here. Choose your region and sign in with Zoho. Your agent permissions and organization access still apply.',
  ),
  api(
    'stripe',
    'Stripe',
    [
      field('environment', 'Stripe environment', {
        choices: ['Live', 'Test'],
        value: 'Live',
      }),
    ],
    'https://docs.stripe.com/keys#restricted-api-keys',
    'Choose the environment and sign in with Stripe to install Supahelp’s app. Amounts use the currency’s smallest unit. Supahelp checks the customer, currency and environment before changes and uses an idempotency key for every request.',
  ),
  mcp(
    'newrelic',
    'New Relic',
    'https://mcp.newrelic.com/mcp/',
    'https://docs.newrelic.com/docs/agentic-ai/mcp/setup/',
    {
      fields: [region(['US', 'EU', 'JP'])],
      oauthClientId: 'pUWGgnjsQ0bydqCbavTPpw==',
      regions: {
        US: 'https://mcp.newrelic.com/mcp/',
        EU: 'https://mcp.eu.newrelic.com/mcp/',
        JP: 'https://mcp.jp.newrelic.com/mcp/',
      },
      scopes: 'observability:read offline offline_access',
      reads: /^(get|list|search|query|nrql|fetch|find)[_.-]/i,
      instructions:
        'Your admin must enable the MCP Server and Local Clients feature controls and grant MCP access to your group. Select the account’s region.',
    },
  ),
  mcp(
    'sentry',
    'Sentry',
    'https://mcp.sentry.dev/mcp',
    'https://mcp.sentry.dev/',
    {
      reads:
        /^(find_organizations|find_projects|search_issues|search_events|get_issue_details|get_issue_events|get_event_details|get_sentry_resource|whoami)$/,
    },
  ),
  mcp(
    'datadog',
    'Datadog',
    'https://mcp.datadoghq.com/v1/mcp',
    'https://docs.datadoghq.com/mcp_server/setup/',
    {
      fields: [region(['US1', 'US3', 'US5', 'EU', 'AP1', 'AP2'])],
      regions: {
        US1: 'https://mcp.datadoghq.com/v1/mcp',
        US3: 'https://mcp.us3.datadoghq.com/v1/mcp',
        US5: 'https://mcp.us5.datadoghq.com/v1/mcp',
        EU: 'https://mcp.datadoghq.eu/v1/mcp',
        AP1: 'https://mcp.ap1.datadoghq.com/v1/mcp',
        AP2: 'https://mcp.ap2.datadoghq.com/v1/mcp',
      },
      reads: /^(get|list|search|query|fetch)[_.-]/i,
      instructions:
        'Select the Datadog site that hosts your organization. Availability varies by site; your existing log restrictions and role still apply.',
    },
  ),
  mcp(
    'pagerduty',
    'PagerDuty',
    'https://mcp.pagerduty.com/mcp',
    'https://developer.pagerduty.com/docs/mcp-server',
    {
      fields: [
        region(['US', 'EU']),
        field('key', 'User API token', { secret: true }),
      ],
      regions: {
        US: 'https://mcp.pagerduty.com/mcp',
        EU: 'https://mcp.eu.pagerduty.com/mcp',
      },
      reads:
        /^(browse_(incidents|services|schedules|teams|event_orchestrations|alert_grouping|status_pages|escalation_policies|users|change_events|activity)|(get|list|search|fetch)[_.-].+)$/i,
      instructions:
        'In PagerDuty, open your profile → User Settings → API Access and create an API user token. Paste it here and choose your account region. The token inherits your PagerDuty permissions.',
    },
  ),
  mcp(
    'incidentio',
    'incident.io',
    'https://mcp.incident.io/mcp',
    'https://docs.incident.io/ai/remote-mcp',
    {
      reads:
        /^(identity_show|incident_(list|show|stats)|incident_updates_list|oncall_(show|list|stats)|schedule_(list|show)|user_(list|show)|configuration_show)$/,
      redirectUri: 'http://localhost:49154/callback',
      instructions:
        'An incident.io admin must enable the MCP server in Settings → MCP for your organization. The remote MCP server requires a Team, Pro, or Enterprise plan. If required, your admin must also allow localhost under Allowed redirect domains. Your incident.io role limits what Supahelp can change.',
    },
  ),
  mcp(
    'rootly',
    'Rootly',
    'https://mcp.rootly.com/mcp?toolsets=core',
    'https://docs.rootly.com/integrations/mcp-server',
    {
      reads:
        /^(get|list|search|fetch)[_.-].*(incident|oncall|on_call|schedule|timeline|status|user|team)/i,
    },
  ),
  mcp(
    'jira',
    'Jira',
    atlassian,
    'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/',
    { reads: jiraReads },
  ),
  mcp(
    'github-issues',
    'GitHub Issues',
    'https://api.githubcopilot.com/mcp/x/issues',
    'https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md',
    {
      fields: [],
      reads: /^(issue_read|search_issues|list_issues|get_me|list_issue_types)$/,
      instructions:
        'Sign in with GitHub in your browser and enter the code shown here. Your organization may require app approval. The GitHub grant can include repository access; Supahelp only exposes the issue actions allowed by your access choice.',
    },
  ),
  api(
    'shortcut',
    'Shortcut',
    [key],
    'https://developer.shortcut.com/api/rest/v3',
    'In Shortcut, click your profile icon and select Settings. Under Your Account, select API Tokens. Enter Supahelp in Token Name and click Generate Token. Copy the token and paste it into Supahelp. Shortcut tokens have broad account authority; Supahelp enforces the access choice locally.',
  ),
  mcp(
    'notion',
    'Notion',
    'https://mcp.notion.com/mcp',
    'https://developers.notion.com/guides/mcp/build-mcp-client',
    {
      reads:
        /^(notion-search|notion-fetch|notion-get-self|notion-get-page|notion-get-block|notion-get-block-children|notion-query-database)$/,
    },
  ),
  mcp(
    'confluence',
    'Confluence',
    atlassian,
    'https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/',
    {
      reads:
        /^(getConfluenceContent|listConfluenceContent|listConfluenceSpaces|getConfluenceSpace|searchConfluenceUsingCql|searchConfluence|getAccessibleAtlassianResources|atlassianUserInfo)$/,
    },
  ),
  api(
    'google-drive',
    'Google Drive',
    [],
    'https://developers.google.com/identity/protocols/oauth2/native-app',
    'Sign in with Google in your browser to allow Drive access. Changes are limited to Google Docs Supahelp creates or you open with it. Your organization may require app approval.',
  ),
  api(
    'gitbook',
    'GitBook',
    [key, field('spaceId', 'Playbook space ID')],
    'https://gitbook.com/docs/developers/gitbook-api/authentication',
    'GitBook requires a personal access token and the ID of the space Supahelp should use. See GitBook’s setup guide for its current instructions. Edits go through a change request. The token inherits your GitBook permissions.',
  ),
  mcp(
    'attio',
    'Attio',
    'https://mcp.attio.com/mcp',
    'https://docs.attio.com/mcp/overview',
    { reads: /^(get|list|search|read|find|fetch)[_.-]/i },
  ),
  api(
    'slack',
    'Slack',
    [field('channels', 'Allowed channel IDs (comma-separated)')],
    'https://docs.slack.dev/authentication/using-pkce',
    'In Slack, open the channel and click its name at the top. In the About tab, scroll to the bottom and click Copy channel ID. Paste the ID here; for multiple channels, repeat and separate the IDs with commas. Sign in with Slack. Your workspace may require app approval. Only selected channels are accessible.',
  ),
  api(
    'teams',
    'Microsoft Teams',
    [
      field('teamId', 'Allowed team ID'),
      field('channelId', 'Allowed channel ID'),
    ],
    'https://learn.microsoft.com/en-us/power-apps/teams/create-first-app#additional-considerations-for-microsoft-365-group',
    'In Teams, find the channel, click More options (…), and select Copy link or Get link to channel. Paste the link into a text editor. Copy the value after groupId= and before & into Allowed team ID. Copy the part after /channel/ and before the next / into Allowed channel ID; replace %3A or %3a with : and %40 with @. Sign in with your Microsoft work account. Your organization may require admin consent.',
  ),
  mcp(
    'custom-mcp',
    'Your MCP server',
    '',
    'https://modelcontextprotocol.io/specification/latest/basic/authorization',
    {
      fields: [
        field('name', 'Name'),
        field('endpoint', 'MCP server address'),
        field('key', 'Optional bearer token', { secret: true, optional: true }),
        field('clientId', 'Optional OAuth client ID', { optional: true }),
        field('clientSecret', 'Optional OAuth client secret', {
          secret: true,
          optional: true,
        }),
        field('redirectUri', 'Registered return address', {
          value: 'http://127.0.0.1:49154/callback',
        }),
      ],
      instructions:
        'Connect an HTTP MCP server you trust. Every tool initially requires approval. After connecting, review its schema before marking a tool read only. Local executable servers are not launched.',
    },
  ),
  api(
    'custom-api',
    'Your REST API',
    [
      field('name', 'Name'),
      field('endpoint', 'API base address'),
      field('header', 'Credential header name', {
        value: 'Authorization',
        optional: true,
      }),
      field('key', 'Credential header value', { secret: true, optional: true }),
      field('operations', 'Operations JSON', { multiline: true }),
    ],
    'https://spec.openapis.org/oas/latest.html',
    'Enter your API’s base address and, if it needs one, a credential. Then import its OpenAPI spec, or add the endpoints yourself. Only the operations you allow become tools. Anything that is not marked read only asks for approval each time. Credentials are sent only to this address.',
  ),
];

// A user can add many servers/APIs: `custom-mcp-1a2b3c4d` is one instance of the `custom-mcp` template.
const customInstance = /^(custom-mcp|custom-api)-[0-9a-f]{8}$/;
export const isCustomInstance = (id: string) => customInstance.test(id);
export const templateOf = (id: string) => customInstance.exec(id)?.[1] ?? id;

export function providerFor(id: string) {
  const template = templateOf(id);
  const provider = connectionProviders.find((item) => item.id === template);
  if (!provider) throw Error('Unknown connection.');
  return provider;
}
