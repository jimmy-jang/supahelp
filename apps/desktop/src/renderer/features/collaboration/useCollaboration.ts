import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reply } from '../../../contracts/chat';
import type {
  CollaborateCase,
  CollaborationSnapshot,
  NotificationPreferences,
} from '../../../contracts/sync';
import { useAccount } from '../accounts/AccountProvider';
import { isContextChanged } from '../accounts/snapshots';
export function useCollaboration() {
  const { snapshot: account, isCurrent } = useAccount(),
    context = account.context;
  const [value, setValue] = useState<CollaborationSnapshot>();
  const [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(context.generation);
  if (generation !== context.generation) {
    setGeneration(context.generation);
    setValue(undefined);
    setError(undefined);
    setBusy(false);
  }
  const pending = useRef(false),
    intents = useRef(new Map<string, string>());
  const receive = useCallback(
    (r: Reply<CollaborationSnapshot>) => {
      if (!isCurrent(context)) return;
      if (r.ok) {
        setValue(r.value);
        setError(undefined);
      } else {
        setValue(undefined);
        setError(isContextChanged(r.error) ? undefined : r.error);
      }
    },
    [context.generation, isCurrent],
  );
  const refresh = useCallback(async () => {
    if (!window.supahelp?.getCollaboration) return;
    try {
      receive(await window.supahelp.getCollaboration({ context }));
    } catch {
      if (isCurrent(context)) {
        setValue(undefined);
        setError('Shared work could not load. Reconnect and refresh.');
      }
    }
  }, [receive, context.generation]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  const run = async (fn: () => Promise<Reply<CollaborationSnapshot>>) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const r = await fn();
      receive(r);
      return isCurrent(context) && r.ok;
    } catch {
      if (isCurrent(context))
        setError('The result could not be confirmed. Refresh before retrying.');
      return false;
    } finally {
      pending.current = false;
      if (isCurrent(context)) setBusy(false);
    }
  };
  return {
    value,
    error,
    busy,
    refresh,
    accountId: context.accountId,
    canEdit:
      context.context.kind !== 'team' ||
      ['admin', 'member'].includes(
        account.view?.workspaces.find(
          (w) =>
            w.id ===
            (context.context.kind === 'team'
              ? context.context.workspaceId
              : ''),
        )?.role ?? '',
      ),
    async command(input: Omit<CollaborateCase, 'id'>) {
      const key = JSON.stringify(input),
        id = intents.current.get(key) ?? crypto.randomUUID();
      intents.current.set(key, id);
      const ok = await run(() =>
        window.supahelp.collaborateCase({ ...input, id, context }),
      );
      if (ok) intents.current.delete(key);
      return ok;
    },
    answer: (
      caseId: string,
      entryId: string,
      base: number,
      text: string,
      id: string,
    ) =>
      run(() =>
        window.supahelp.answerCaseQuestion({
          context,
          caseId,
          entryId,
          base,
          text,
          id,
        }),
      ),
    check: (id: string) =>
      run(() => window.supahelp.checkCaseAnswer({ context, id })),
    cancel: (id: string) =>
      run(() => window.supahelp.cancelCaseAnswer({ context, id })),
    read: (id: string) =>
      run(() => window.supahelp.readCaseNotification({ context, id })),
    preferences: (preferences: NotificationPreferences) =>
      run(() =>
        window.supahelp.setNotificationPreferences({ context, preferences }),
      ),
  };
}
