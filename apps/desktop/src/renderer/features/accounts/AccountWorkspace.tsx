import { formatDateTime } from '../../app/formatDate';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { ContextStamp, WorkspaceRole } from '../../../contracts/accounts';
import type { Reply } from '../../../contracts/chat';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { useConfirmation } from '../../components/ConfirmationProvider';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { Popover, menuRow } from '../../components/Popover';
import { Select } from '../../components/controls';
import { Card, Group, Note, PageHeader, Row } from '../settings/parts';
import { useAccount } from './AccountProvider';
import { useWorkspaces } from './useWorkspaces';

const field =
  'h-8 min-w-0 flex-1 rounded-item bg-sunk px-2.5 text-ink ring-1 ring-line';
function Confirm({
  label,
  detail,
  disabled,
  action,
}: {
  label: string;
  detail: string;
  disabled: boolean;
  action: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <span
      className={
        confirm
          ? 'flex basis-full items-center justify-between gap-3'
          : 'flex flex-none items-center'
      }
    >
      {confirm ? (
        <>
          <span className="min-w-0 flex-1 text-left text-meta text-ink-2">
            {detail}
          </span>
          <span className="flex flex-none items-center gap-2">
            <Button
              kind="danger"
              disabled={disabled}
              onClick={() => {
                setConfirm(false);
                action();
              }}
            >
              Confirm {label.toLowerCase()}
            </Button>
            <Button kind="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </span>
        </>
      ) : (
        <Button
          kind="ghost"
          disabled={disabled}
          onClick={() => setConfirm(true)}
        >
          {label}
        </Button>
      )}
    </span>
  );
}
function Choice({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={`${field} flex-none`}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
// A row that asks for input: title, then the fields, then the button underneath.
function FormRow({
  title,
  description,
  fields,
  button,
  onSubmit,
}: {
  title: string;
  description?: string;
  fields: ReactNode;
  button: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="flex flex-col gap-3 px-3.5 py-3" onSubmit={onSubmit}>
      <div>
        <div className="font-medium">{title}</div>
        {description && (
          <div className="text-meta leading-[1.45] text-ink-3">
            {description}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">{fields}</div>
      <div>{button}</div>
    </form>
  );
}
function person(name: string) {
  return (
    <span className="flex items-center gap-2.5">
      <Avatar name={name} size={22} />
      {name}
    </span>
  );
}

function usePage(scope: 'organization' | 'workspace') {
  const { snapshot, busy, run, mutate } = useAccount();
  const model = useWorkspaces(scope);
  const act = async <T,>(
    intent: string,
    operation: (id: string) => Promise<Reply<T>>,
  ) => {
    const result = await mutate(intent, operation);
    if (result) model.reload();
    return result;
  };
  return { snapshot, busy, run, model, act };
}

function Header({
  title,
  description,
  model,
}: {
  title: string;
  description: string;
  model?: ReturnType<typeof useWorkspaces>;
}) {
  const { snapshot, busy, run, error } = useAccount();
  const problem = error ?? snapshot.error?.message ?? model?.loadError;
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        action={
          <Button
            kind="ghost"
            disabled={busy}
            onClick={() =>
              void run(() => window.supahelp.refreshAccount()).then(
                model?.reload,
              )
            }
          >
            Refresh
          </Button>
        }
      />
      {problem && (
        <p role="alert" className="m-0 text-bad">
          {problem}
        </p>
      )}
    </>
  );
}
export function AccountSettings() {
  const { snapshot, busy, run } = useAccount();
  const account = snapshot.view?.account;
  const [rename, setRename] = useState<string | null>(null);
  return (
    <>
      <Header
        title="Account"
        description="Who you are signed in as on this computer."
      />
      <Group label="Account">
        <Card>
          <Row
            title={person(account?.name || 'Personal on this computer')}
            description={
              account?.email ||
              'Free local work. Signing in does not upload your chats or cases.'
            }
          >
            {snapshot.status === 'signing-in' ? (
              <Button
                kind="secondary"
                onClick={() =>
                  void run(() => window.supahelp.cancelAccountSignIn())
                }
              >
                Cancel sign-in
              </Button>
            ) : account ? (
              <Confirm
                label="Sign out"
                disabled={busy}
                detail="Team caches and unsynced team work on this computer will be removed. Personal documents stay saved for this account."
                action={() => void run(() => window.supahelp.signOutAccount())}
              />
            ) : (
              <Button
                disabled={busy || snapshot.error?.code === 'not-configured'}
                onClick={() => void run(() => window.supahelp.signInAccount())}
              >
                Sign in with email or Google
              </Button>
            )}
          </Row>
          {account && (
            <FormRow
              title="Name"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() =>
                  window.supahelp.renameAccount((rename ?? '').trim()),
                ).then((result) => {
                  if (result) setRename(null);
                });
              }}
              fields={
                <input
                  aria-label="Your name"
                  className={field}
                  value={rename ?? account.name}
                  onChange={(event) => setRename(event.target.value)}
                  maxLength={100}
                  required
                />
              }
              button={
                <Button
                  kind="secondary"
                  type="submit"
                  disabled={
                    busy || !rename?.trim() || rename.trim() === account.name
                  }
                >
                  Save name
                </Button>
              }
            />
          )}
          {snapshot.status === 'signing-in' && (
            <Row
              title="Finish signing in in your browser"
              description="Use an email verification code or Google, then return to Supahelp."
            />
          )}
        </Card>
      </Group>
    </>
  );
}

