import { useEffect, useState } from 'react';
import type { Scoped } from '../../../contracts/accounts';
import type { LinearSnapshot } from '../../../contracts/linear';
import { useAccount } from '../accounts/AccountProvider';
import { isContextChanged } from '../accounts/snapshots';

export function useLinear() {
  const { isCurrent } = useAccount();
  const [snapshot, setSnapshot] = useState<LinearSnapshot>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    if (!window.supahelp?.getLinear) {
      setError('Open the desktop app to connect Linear.');
      return;
    }
    const receive = (value: Scoped<LinearSnapshot>) => {
      if (active && isCurrent(value.context))
        setSnapshot((current) =>
          !current || value.revision > current.revision ? value : current,
        );
    };
    const unsubscribe = window.supahelp.onLinearChanged(receive);
    void window.supahelp
      .getLinear()
      .then((reply) => {
        if (reply.ok) receive(reply.value);
        else if (active && !isContextChanged(reply.error))
          setError(reply.error);
      })
      .catch(() => {
        if (active) setError('Connections could not be loaded.');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isCurrent]);
  return { snapshot, error, setError };
}
