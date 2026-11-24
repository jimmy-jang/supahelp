import type { BrowserWindow, IpcMain } from 'electron';
import { parseOnboarding } from '../../../contracts/onboarding.ts';
import { isTrustedSender } from '../../ipc/trusted-sender.ts';
import { isCustomInstance } from '../../integrations/connection-providers.ts';
import { providerApiKey } from '../chat/validation.ts';
import { connectionSetup } from '../connections/service.ts';
import { linearAccess } from '../linear/validation.ts';
import { zendeskSetup } from '../zendesk/validation.ts';
import type { AccountService } from './service.ts';

const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Check the request details.');
  return value as Record<string, any>;
};
const string = (value: unknown, limit = 4096): string => {
  if (typeof value !== 'string' || !value || value.length > limit)
    throw Error('Check the request details.');
  return value;
};
const failure = (error: unknown) => ({
  ok: false as const,
  error:
    error instanceof Error
      ? error.message === 'case-context'
        ? 'The account or workspace changed. Try again.'
        : error.message
      : 'This operation could not be completed.',
});

export function registerAccountsIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | undefined,
  location: string,
  service: AccountService,
) {
  const handle = (name: string, run: (input: unknown) => unknown) =>
    ipc.handle(`accounts:${name}`, async (event, request) => {
      if (!isTrustedSender(event, getWindow()?.webContents, location))
        return failure(Error('This window cannot access accounts.'));
      try {
        let input: unknown;
        if (name !== 'get') {
          const envelope = object(request);
          const stamp = object(envelope.context),
            current = service.snapshot().context;
          if (
            stamp.generation !== current.generation ||
            stamp.accountId !== current.accountId
          )
            throw Error('The account or workspace changed. Try again.');
          if (
            !['sign-in', 'cancel-sign-in', 'sign-out', 'refresh'].includes(name)
          )
            service.assertCurrentContext(envelope.context);
          input = envelope.input;
        }
        return { ok: true, value: await run(input) };
      } catch (error) {
        return failure(error);
      }
    });
  handle('get', () => service.snapshot());
  handle('previous-work', () => service.previousWork());
  handle('recover-personal', () => service.recoverPersonal());
  handle('sign-in', () => service.signIn());
  handle('cancel-sign-in', () => service.cancelSignIn());
  handle('sign-out', () => service.signOut());
  handle('refresh', () => service.refresh());
  handle('rename-account', (input) =>
    service.renameAccount(string(object(input).name, 100)),
  );
  handle('select', (input) => service.select(object(input) as any));
  handle('save-onboarding', (input) =>
    service.saveOnboarding(parseOnboarding(object(input).answers)),
  );
  handle('complete-onboarding', () => service.completeOnboarding());
  handle('billing-view', (input) =>
    service.billingView(string(object(input).organizationId, 36)),
  );
  handle('billing-preview', (input) => {
    const v = object(input);
    if (
      !Number.isSafeInteger(v.capacity) ||
      v.capacity < 5 ||
      v.capacity > 10000
    )
      throw Error('Choose 5 to 10,000 seats.');
    return service.billingPreview(string(v.organizationId, 36), v.capacity);
  });
  handle('billing-change', (input) => {
    const v = object(input);
    if (
      !['trial', 'checkout', 'portal', 'capacity', 'resume', 'retry'].includes(
        v.action,
      )
    )
      throw Error('Invalid billing action.');
    return service.billingChange({
      organizationId: string(v.organizationId, 36),
      requestId: string(v.requestId, 36),
      action: v.action,
      capacity: v.capacity,
      previewId: v.previewId,
    });
  });
  handle('create-organization', (input) =>
    service.createOrganization(object(input) as any),
  );
  handle('create-workspace', (input) =>
    service.createWorkspace(object(input) as any),
  );
  handle('members', (input) =>
    service.getWorkspaceMembers(string(object(input).workspaceId, 36)),
  );
  handle('organization-members', (input) =>
    service.getOrganizationMembers(string(object(input).organizationId, 36)),
  );
  handle('invite', (input) =>
    service.inviteWorkspaceMember(object(input) as any),
  );
  handle('resend', (input) =>
    service.resendWorkspaceInvitation(object(input) as any),
  );
  handle('revoke', (input) =>
    service.revokeWorkspaceInvitation(object(input) as any),
  );
  handle('accept', (input) => {
    const v = object(input);
    return service.acceptWorkspaceInvitation(
      string(v.pendingId, 36),
      string(v.requestId, 36),
    );
  });
  handle('decline', (input) => {
    const v = object(input);
    return service.declineWorkspaceInvitation(
      string(v.pendingId, 36),
      string(v.requestId, 36),
    );
  });
  handle('set-role', (input) => service.setWorkspaceRole(object(input) as any));
  handle('remove-workspace-member', (input) =>
    service.removeWorkspaceMember(object(input) as any),
  );
  handle('rename-workspace', (input) =>
    service.renameWorkspace(object(input) as any),
  );
  handle('delete-workspace', (input) =>
    service.deleteWorkspace(object(input) as any),
  );
  handle('remove-organization-member', (input) =>
    service.removeOrganizationMember(object(input) as any),
  );
  handle('leave', (input) => service.leaveOrganization(object(input) as any));
  handle('rename-organization', (input) =>
    service.renameOrganization(object(input) as any),
  );
  handle('delete-organization', (input) => {
    const v = object(input);
    return service.deleteOrganization({
      organizationId: string(v.organizationId, 36),
      requestId: string(v.requestId, 36),
    });
  });
  handle('organization-icon', (input) => {
    const v = object(input);
    return service.setOrganizationIcon({
      organizationId: string(v.organizationId, 36),
      icon: v.icon === null ? null : string(v.icon, 12000),
    });
  });
  handle('transfer-owner', (input) =>
    service.transferOrganizationOwner(object(input) as any),
  );
  handle('export', (input) =>
    service.exportOrganization(string(object(input).organizationId, 36)),
  );
}

