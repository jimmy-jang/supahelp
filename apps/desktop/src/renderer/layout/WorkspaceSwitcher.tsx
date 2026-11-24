import { Icon } from '../components/Icon';
import { Popover, menuGroup, menuRow } from '../components/Popover';
import { useAccount } from '../features/accounts/AccountProvider';

const mark = (letter: string, muted = false) => (
  <span
    className={`grid size-5 flex-none place-items-center rounded-chip text-[10.5px] font-semibold ${muted ? 'bg-sunk text-ink-2' : 'bg-ink text-on-ink'}`}
  >
    {letter}
  </span>
);
export function WorkspaceSwitcher({
  onSettings,
  onBilling,
  onNewOrganization,
  onContextChange,
}: {
  onSettings: () => void;
  onBilling: () => void;
  onNewOrganization: () => void;
  onContextChange: () => Promise<boolean>;
}) {
  const { snapshot, busy, error, run } = useAccount();
  const context = snapshot.context.context,
    view = snapshot.view;
  const current =
    context.kind === 'team'
      ? view?.workspaces.find((w) => w.id === context.workspaceId)
      : undefined;
  const org = view?.organizations.find((o) => o.id === current?.organizationId);
  return (
    <div className="mx-2 mb-1.5 flex flex-none flex-col">
      <Popover
        title="Switch workspace"
        className="w-[280px]"
        buttonClass="flex h-[34px] w-full items-center gap-2 rounded-item px-2 hover:bg-hover [&:has(+:popover-open)]:bg-hover"
        label={
          <>
            {org?.icon ? (
              <img
                src={org.icon}
                alt=""
                className="size-5 flex-none rounded-chip object-cover"
              />
            ) : (
              mark(org?.name[0]?.toUpperCase() || 'P', !org)
            )}
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {org ? `${org.name} · ${current?.name}` : 'Personal'}
            </span>
            <span className="text-[11px] text-ink-3">
              {org ? 'Team' : 'This computer'}
            </span>
            <Icon name="down" size={12} />
          </>
        }
      >
        <div className={menuGroup}>Personal (free)</div>
        <button
          type="button"
          disabled={busy}
          aria-current={!current || undefined}
          className={menuRow}
          onClick={async () => {
            if (current && (await onContextChange()))
              void run(() =>
                window.supahelp.selectWorkspace(
                  { kind: 'personal' },
                  snapshot.context,
                ),
              );
          }}
        >
          {mark('P', true)}
          <span className="flex-1">Personal on this computer</span>
          {!current && <Icon name="check" size={14} />}
        </button>
        {view?.organizations.map((organization) => (
          <div key={organization.id}>
            <div className={menuGroup}>
              {organization.name} · {organization.access}
            </div>
            {view.workspaces
              .filter((w) => w.organizationId === organization.id)
              .map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  className={menuRow}
                  aria-current={workspace.id === current?.id || undefined}
                  disabled={
                    busy ||
                    !['active', 'read-only'].includes(organization.access)
                  }
                  onClick={async () => {
                    if (
                      workspace.id === current?.id ||
                      !(await onContextChange())
                    )
                      return;
                    void run(() =>
                      window.supahelp.selectWorkspace(
                        {
                          kind: 'team',
                          organizationId: organization.id,
                          workspaceId: workspace.id,
                        },
                        snapshot.context,
                      ),
                    );
                  }}
                >
                  {organization.icon ? (
                    <img
                      src={organization.icon}
                      alt=""
                      className="size-5 flex-none rounded-chip object-cover"
                    />
                  ) : (
                    mark(workspace.name[0]?.toUpperCase() || 'W')
                  )}
                  <span className="flex-1 truncate">{workspace.name}</span>
                  {workspace.id === current?.id && (
                    <Icon name="check" size={14} />
                  )}
                </button>
              ))}
          </div>
        ))}
        {/* Builds without the account service have no Team to upgrade to. */}
        {snapshot.error?.code !== 'not-configured' && (
          <>
            {/* With no organization yet, "Upgrade to Team" is the same path. */}
            {!!view?.organizations.length && (
              <button
                type="button"
                className={menuRow}
                onClick={onNewOrganization}
              >
                <Icon name="plus" size={15} />
                New organization
              </button>
            )}
            <div className="mx-1 my-1.5 h-px bg-line" />
            <button type="button" className={menuRow} onClick={onBilling}>
              <Icon name="chart" size={15} />
              {context.kind === 'personal'
                ? 'Upgrade to Team'
                : 'Plan & billing'}
            </button>
            <button type="button" className={menuRow} onClick={onSettings}>
              <Icon name="users" size={15} />
              Workspace settings
            </button>
          </>
        )}
      </Popover>
      {error && (
        <p role="alert" className="m-0 px-2 text-meta text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
