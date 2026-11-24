import type { Conversation } from '../../../contracts/chat.ts';
import { connectionCatalog } from '../../fixtures/connections.ts';

/** Turns the tool a running reply is calling into a short status and a logo id. */
export function stepLabel({
  server,
  tool,
}: NonNullable<Conversation['step']>): { text: string; logo: string } {
  if (server === 'supahelp-case')
    return {
      text: tool === 'read_case' ? 'Reading the case…' : 'Updating the case…',
      logo: '',
    };
  if (server === 'supahelp-playbooks')
    return {
      text:
        tool === 'save_playbook_draft'
          ? 'Saving Playbook draft…'
          : tool === 'request_playbook_action'
            ? 'Preparing Playbook action…'
            : 'Looking up Playbooks…',
      logo: '',
    };
  const logo = server.replaceAll('_', '-');
  const name =
    connectionCatalog.find((item) => item.id === logo)?.name ??
    logo.charAt(0).toUpperCase() + logo.slice(1);
  return { text: `Using ${name}…`, logo };
}
