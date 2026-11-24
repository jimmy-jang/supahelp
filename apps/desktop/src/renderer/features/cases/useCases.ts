import { useEffect, useRef, useState } from 'react';
import type { Scoped } from '../../../contracts/accounts';
import type {
  CaseEditCommand,
  CasePerson,
  CaseSnapshot,
  CaseStatus,
} from '../../../contracts/cases';
import { useAccount } from '../accounts/AccountProvider';
import { useCollaboration } from '../collaboration/useCollaboration';
import { toCase } from './caseDoc';
import { isContextChanged } from '../accounts/snapshots';

// Real cases stored on this computer by main. Out-of-date snapshots are ignored.
export function useCases() {
  const { isCurrent, snapshot: account } = useAccount();
  const context = account.context;
  const collaboration = useCollaboration();
  const [snapshot, setSnapshot] = useState<CaseSnapshot>({
    revision: -1,
    cases: [],
  });
  const [people, setPeople] = useState<CasePerson[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState(true);
  const [undoNotes, setUndoNotes] = useState<Record<string, string>>({});
  const [undoing, setUndoing] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Set<string>());

  useEffect(() => {
    if (!window.supahelp) return;
    let active = true;
    const receive = (next: Scoped<CaseSnapshot>) => {
      if (active && isCurrent(next.context)) {
        setError(undefined);
        setSnapshot((current) =>
          next.revision > current.revision ? next : current,
        );
      }
    };
    setPeople([]);
    setAssigning(false);
    void window.supahelp
      .getCasePeople({ context })
      .then((result) => {
        if (active && isCurrent(context)) {
          if (result.ok) setPeople(result.value);
          else if (!isContextChanged(result.error)) setError(result.error);
        }
      })
      .catch(() => {
        if (active && isCurrent(context))
          setError('Case members could not load. Reopen this workspace.');
      });
    const unsubscribe = window.supahelp.onCasesChanged(receive);
    void window.supahelp
      .getCases(context)
      .then((result) => {
        if (result.ok) receive(result.value);
        else if (
          active &&
          isCurrent(context) &&
          !isContextChanged(result.error)
        )
          setError(result.error);
      })
      .catch(() => {
        if (active) setError('Cases could not load. Restart Supahelp.');
      })
      .finally(() => {
        if (active) setOpening(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isCurrent, context.generation, account.status]);

  const create = async (chatId: string) => {
    if (creating) return;
    setError(undefined);
    setCreating(true);
    try {
      const result = await window.supahelp.createCase({ chatId, context });
      if (!isCurrent(context)) return;
      if (result.ok) return result.value;
      setError(result.error);
    } catch {
      if (isCurrent(context))
        setError(
          'The case could not be saved. Restart Supahelp and try again.',
        );
    } finally {
      if (isCurrent(context)) setCreating(false);
    }
  };

  const undo = async (caseId: string, changeId: string) => {
    if (pending.current.has(changeId)) return;
    pending.current.add(changeId);
    setError(undefined);
    setUndoing(new Set(pending.current));
    try {
      const result = await window.supahelp.undoCaseChange({
        caseId,
        changeId,
        context,
      });
      if (isCurrent(context)) {
        if (
          result.ok ||
          result.error === 'Changed since. Edit it instead.' ||
          result.error === 'Already undone.'
        )
          setUndoNotes((notes) => ({
            ...notes,
            [changeId]: result.ok ? 'Undone' : result.error,
          }));
        else setError(result.error);
      }
    } catch {
      if (isCurrent(context)) setError('Undo could not finish. Try again.');
    } finally {
      pending.current.delete(changeId);
      if (isCurrent(context)) setUndoing(new Set(pending.current));
    }
  };
  const markdown = async (caseId: string) => {
    try {
      const result = await window.supahelp.getCaseMarkdown({ caseId, context });
      if (!isCurrent(context)) return;
      if (result.ok) return result.value;
      setError(result.error);
    } catch {
      if (isCurrent(context))
        setError('The case could not be copied. Try again.');
    }
  };

  const visible =
    (snapshot as Partial<Scoped<CaseSnapshot>>).context?.generation ===
    context.generation
      ? snapshot.cases
      : [];
  return {
    people,
    assigning,
    async assign(
      caseId: string,
      action: 'bring-in' | 'handoff',
      recipientId: string,
      ownerRevision: number,
    ) {
      if (assigning) return;
      setAssigning(true);
      setError(undefined);
      try {
        const result = await window.supahelp.assignCase({
          caseId,
          action,
          recipientId,
          ownerRevision,
          context,
        });
        if (isCurrent(context) && !result.ok) setError(result.error);
      } catch {
        if (isCurrent(context))
          setError(
            'The assignment could not be confirmed. Check the case before trying again.',
          );
      } finally {
        if (isCurrent(context)) setAssigning(false);
      }
    },
    async setStatus(caseId: string, status: CaseStatus) {
      setError(undefined);
      try {
        const result = await window.supahelp.setCaseStatus({
          caseId,
          status,
          context,
        });
        if (isCurrent(context) && !result.ok) setError(result.error);
      } catch {
        if (isCurrent(context))
          setError(
            'The status change could not be confirmed. Check the case before trying again.',
          );
      }
    },
    collaboration,
    revision: snapshot.revision,
    records: visible,
    async rename(caseId: string, title: string, expectedTitle: string) {
      try {
        const result = await window.supahelp.renameCase({
          caseId,
          title,
          expectedTitle,
          context,
        });
        if (!isCurrent(context))
          throw Error('The account or workspace changed.');
        if (!result.ok) throw Error(result.error);
        return result.value;
      } catch (cause) {
        const result = await window.supahelp
          .getCases(context)
          .catch(() => undefined);
        if (result?.ok && isCurrent(context))
          setSnapshot((current) =>
            result.value.revision > current.revision ? result.value : current,
          );
        throw cause instanceof Error
          ? cause
          : Error(
              'The title save could not be confirmed. Review the current case before trying again.',
            );
      }
    },
    async edit(command: CaseEditCommand) {
      try {
        const result = await window.supahelp.editCaseEntry({
          ...command,
          context,
        });
        if (!isCurrent(context))
          return {
            ok: false as const,
            error: 'The account or workspace changed.',
          };
        return result;
      } catch {
        // A lost reply may follow a committed save. Refresh before the person retries.
        const result = await window.supahelp
          .getCases(context)
          .catch(() => undefined);
        if (result?.ok && isCurrent(context))
          setSnapshot((current) =>
            result.value.revision > current.revision ? result.value : current,
          );
        return {
          ok: false as const,
          error:
            'The save could not be confirmed. Review the current case before trying again.',
        };
      }
    },
    cancelEdit: (requestId: string) =>
      window.supahelp.cancelCaseEdit({ context, requestId }),
    cases: visible.map((c) => ({
      ...toCase(c, undefined, collaboration.value?.members),
      questionsForYou: c.entries.filter(
        (e) =>
          e.section === 'questions' &&
          e.pill === 'Open' &&
          e.recipientId === context.accountId,
      ).length,
    })),
    error,
    create,
    creating,
    opening,
    undo,
    markdown,
    undoNotes,
    undoing,
  };
}
