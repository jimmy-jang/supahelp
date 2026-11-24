import type { ZendeskSetup } from '../../../contracts/zendesk';
import { zendeskSite } from '../../integrations/zendesk.ts';

export function zendeskSetup(input: unknown): ZendeskSetup {
  const value = input as ZendeskSetup | null;
  if (
    !value ||
    typeof value.site !== 'string' ||
    value.site.length > 200 ||
    !['read', 'write'].includes(value.access) ||
    Object.keys(value).some((key) => !['site', 'access'].includes(key))
  )
    throw Error('Invalid Zendesk settings.');
  zendeskSite(value.site);
  return value;
}