export function OrganizationSettings() {
  const { snapshot, busy, run, model, act } = usePage('organization');
  const { organization, owner } = model;
  const [orgName, setOrgName] = useState('');
  const [rename, setRename] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [iconError, setIconError] = useState('');
  return (
    <>
      <Header
        title="Organization"
        description="Manage seats, ownership and data for your organization."
        model={model}
      />
      {snapshot.view ? (
        <>
          <Group label="Organizations">
            <Card>
              {organization ? (
                <Row title="Organization">
                  <Choice
                    label="Organization"
                    value={organization.id}
                    onChange={(value) => {
                      model.setOrganization(value);
                      setRename(null);
                    }}
                    options={model.organizations}
                  />
                </Row>
              ) : (
                <Row
                  title="Create your organization"
                  description="Start a 14-day free trial or subscribe to activate Team. Your personal workspace remains free."
                />
              )}
              {organization && owner && (
                <Row
                  title="Organization icon"
                  description="Shown to your team in the workspace switcher."
                >
                  <div className="flex items-center gap-2">
                    {organization.icon && (
                      <img
                        src={organization.icon}
                        alt=""
                        className="size-8 rounded-item object-cover"
                      />
                    )}
                    <label className="cursor-pointer text-ink underline">
                      Choose image
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        disabled={busy}
                        onChange={async (event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = '';
                          if (!file) return;
                          setIconError('');
                          try {
                            if (
                              file.size > 5_000_000 ||
                              ![
                                'image/png',
                                'image/jpeg',
                                'image/webp',
                              ].includes(file.type)
                            )
                              throw Error();
                            const image = await createImageBitmap(file);
                            const canvas = document.createElement('canvas');
                            canvas.width = 64;
                            canvas.height = 64;
                            const ctx = canvas.getContext('2d');
                            if (!ctx) {
                              image.close();
                              throw Error();
                            }
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, 64, 64);
                            const size = Math.min(image.width, image.height);
                            ctx.drawImage(
                              image,
                              (image.width - size) / 2,
                              (image.height - size) / 2,
                              size,
                              size,
                              0,
                              0,
                              64,
                              64,
                            );
                            image.close();
                            const icon = canvas.toDataURL('image/jpeg', 0.8);
                            if (icon.length > 12000) throw Error();
                            await run(() =>
                              window.supahelp.setOrganizationIcon({
                                organizationId: organization.id,
                                icon,
                                context: snapshot.context,
                              }),
                            );
                          } catch {
                            setIconError(
                              'Choose a valid PNG, JPEG or WebP image under 5 MB.',
                            );
                          }
                        }}
                      />
                    </label>
                    {organization.icon && (
                      <Button
                        kind="ghost"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            window.supahelp.setOrganizationIcon({
                              organizationId: organization.id,
                              icon: null,
                              context: snapshot.context,
                            }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    )}
                    {iconError && (
                      <span role="alert" className="text-bad">
                        {iconError}
                      </span>
                    )}
                  </div>
                </Row>
              )}
              {organization && owner && (
                <FormRow
                  title="Organization name"
                  description="Only the organization owner can rename it."
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = (rename ?? organization.name).trim();
                    void act(`rename:${organization.id}:${next}`, (id) =>
                      window.supahelp.renameOrganization({
                        context: snapshot.context,
                        organizationId: organization.id,
                        name: next,
                        requestId: id,
                      }),
                    ).then((result) => {
                      if (result) setRename(null);
                    });
                  }}
                  fields={
                    <input
                      aria-label="Rename organization"
                      className={field}
                      value={rename ?? organization.name}
                      onChange={(event) => setRename(event.target.value)}
                      required
                      maxLength={100}
                    />
                  }
                  button={
                    <Button
                      kind="secondary"
                      type="submit"
                      disabled={
                        busy ||
                        !(rename ?? '').trim() ||
                        rename!.trim() === organization.name
                      }
                    >
                      Save name
                    </Button>
                  }
                />
              )}
              {!organization && (
                <FormRow
                  title="Organization name"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(`org:${orgName}`, (id) =>
                      window.supahelp.createOrganization({
                        context: snapshot.context,
                        name: orgName,
                        requestId: id,
                      }),
                    ).then((result) => {
                      if (result) {
                        model.setOrganization(result.value.organizationId);
                        setOrgName('');
                      }
                    });
                  }}
                  fields={
                    <input
                      aria-label="Organization name"
                      className={field}
                      value={orgName}
                      onChange={(event) => setOrgName(event.target.value)}
                      required
                      maxLength={100}
                    />
                  }
                  button={
                    <Button
                      kind="secondary"
                      type="submit"
                      disabled={busy || !orgName.trim()}
                    >
                      Create organization
                    </Button>
                  }
                />
              )}
            </Card>
          </Group>
          {organization && (
            <>
              <Group label="Organization data">
                <Card>
                  {owner ? (
                    <Row
                      title="Export organization data"
                      description="Organization records and retained team documents as JSON. Personal chats and cases stay on this computer."
                    >
                      <Button
                        kind="secondary"
                        disabled={
                          busy ||
                          !['active', 'read-only'].includes(organization.access)
                        }
                        onClick={() =>
                          void run(() =>
                            window.supahelp.exportOrganization(
                              organization.id,
                              snapshot.context,
                            ),
                          )
                        }
                      >
                        Export metadata
                      </Button>
                    </Row>
                  ) : (
                    <Row
                      title="Leave organization"
                      description="Stops your access to all its workspaces and releases its seat."
                    >
                      <Confirm
                        label="Leave organization"
                        detail="Your access stops immediately. Sync pending changes first while authorized; remaining unsynced work and team drafts on this computer will be deleted."
                        disabled={busy}
                        action={() =>
                          void act(`leave:${organization.id}`, (id) =>
                            window.supahelp.leaveOrganization({
                              context: snapshot.context,
                              organizationId: organization.id,
                              requestId: id,
                            }),
                          )
                        }
                      />
                    </Row>
                  )}
                  {owner && (
                    <Row
                      title="Delete organization"
                      description="Removes access to this organization and all its workspaces for everyone."
                    >
                      <Button
                        kind="danger"
                        disabled={busy}
                        onClick={() => setDeleting(organization.id)}
                      >
                        Delete organization
                      </Button>
                    </Row>
                  )}
                </Card>
                {owner && deleting === organization.id && (
                  <DeleteTeamResource
                    name={organization.name}
                    resource="organization"
                    busy={busy}
                    onCancel={() => setDeleting(null)}
                    onConfirm={() => {
                      setDeleting(null);
                      void act(`delete-organization:${organization.id}`, (id) =>
                        window.supahelp.deleteOrganization({
                          context: snapshot.context,
                          organizationId: organization.id,
                          requestId: id,
                        }),
                      );
                    }}
                  />
                )}
              </Group>
            </>
          )}
        </>
      ) : (
        <Note>Sign in under Account to manage your organizations.</Note>
      )}
    </>
  );
}

