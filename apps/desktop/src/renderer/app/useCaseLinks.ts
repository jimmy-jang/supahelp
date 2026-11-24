import { useEffect } from 'react';
import { useAccount } from '../features/accounts/AccountProvider';
import type { SettingsPage } from '../features/settings/pages';
import type { Panel } from './useDocumentPanel';

export function useCaseLinks({
  setPanel,
  leavePlaybook,
  openSettings,
  resumeCaseChat,
  setSyncNotice,
}: {
  setPanel(next: Panel): Promise<boolean>;
  leavePlaybook(): Promise<boolean>;
  openSettings(page: SettingsPage): Promise<void>;
  resumeCaseChat(caseId: string): void;
  setSyncNotice(notice: string): void;
}) {
  const { snapshot: account, isCurrent } = useAccount();
  useEffect(() => {
    const pending = account.pendingCaseLink;
    if (!pending) return;
    if (!account.context.accountId && !pending.local) {
      setSyncNotice('Sign in to open this shared case.');
      void openSettings('account');
      return;
    }
    let active = true;
    const context = account.context;
    void (async () => {
      if (pending.local) {
        if (context.context.kind !== 'personal') {
          if (!(await leavePlaybook()) || !active || !isCurrent(context))
            return;
          await window.supahelp.selectWorkspace({ kind: 'personal' });
          return;
        }
        const records = await window.supahelp.getCases(context);
        if (!active || !isCurrent(context)) return;
        if (
          !records.ok ||
          !records.value.cases.some((c) => c.id === pending.target)
        ) {
          setSyncNotice(
            'This case is unavailable or you no longer have access.',
          );
          return;
        }
        if (
          !(await setPanel({ kind: 'case', id: pending.target })) ||
          !active ||
          !isCurrent(context)
        )
          return;
        resumeCaseChat(pending.target);
        setSyncNotice('');
        await window.supahelp.clearCaseLink({ context, id: pending.id });
        return;
      }
      const r = await window.supahelp.resolveCaseLink({
        context,
        id: pending.target,
      });
      if (!active || !isCurrent(context)) return;
      if (!r.ok) {
        setSyncNotice(r.error);
        return;
      }
      const workspace = account.view?.workspaces.find(
        (w) => w.id === r.value.workspaceId,
      );
      if (!workspace) {
        setSyncNotice('This case is unavailable or you no longer have access.');
        return;
      }
      if (
        context.context.kind !== 'team' ||
        context.context.workspaceId !== workspace.id
      ) {
        if (!(await leavePlaybook()) || !active || !isCurrent(context)) return;
        const selected = await window.supahelp.selectWorkspace({
          kind: 'team',
          organizationId: workspace.organizationId,
          workspaceId: workspace.id,
        });
        if (!selected.ok && active) setSyncNotice(selected.error);
        return;
      }
      if (
        !(await setPanel({ kind: 'case', id: r.value.caseId })) ||
        !active ||
        !isCurrent(context)
      )
        return;
      resumeCaseChat(r.value.caseId);
      setSyncNotice('');
      await window.supahelp.clearCaseLink({ context, id: pending.id });
    })().catch(() => {
      if (active && isCurrent(context))
        setSyncNotice('This case is unavailable or you no longer have access.');
    });
    return () => {
      active = false;
    };
  }, [account.pendingCaseLink?.id, account.context.generation, account.status]);
}