export function scopedFeatureIpc(
  ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | undefined,
  location: string,
  service: AccountService,
  activeModel: () => Promise<string>,
  connectionIds: Set<string>,
): Pick<IpcMain, 'handle'> {
  const chatRequests = new Set([
    'chat:list',
    'chat:remove',
    'chat:rename',
    'chat:send',
    'chat:stop',
    'chat:fileApproval',
    'chat:projects',
    'chat:choose-project',
    'chat:discard-attachments',
    'chat:attachments',
  ]);
  const reads = new Set([
    'chat:list',
    'cases:list',
    'playbooks:list',
    'linear:status',
    'zendesk:status',
    'connections:status',
    'models:settings',
    'claude:status',
  ]);
  const setup = new Set([
    'models:choose',
    'models:install',
    'claude:choose',
    'claude:install',
    'connections:guide',
  ]);
  const connectionSettings = new Set([
    'linear:connect',
    'linear:disconnect',
    'zendesk:connect',
    'zendesk:disconnect',
    'connections:connect',
    'connections:disconnect',
    'connections:remove',
    'connections:finish',
    'connections:guide',
    'connections:review-reads',
  ]);
  // These connection channels return their own result, not the catalog snapshot.
  const ownReply = new Set(['connections:api-spec', 'connections:test-read']);
  const connectingTools = new Set<string>();
  let modelAuthenticationBusy = false;
  const model = (value: unknown) => {
    if (value !== 'claude' && value !== 'chatgpt')
      throw Error('Choose a model provider.');
    return `model:${value}`;
  };
  const catalog = (input: unknown) => {
    const id = object(input).id;
    if (
      typeof id !== 'string' ||
      !(connectionIds.has(id) || isCustomInstance(id))
    )
      throw Error('Choose an available connection.');
    return `catalog:${id}`;
  };
  const capability = (channel: string, input: unknown) =>
    channel.startsWith('linear:')
      ? 'linear'
      : channel.startsWith('zendesk:')
        ? 'zendesk'
        : channel.startsWith('connections:')
          ? // The spec import is not about one saved connection.
            channel === 'connections:api-spec'
            ? undefined
            : catalog(input)
          : channel.startsWith('claude:')
            ? 'model:claude'
            : channel.startsWith('models:') && channel !== 'models:select'
              ? model(
                  channel === 'models:api-key' ? object(input).provider : input,
                )
              : undefined;
  return {
    handle(channel, listener) {
      ipc.handle(channel, async (event, ...args) => {
        if (!isTrustedSender(event, getWindow()?.webContents, location))
          return failure(Error('This window cannot access application data.'));
        const generation = service.generation();
        let pending: { cap: string; id: string } | undefined;
        let authenticatingModel = false;
        let connectingTool: string | undefined;
        try {
          if (reads.has(channel)) await service.settled();
          let input = args[0];
          let stamp = service.snapshot().context;
          const modelSettings =
            channel.startsWith('models:') || channel.startsWith('claude:');
          if (
            chatRequests.has(channel) ||
            (modelSettings && !reads.has(channel)) ||
            connectionSettings.has(channel)
          ) {
            const envelope = object(input);
            stamp = envelope.context;
            input = envelope.input;
          }
          service.assertCurrentContext(stamp);
          const guard = () => service.assertCurrentContext(stamp);
          const personal =
            service.snapshot().context.context.kind === 'personal';
          if (channel === 'chat:rename' || channel === 'chat:remove')
            service.assertCurrentContext(object(input).context);
          if (!reads.has(channel)) {
            if (
              !personal &&
              !modelSettings &&
              !connectionSettings.has(channel) &&
              // Spec import and Test access only read, and work in any workspace like the other connection settings.
              !ownReply.has(channel) &&
              // Approvals on the account's own connections; ownership is checked below.
              ![
                'linear:decide',
                'zendesk:decide',
                'connections:decide',
              ].includes(channel) &&
              // Chats are personal and never sync, so they work in any workspace.
              !chatRequests.has(channel) &&
              // Chat document actions; playbooks/ipc.ts decides which work in a team.
              !channel.startsWith('chat:') &&
              !channel.startsWith('cases:') &&
              !channel.startsWith('playbooks:') &&
              !channel.startsWith('sync:')
            )
              throw Error('Switch to Personal to continue.');
            if (
              channel === 'models:connect' ||
              channel === 'models:api-key' ||
              channel === 'models:disconnect' ||
              channel === 'claude:sign-in'
            ) {
              if (modelAuthenticationBusy)
                throw Error(
                  'A model connection is already being updated. Try again.',
                );
              authenticatingModel = modelAuthenticationBusy = true;
            }
            if (
              [
                'models:connect',
                'models:api-key',
                'claude:sign-in',
                'linear:connect',
                'zendesk:connect',
                'connections:connect',
              ].includes(channel)
            ) {
              if (channel === 'linear:connect') linearAccess(input);
              if (channel === 'models:api-key') providerApiKey(input);
              if (channel === 'zendesk:connect') zendeskSetup(input);
              if (channel === 'connections:connect') connectionSetup(input);
              const cap = capability(channel, input)!;
              if (connectionSettings.has(channel)) {
                if (connectingTools.has(cap))
                  throw Error('This connection is already being updated.');
                connectingTools.add(cap);
                connectingTool = cap;
              }
              pending = { cap, id: await service.beginConnection(cap) };
            } else if (channel === 'chat:send') {
              const provider =
                object(input).options?.selection?.provider ??
                (await activeModel());
              if (!(await service.canUse(model(provider))))
                throw Error(
                  'Connect this model provider for the current account.',
                );
            } else if (!setup.has(channel)) {
              const cap = capability(channel, input);
              if (
                cap &&
                !(await service.canManageConnection(
                  cap,
                  channel.endsWith(':disconnect') ||
                    channel === 'connections:finish',
                ))
              )
                throw Error('Connect this tool for the current account.');
            }
          }
          if (generation !== service.generation())
            throw Error('The account or workspace changed. Try again.');
          guard();
          const authentication = connectionSettings.has(channel)
            ? service.authenticationGeneration()
            : undefined;
          const reply = await listener(
            event,
            input,
            authentication === undefined
              ? guard
              : () => {
                  if (authentication !== service.authenticationGeneration())
                    throw Error('The account changed. Try again.');
                },
          );
          const connection = pending;
          pending = undefined;
          if (connection)
            service.finishConnection(
              connection.cap,
              connection.id,
              Boolean(reply?.ok),
            );
          if (generation !== service.generation())
            throw Error('The account or workspace changed. Try again.');
          if (
            reply?.ok &&
            reply.value &&
            typeof reply.value === 'object' &&
            !Array.isArray(reply.value)
          ) {
            const mapped = channel.startsWith('models:')
              ? 'models:settings'
              : channel.startsWith('claude:')
                ? 'claude:status'
                : channel.startsWith('linear:')
                  ? 'linear:changed'
                  : channel.startsWith('zendesk:')
                    ? 'zendesk:changed'
                    : channel.startsWith('connections:') &&
                        !ownReply.has(channel)
                      ? 'connections:changed'
                      : reads.has(channel)
                        ? channel
                        : undefined;
            if (mapped) {
              const value = await service.scopeSnapshot(mapped, reply.value);
              if (connection && mapped.endsWith(':changed'))
                getWindow()?.webContents.send(mapped, value);
              return { ...reply, value };
            }
          }
          return reply;
        } catch (error) {
          if (pending) service.finishConnection(pending.cap, pending.id, false);
          return failure(error);
        } finally {
          if (authenticatingModel) modelAuthenticationBusy = false;
          if (connectingTool) connectingTools.delete(connectingTool);
        }
      });
    },
  };
}
