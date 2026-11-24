import { useCallback, useEffect, useState } from 'react';
import { tourDecision } from './model';

export function useQuickTour(state: {
  loaded: boolean;
  hasWork: boolean;
  onHome: boolean;
}) {
  const [seen, setSeen] = useState<boolean>();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(false);

  useEffect(() => {
    let active = true;
    void window.supahelp
      ?.getQuickTour?.()
      .then((reply) => {
        if (active && reply.ok) setSeen(reply.value.seen);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const retire = useCallback(() => {
    setSeen(true);
    void window.supahelp?.completeQuickTour?.().catch(() => undefined);
  }, []);
  const decision = tourDecision({ seen, ...state });
  useEffect(() => {
    if (decision === 'start') setOpen(true);
    else if (decision === 'retire') retire();
  }, [decision, retire]);

  const start = useCallback(() => {
    setNote(false);
    setOpen(true);
  }, []);
  const close = useCallback(
    (skipped: boolean) => {
      setOpen(false);
      setNote(skipped);
      retire();
    },
    [retire],
  );
  const dismissNote = useCallback(() => setNote(false), []);
  return { open, note, start, close, dismissNote };
}
