import { useEffect, useRef, useState } from 'react';
import type { SectionKey } from '../features/cases/types';

// What the document panel beside the chat shows.
export type Panel =
  | {
      kind: 'case';
      id: string;
      focus?: { section: SectionKey; token: number };
    }
  | { kind: 'playbook'; id: string }
  | null;

export function useDocumentPanel() {
  const [panel, setPanelRaw] = useState<Panel>(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const playbookGuard = useRef<() => Promise<boolean>>(async () => true);
  const leaving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const leavePlaybook = async () => {
    if (leaving.current || !mounted.current) return false;
    leaving.current = true;
    const guard = playbookGuard.current;
    try {
      return (
        (await guard()) && mounted.current && playbookGuard.current === guard
      );
    } finally {
      leaving.current = false;
    }
  };
  const setPanel = async (next: Panel) => {
    if (
      panelRef.current?.kind === next?.kind &&
      panelRef.current?.id === next?.id
    ) {
      setPanelRaw(next);
      return true;
    }
    if (!(await leavePlaybook())) return false;
    setPanelRaw(next);
    return true;
  };
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [panel?.kind, panel?.id]);
  return {
    panel,
    panelRef,
    setPanel,
    setPanelRaw,
    playbookGuard,
    leavePlaybook,
    expanded,
    setExpanded,
  };
}
