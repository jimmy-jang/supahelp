import { useLinear } from '../settings/useLinear';
import { ConnectionReceipts } from './ConnectionReceipts';
export function LinearActions({ chatId }: { chatId?: string }) {
  const { snapshot } = useLinear();
  return (
    <ConnectionReceipts
      name="Linear"
      actions={
        snapshot?.actions.filter(
          (action) => !chatId || action.chatId === chatId,
        ) ?? []
      }
      onDecision={(id, decision) =>
        window.supahelp.decideLinearAction(id, decision)
      }
    />
  );
}
