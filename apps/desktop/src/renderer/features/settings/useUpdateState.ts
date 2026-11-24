import { useEffect, useState } from 'react';
import type { UpdateState } from '../../../contracts/updates';

// Live app-update state from the main process; undefined until the first reply.
export function useUpdateState() {
  const [state, setState] = useState<UpdateState>();
  useEffect(() => {
    let live = true;
    void window.supahelp?.getUpdateState().then(
      (next) => live && next && setState(next),
      () => {},
    );
    const off = window.supahelp?.onUpdateState?.(setState);
    return () => {
      live = false;
      off?.();
    };
  }, []);
  return state;
}
