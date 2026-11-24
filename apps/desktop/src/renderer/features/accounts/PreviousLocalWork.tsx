import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { Card, Group, Row } from '../settings/parts';
import { useAccount } from './AccountProvider';

export function PreviousLocalWork() {
  const { snapshot, isCurrent, run, busy } = useAccount();
  const confirm = useConfirmation();
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void window.supahelp
      .getPreviousWork()
      .then((reply) => {
        if (active && isCurrent(snapshot.context)) {
          if (reply.ok) setAvailable(reply.value.available);
          else setError(reply.error);
        }
      })
      .catch(() => {
        if (active) setError('Previous local work could not be checked.');
      });
    return () => {
      active = false;
    };
  }, [snapshot.context.generation, isCurrent]);
  if (!available && !error) return null;
  const account = snapshot.view?.account;
  return (
    <Group label="Previous local work">
      <Card>
        <Row
          title="Recover work from an earlier version"
          description={
            error ??
            'Earlier versions saved work for this computer without an account owner. Recovery assigns all that work to one account and keeps the original files. Mixed-account work cannot be separated automatically. Your current personal workspace must be empty.'
          }
        >
          {available &&
            account &&
            snapshot.context.context.kind === 'personal' && (
              <Button
                kind="secondary"
                disabled={busy || snapshot.status !== 'ready'}
                onClick={async () => {
                  const accepted = await confirm({
                    title: 'Assign previous work to this account?',
                    description: `All previous chats, cases and Playbooks will belong to ${account.email}. This can be done once.`,
                    action: 'Recover previous work',
                  });
                  if (accepted && isCurrent(snapshot.context))
                    await run(() => window.supahelp.recoverPersonalWork());
                }}
              >
                Recover previous work
              </Button>
            )}
        </Row>
      </Card>
    </Group>
  );
}
