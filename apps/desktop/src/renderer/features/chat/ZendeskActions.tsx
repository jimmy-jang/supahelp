import { useZendesk } from '../settings/useZendesk';
import { ConnectionReceipts } from './ConnectionReceipts';
export function ZendeskActions({ chatId }: { chatId?: string }) {
  const { snapshot } = useZendesk();
  return (
    <ConnectionReceipts
      name="Zendesk"
      actions={
        snapshot?.actions.filter(
          (action) => !chatId || action.chatId === chatId,
        ) ?? []
      }
      onDecision={(id, decision) =>
        window.supahelp.decideZendeskAction(id, decision)
      }
    />
  );
}
