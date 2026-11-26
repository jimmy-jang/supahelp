import { useCallback, useEffect, useState } from 'react';
import type { PublicAccount } from '../../../contracts/accounts';
import { useAccount } from './AccountProvider';
import { isContextChanged } from './snapshots';

export function useWorkspaces(scope: 'organization' | 'workspace') {
  const { snapshot, isCurrent } = useAccount();
  const [orgChoice, setOrganization] = useState(''),
    [workspaceChoice, setWorkspace] = useState('');
  const [people, setPeople] = useState<
    { account: PublicAccount; seated: boolean; workspaceCount: number }[]
  >([]);
  const [loadError, setLoadError] = useState<string>();
  const organizations = snapshot.view?.organizations ?? [];
  const selected = snapshot.context.context;
  const organization =
    organizations.find(
      (o) =>
        o.id ===
        (orgChoice ||
          (selected.kind === 'team' ? selected.organizationId : '')),
    ) ?? organizations[0];
  const workspaces = (snapshot.view?.workspaces ?? []).filter(
    (w) => w.organizationId === organization?.id,
  );
  const workspace =
    workspaces.find(
      (w) =>
        w.id ===
        (workspaceChoice ||
          (selected.kind === 'team' ? selected.workspaceId : '')),
    ) ?? workspaces[0];
  const owner =
    !!organization && organization.ownerId === snapshot.context.accountId;
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    let active = true;
    let loading = false;
    const stamp = snapshot.context;
    setPeople([]);
    setLoadError(undefined);
    if (!window.supahelp) return;
    const refresh = async () => {
      if (loading || !isCurrent(stamp)) return;
      loading = true;
      try {
        if (scope === 'organization' && owner && organization) {
          const reply = await window.supahelp.getOrganizationMembers(
            organization.id,
            stamp,
          );
          if (active && isCurrent(stamp)) {
            if (reply.ok) {
              setPeople(reply.value);
              setLoadError(undefined);
            } else if (!isContextChanged(reply.error))
              setLoadError(reply.error);
          }
        }
        if (scope === 'workspace' && workspace) {
          const reply = await window.supahelp.getWorkspaceMembers(
            workspace.id,
            stamp,
          );
          if (active && isCurrent(stamp))
            setLoadError(
              reply.ok || isContextChanged(reply.error)
                ? undefined
                : reply.error,
            );
        }
      } catch {
        if (active && isCurrent(stamp))
          setLoadError('Members could not load. Refresh to try again.');
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    scope,
    workspace?.id,
    workspace?.role,
    organization?.access,
    organization?.id,
    owner,
    snapshot.context.generation,
    version,
    isCurrent,
  ]);
  const roster = snapshot.membersWorkspaceId === workspace?.id;
  return {
    organization,
    organizations,
    workspaces,
    workspace,
    setOrganization,
    setWorkspace,
    owner,
    people,
    loadError,
    reload,
    members: roster ? snapshot.members : [],
    invitations: roster ? snapshot.invitations : [],
  };
}
