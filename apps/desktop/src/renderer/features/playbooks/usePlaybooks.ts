import { useEffect, useRef, useState } from 'react';
import type { Scoped } from '../../../contracts/accounts';
import type {
  DocumentRequest,
  DocumentResults,
  PlaybookSnapshot,
} from '../../../contracts/playbooks';
import { useAccount } from '../accounts/AccountProvider';
import { isContextChanged } from '../accounts/snapshots';

export function usePlaybooks() {
  const { snapshot: account, isCurrent } = useAccount();
  const [snapshot, setSnapshot] = useState<PlaybookSnapshot>({
    revision: -1,
    playbooks: [],
    resolutions: [],
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    if (!window.supahelp) return;
    let active = true;
    const receive = (next: Scoped<PlaybookSnapshot>) => {
      if (active && isCurrent(next.context)) {
        setError(undefined);
        setSnapshot((old) => (next.revision > old.revision ? next : old));
      }
    };
    const unsubscribe = window.supahelp.onPlaybooksChanged(receive);
    void window.supahelp
      .getPlaybooks({ context: account.context })
      .then((r) => {
        if (r.ok) receive(r.value);
        else if (active && !isContextChanged(r.error)) setError(r.error);
      })
      .catch(() => {
        if (active) setError('Playbooks could not load.');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isCurrent, account.context.generation]);
  async function run<K extends keyof DocumentResults>(
    name: K,
    input: Omit<DocumentRequest, 'context'>,
  ): Promise<DocumentResults[K] | undefined> {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const method = window.supahelp[name] as (
        a: DocumentRequest,
      ) => Promise<import('../../../contracts/chat').Reply<DocumentResults[K]>>;
      const result = await method({ ...input, context: account.context });
      if (!isCurrent(account.context)) return;
      if (result.ok) return result.value;
      setError(result.error);
    } catch {
      if (isCurrent(account.context))
        setError(
          'The document operation could not finish. Saved records are preserved.',
        );
    } finally {
      pending.current = false;
      if (isCurrent(account.context)) setBusy(false);
    }
  }
  // Opening a case skips run's one-at-a-time lock (which guards writes) so a
  // second click is never dropped; only the newest click's reply is used.
  const latestOpen = useRef(0);
  async function resumeCase(caseId: string) {
    const token = ++latestOpen.current;
    const context = account.context;
    setError(undefined);
    try {
      const result = await window.supahelp.resumeCase({ caseId, context });
      if (token !== latestOpen.current || !isCurrent(context)) return;
      if (result.ok) return result.value;
      setError(result.error);
    } catch {
      if (token === latestOpen.current && isCurrent(context))
        setError('The case could not open. Try again.');
    }
  }
  const cancel = () =>
    void window.supahelp.cancelDocumentWork({ context: account.context });
  const visible =
    (snapshot as Partial<Scoped<PlaybookSnapshot>>).context?.generation ===
    account.context.generation;
  return {
    ...snapshot,
    playbooks: visible ? snapshot.playbooks : [],
    resolutions: visible ? snapshot.resolutions : [],
    run,
    resumeCase,
    error,
    busy,
    cancel,
  };
}
