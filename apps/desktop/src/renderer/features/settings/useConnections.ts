import { useEffect, useState } from 'react';
import type { Scoped } from '../../../contracts/accounts';
import type { CatalogSnapshot } from '../../../contracts/catalog';
import { useAccount } from '../accounts/AccountProvider';
import { isContextChanged } from '../accounts/snapshots';

export function useConnections() {
  const { isCurrent } = useAccount();
  const [snapshot, setSnapshot] = useState<CatalogSnapshot>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    if (!window.supahelp?.getConnections) {
      setError('Open the desktop app to connect services.');
      return;
    }
    const receive = (value: Scoped<CatalogSnapshot>) => {
      if (active && isCurrent(value.context))
        setSnapshot((current) =>
          !current || value.revision > current.revision ? value : current,
        );
    };
    const unsubscribe = window.supahelp.onConnectionsChanged(receive);
    void window.supahelp
      .getConnections()
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
