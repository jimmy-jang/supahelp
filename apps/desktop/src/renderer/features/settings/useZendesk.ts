import { useEffect, useState } from 'react';
import type { Scoped } from '../../../contracts/accounts';
import type { ZendeskSnapshot } from '../../../contracts/zendesk';
import { useAccount } from '../accounts/AccountProvider';
import { isContextChanged } from '../accounts/snapshots';
export function useZendesk() {
  const { isCurrent } = useAccount();
  const [snapshot, setSnapshot] = useState<ZendeskSnapshot>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    if (!window.supahelp?.getZendesk) {
      setError('Open the desktop app to connect Zendesk.');
      return;
    }
    const receive = (value: Scoped<ZendeskSnapshot>) => {
      if (active && isCurrent(value.context))
        setSnapshot((current) =>
          !current || value.revision > current.revision ? value : current,
        );
    };
    const unsubscribe = window.supahelp.onZendeskChanged(receive);
    void window.supahelp
      .getZendesk()
      .then((reply) => {
        if (reply.ok) receive(reply.value);
        else if (active && !isContextChanged(reply.error))
          setError(reply.error);
      })
      .catch(() => {
        if (active) setError('Zendesk connection could not be loaded.');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isCurrent]);
  return { snapshot, error, setError };
}
