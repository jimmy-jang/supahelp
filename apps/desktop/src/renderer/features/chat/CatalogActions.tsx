import { useConnections } from '../settings/useConnections';
import { ConnectionReceipts } from './ConnectionReceipts';

export function CatalogActions({
  chatId,
  connectionId,
}: {
  chatId?: string;
  connectionId?: string;
}) {
  const { snapshot } = useConnections();
  return (
    <>
      {snapshot?.connections
        .filter((connection) => !connectionId || connection.id === connectionId)
        .map((connection) => (
          <ConnectionReceipts
            key={connection.id}
            name={connection.name}
            actions={connection.actions.filter(
              (action) => !chatId || action.chatId === chatId,
            )}
            onDecision={(action, decision) =>
              window.supahelp.decideConnectionAction(
                connection.id,
                action,
                decision,
              )
            }
          />
        ))}
    </>
  );
}