type Act = ReturnType<typeof usePage>['act'];
// One workspace in the list: Open, plus a ⋮ menu with Rename, Leave or Delete by role.
function WorkspaceRow({
  workspace: w,
  owner,
  busy,
  context,
  canOpen,
  act,
  onOpen,
}: {
  workspace: { id: string; name: string; role: WorkspaceRole };
  owner: boolean;
  busy: boolean;
  context: ContextStamp;
  canOpen: boolean;
  act: Act;
  onOpen: () => void;
}) {
  const confirm = useConfirmation();
  const [draft, setDraft] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canRename = w.role === 'admin';
  const leave = async () => {
    if (
      !context.accountId ||
      !(await confirm({
        title: `Leave ${w.name}?`,
        description:
          'Your access to this workspace stops right away and your organization seat stays assigned. Sync pending changes first: unsynced work in it on this computer can be lost.',
        action: 'Leave workspace',
        danger: true,
      }))
    )
      return;
    const accountId = context.accountId;
    await act(`leave-workspace:${w.id}`, (id) =>
      window.supahelp.removeWorkspaceMember({
        context,
        workspaceId: w.id,
        accountId,
        requestId: id,
      }),
    );
  };
  if (draft !== null)
    return (
      <form
        className="flex flex-wrap items-center gap-2 px-3.5 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          const next = draft.trim();
          void act(`rename-workspace:${w.id}:${next}`, (id) =>
            window.supahelp.renameWorkspace({
              context,
              workspaceId: w.id,
              name: next,
              requestId: id,
            }),
          ).then((result) => {
            if (result) setDraft(null);
          });
        }}
      >
        <input
          aria-label={`New name for ${w.name}`}
          autoFocus
          className={field}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDraft(null);
          }}
          maxLength={100}
          required
        />
        <Button
          kind="secondary"
          type="submit"
          disabled={busy || !draft.trim() || draft.trim() === w.name}
        >
          Save
        </Button>
        <Button kind="ghost" onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </form>
    );
  return (
    <>
      <Row title={w.name} description={w.role}>
        <Button kind="ghost" disabled={busy || !canOpen} onClick={onOpen}>
          Open
        </Button>
        <Popover
          title={`Actions for ${w.name}`}
          label={<Icon name="more" size={14} />}
          buttonClass="grid size-7 flex-none place-items-center rounded-item text-ink-3 hover:bg-hover hover:text-ink"
          area="bottom span-left"
          className="w-48"
        >
          {canRename && (
            <button
              type="button"
              className={menuRow}
              disabled={busy}
              onClick={() => setDraft(w.name)}
            >
              <Icon name="edit" size={14} /> Rename
            </button>
          )}
          {owner ? (
            <>
              <div role="separator" className="my-1 h-px bg-line" />
              <button
                type="button"
                className={`${menuRow} text-bad`}
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                <Icon name="trash" size={14} /> Delete workspace
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`${menuRow} text-bad`}
              disabled={busy}
              onClick={() => void leave()}
            >
              <Icon name="out" size={14} /> Leave workspace
            </button>
          )}
        </Popover>
      </Row>
      {deleting && (
        <DeleteTeamResource
          name={w.name}
          resource="workspace"
          busy={busy}
          onCancel={() => setDeleting(false)}
          onConfirm={() =>
            void act(`delete-workspace:${w.id}`, (id) =>
              window.supahelp.deleteWorkspace({
                context,
                workspaceId: w.id,
                requestId: id,
              }),
            ).then((result) => {
              if (result) setDeleting(false);
            })
          }
        />
      )}
    </>
  );
}
// Deleting is for everyone in the organization, so the owner types the name to confirm.
function DeleteTeamResource({
  name,
  resource,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  resource: 'organization' | 'workspace';
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === name;
  return (
    <Modal
      title={`Delete ${name}?`}
      description={`This deletes the ${resource} for everyone in the organization. It can't be undone from the app.`}
      confirmation
      onCancel={onCancel}
    >
      <ul className="mt-3 mb-0 flex list-disc flex-col gap-1 pl-5 text-ink-2">
        <li>Every member loses access right away.</li>
        <li>Pending invitations to it are revoked.</li>
        <li>
          Its synced cases and playbooks are no longer available. Unsynced work
          in it on members' computers can be lost.
        </li>
        <li>
          {resource === 'organization'
            ? 'All workspaces are archived and all organization seats are released.'
            : 'Organization seats stay assigned.'}
        </li>
      </ul>
      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (matches && !busy) onConfirm();
        }}
      >
        <label className="flex flex-col gap-1.5 text-meta text-ink-2">
          <span>
            Type <strong className="font-semibold text-ink">{name}</strong> to
            confirm
          </span>
          <input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className={`${field} w-full flex-none`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button kind="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button kind="danger" type="submit" disabled={busy || !matches}>
            Delete {resource}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function WorkspaceSettings({
  onOpenWorkspace,
}: {
  onOpenWorkspace: () => void;
}) {
  const { snapshot, busy, run, model, act } = usePage('workspace');
  const { organization, workspace, owner } = model;
  const confirm = useConfirmation();
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('member');
  const editable = organization?.access === 'active';
  const admin = owner || workspace?.role === 'admin';
  const invitation = snapshot.pendingInvitation;
  const inviteMessage: Record<string, string> = {
    'sign-in-required': 'Sign in to review this invitation.',
    'wrong-account':
      'This invitation is for a different email, or it has expired or been revoked. Sign out and sign in with the email that received it, or ask the administrator to check it.',
    expired:
      'This invitation is no longer available. Ask the workspace administrator for a new invitation.',
    unavailable: 'The invitation could not be checked. Refresh to try again.',
  };
  return (
    <>
      <Header
        title="Workspace"
        description="Manage workspaces, membership and invitations."
        model={model}
      />
      {invitation && (
        <Group label="Workspace invitation">
          <div className="invite-card rounded-card">
            <Row
              title={
                invitation.offer
                  ? `${invitation.offer.organizationName} · ${invitation.offer.workspaceName}`
                  : 'Review invitation'
              }
              description={
                invitation.offer
                  ? `Invited by ${invitation.offer.inviterName} as ${invitation.offer.role}. Expires ${formatDateTime(invitation.offer.expiresAt)}.`
                  : inviteMessage[invitation.status]
              }
            >
              {invitation.status === 'ready' && (
                <div className="flex gap-2">
                  <Button
                    kind="ghost"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: `Decline ${invitation.offer?.workspaceName ?? 'this invitation'}?`,
                          description:
                            'The invitation is removed. The administrator can invite you again.',
                          action: 'Decline',
                        }))
                      )
                        return;
                      await act(`decline:${invitation.id}`, (id) =>
                        window.supahelp.declineWorkspaceInvitation(
                          invitation.id,
                          id,
                        ),
                      );
                    }}
                  >
                    Decline
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void act(`accept:${invitation.id}`, (id) =>
                        window.supahelp.acceptWorkspaceInvitation(
                          invitation.id,
                          id,
                        ),
                      )
                    }
                  >
                    Join workspace
                  </Button>
                </div>
              )}
              {invitation.status === 'wrong-account' && (
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => window.supahelp.signOutAccount())
                  }
                >
                  Sign out
                </Button>
              )}
            </Row>
          </div>
        </Group>
      )}
      {organization && (
        <>
          <Group label="Workspaces">
            <Card>
              <Row title="Organization">
                <Choice
                  label="Organization"
                  value={organization.id}
                  onChange={(value) => {
                    model.setOrganization(value);
                    model.setWorkspace('');
                  }}
                  options={model.organizations}
                />
              </Row>
              {model.workspaces.map((w) => (
                <WorkspaceRow
                  key={w.id}
                  workspace={w}
                  owner={owner}
                  busy={busy}
                  context={snapshot.context}
                  canOpen={['active', 'read-only'].includes(
                    organization.access,
                  )}
                  act={act}
                  onOpen={() => {
                    const active = snapshot.context.context;
                    if (active.kind === 'team' && active.workspaceId === w.id) {
                      onOpenWorkspace();
                      return;
                    }
                    void run(() =>
                      window.supahelp.selectWorkspace(
                        {
                          kind: 'team',
                          organizationId: organization.id,
                          workspaceId: w.id,
                        },
                        snapshot.context,
                      ),
                    );
                  }}
                />
              ))}
              <FormRow
                title="New workspace"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (busy || !editable || !workspaceName.trim()) return;
                  void act(
                    `workspace:${organization.id}:${workspaceName}`,
                    (id) =>
                      window.supahelp.createWorkspace({
                        context: snapshot.context,
                        organizationId: organization.id,
                        name: workspaceName,
                        requestId: id,
                      }),
                  ).then((result) => {
                    if (result) {
                      setWorkspaceName('');
                      model.setWorkspace(result.value.workspaceId);
                    }
                  });
                }}
                fields={
                  <input
                    aria-label="Workspace name"
                    className={field}
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    maxLength={100}
                    required
                  />
                }
                button={
                  <Button
                    kind="secondary"
                    type="submit"
                    disabled={busy || !editable || !workspaceName.trim()}
                  >
                    Create workspace
                  </Button>
                }
              />
            </Card>
          </Group>
          {workspace && (
            <Group label="Workspace membership">
              <Card>
                {model.workspaces.length > 1 && (
                  <Row title="Workspace">
                    <Choice
                      label="Workspace"
                      value={workspace.id}
                      onChange={model.setWorkspace}
                      options={model.workspaces}
                    />
                  </Row>
                )}
                {model.members.map((member) => {
                  const isOwner = member.account.id === organization.ownerId,
                    canChange =
                      admin && !isOwner && (owner || member.role !== 'admin');
                  return (
                    <Row
                      key={member.account.id}
                      title={person(
                        member.account.name || member.account.email,
                      )}
                      description={`${member.account.email}${isOwner ? ' · organization owner' : ''}`}
                    >
                      <Select
                        label={`${member.account.email} role`}
                        options={
                          owner
                            ? ['admin', 'member', 'viewer']
                            : ['member', 'viewer']
                        }
                        value={member.role}
                        disabled={busy || !editable || !canChange}
                        onChange={(value) =>
                          void act(
                            `role:${workspace.id}:${member.account.id}:${value}`,
                            (id) =>
                              window.supahelp.setWorkspaceRole({
                                context: snapshot.context,
                                workspaceId: workspace.id,
                                accountId: member.account.id,
                                role: value as WorkspaceRole,
                                requestId: id,
                              }),
                          )
                        }
                      />
                      {canChange && (
                        <Confirm
                          label="Remove"
                          detail="Workspace access stops; their organization seat stays assigned. Their unsynced work can be lost."
                          disabled={busy}
                          action={() =>
                            void act(
                              `remove:${workspace.id}:${member.account.id}`,
                              (id) =>
                                window.supahelp.removeWorkspaceMember({
                                  context: snapshot.context,
                                  workspaceId: workspace.id,
                                  accountId: member.account.id,
                                  requestId: id,
                                }),
                            )
                          }
                        />
                      )}
                    </Row>
                  );
                })}
                {admin && (
                  <FormRow
                    title="Invite a person"
                    description="Reserves a seat for 7 days. Existing seated members reuse their seat."
                    onSubmit={(event) => {
                      event.preventDefault();
                      void act(
                        `invite:${workspace.id}:${email}:${role}`,
                        (id) =>
                          window.supahelp.inviteWorkspaceMember({
                            context: snapshot.context,
                            workspaceId: workspace.id,
                            email,
                            role,
                            requestId: id,
                          }),
                      ).then((result) => {
                        if (result) setEmail('');
                      });
                    }}
                    fields={
                      <>
                        <input
                          aria-label="Invite email"
                          type="email"
                          placeholder="Teammate's email address"
                          className={field}
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          required
                          maxLength={254}
                        />
                        <Select
                          label="Invitation role"
                          options={
                            owner
                              ? ['admin', 'member', 'viewer']
                              : ['member', 'viewer']
                          }
                          value={role}
                          onChange={(value) => setRole(value as WorkspaceRole)}
                          disabled={busy || !editable}
                        />
                      </>
                    }
                    button={
                      <Button
                        type="submit"
                        disabled={busy || !editable || !email.trim()}
                      >
                        Invite
                      </Button>
                    }
                  />
                )}
              </Card>
            </Group>
          )}
          {admin && (
            <Group label="Invitations">
              <Card>
                {model.invitations.length ? (
                  model.invitations.map((invite) => (
                    <Row
                      key={invite.id}
                      title={invite.email}
                      description={`${invite.role} · ${invite.status} · email ${invite.delivery} · expires ${formatDateTime(invite.expiresAt)}`}
                    >
                      {invite.status === 'pending' && (
                        <>
                          <Button
                            kind="secondary"
                            disabled={busy || !editable}
                            onClick={() =>
                              void act(`resend:${invite.id}`, (id) =>
                                window.supahelp.resendWorkspaceInvitation({
                                  context: snapshot.context,
                                  invitationId: invite.id,
                                  requestId: id,
                                }),
                              )
                            }
                          >
                            Resend
                          </Button>
                          <Button
                            kind="ghost"
                            disabled={busy}
                            onClick={() =>
                              void act(`revoke:${invite.id}`, (id) =>
                                window.supahelp.revokeWorkspaceInvitation({
                                  context: snapshot.context,
                                  invitationId: invite.id,
                                  requestId: id,
                                }),
                              )
                            }
                          >
                            Revoke
                          </Button>
                        </>
                      )}
                    </Row>
                  ))
                ) : (
                  <Row title="No invitations" />
                )}
              </Card>
            </Group>
          )}
        </>
      )}
    </>
  );
}
