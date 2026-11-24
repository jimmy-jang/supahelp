import { useEffect, useState } from 'react';
import type { CustomerDirectory } from '../../../contracts/cases';
import { useAccount } from '../accounts/AccountProvider';

const empty: CustomerDirectory = { customers: [], links: [] };

export function useCustomers(active: boolean) {
  const { snapshot, isCurrent } = useAccount();
  const { context } = snapshot;
  const enabled = active && context.context.kind === 'personal';
  const [state, setState] = useState<{
    generation: number;
    directory?: CustomerDirectory;
    error?: string;
  }>();
  const [revision, refresh] = useState(0);
  useEffect(() => {
    setState(undefined);
    if (!enabled || !window.supahelp) return;
    let mounted = true;
    void window.supahelp.getCustomers(context).then(
      (reply) => {
        if (mounted && isCurrent(context))
          setState({
            generation: context.generation,
            ...(reply.ok ? { directory: reply.value } : { error: reply.error }),
          });
      },
      () => {
        if (mounted && isCurrent(context))
          setState({
            generation: context.generation,
            error: 'Customers could not load.',
          });
      },
    );
    return () => {
      mounted = false;
    };
  }, [enabled, context.generation, isCurrent, revision]);

  const current =
    enabled && state?.generation === context.generation ? state : undefined;
  return {
    directory: current?.directory ?? empty,
    error: current?.error,
    retry: () => refresh((value) => value + 1),
  };
}
