import type { ReactNode } from 'react';
import type { Reply } from '../../../contracts/chat';
import type { ConnectionAction } from '../../../contracts/connections';
import { useConnections } from '../settings/useConnections';
import { useLinear } from '../settings/useLinear';
import { useZendesk } from '../settings/useZendesk';
import { ConnectionReceipts } from './ConnectionReceipts';

type Decide = (
  id: string,
  decision: 'approve' | 'deny' | 'checked',
) => Promise<Reply<void>>;

// Actions carry no message reference, so remember the last message index the
// first time each one is seen and keep its card there as the chat grows.
// ponytail: renderer-side localStorage; store the index on the action in main if it must sync across machines.
const KEY = 'supahelp.actionAnchors';
const anchors: Record<string, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
})();
function anchorOf(id: string, last: number) {
  if (!(id in anchors) && last >= 0) {
    anchors[id] = last;
    try {
      localStorage.setItem(KEY, JSON.stringify(anchors));
    } catch {
      // Storage is optional; the card falls back to the end of the chat.
    }
  }
  const anchor = anchors[id];
  return anchor >= 0 && anchor <= last ? anchor : last;
}

/** Returns a renderer for the receipts that belong after message `index`. */
export function useChatActions(chatId: string | undefined, count: number) {
  const linear = useLinear().snapshot;
  const zendesk = useZendesk().snapshot;
  const catalog = useConnections().snapshot;
  const last = count - 1;
  const groups: {
    key: string;
    name: string;
    actions: ConnectionAction[];
    decide: Decide;
  }[] = chatId
    ? [
        {
          key: 'linear',
          name: 'Linear',
          actions: linear?.actions ?? [],
          decide: (id, d) => window.supahelp.decideLinearAction(id, d),
        },
        {
          key: 'zendesk',
          name: 'Zendesk',
          actions: zendesk?.actions ?? [],
          decide: (id, d) => window.supahelp.decideZendeskAction(id, d),
        },
        ...(catalog?.connections ?? []).map((c) => ({
          key: c.id,
          name: c.name,
          actions: c.actions,
          decide: ((id, d) =>
            window.supahelp.decideConnectionAction(c.id, id, d)) as Decide,
        })),
      ]
    : [];
  return (index: number): ReactNode =>
    groups.map((g) => {
      const actions = g.actions.filter(
        (a) => a.chatId === chatId && anchorOf(a.id, last) === index,
      );
      return actions.length ? (
        <ConnectionReceipts
          key={g.key}
          name={g.name}
          actions={actions}
          onDecision={g.decide}
        />
      ) : null;
    });
}
