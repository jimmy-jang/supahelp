import type { CatalogRecord } from '../connection-oauth.ts';
import type { ConnectionProvider } from '../connection-providers.ts';
import { configureCustomApi } from './custom-api.ts';
import { configureFreshdesk } from './freshdesk.ts';
import { configureGitbook } from './gitbook.ts';
import { configureGoogleDrive } from './google-drive.ts';
import { configureHelpscout } from './helpscout.ts';
import { configureIntercom } from './intercom.ts';
import { configureSalesforce } from './salesforce.ts';
import { configureShortcut } from './shortcut.ts';
import { configureSlack } from './slack.ts';
import { configureStripe } from './stripe.ts';
import { configureTeams } from './teams.ts';
import { configureZohoDesk } from './zoho-desk.ts';
export function configureProvider(
  provider: ConnectionProvider,
  record: CatalogRecord,
  actorId: () => string | undefined,
) {
  switch (provider.id) {
    case 'intercom':
      return configureIntercom(record, actorId);
    case 'helpscout':
      return configureHelpscout();
    case 'stripe':
      return configureStripe(record);
    case 'freshdesk':
      return configureFreshdesk(record);
    case 'zoho-desk':
      return configureZohoDesk(record);
    case 'shortcut':
      return configureShortcut(record);
    case 'gitbook':
      return configureGitbook(record);
    case 'google-drive':
      return configureGoogleDrive(record);
    case 'slack':
      return configureSlack(record);
    case 'teams':
      return configureTeams(record);
    case 'salesforce':
    case 'salesforce-service':
      return configureSalesforce(provider, record);
    case 'custom-api':
      return configureCustomApi(record);
    default:
      throw Error('Unsupported API connection.');
  }
}
