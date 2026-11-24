import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountSnapshot,
  ContextStamp,
  Scoped,
} from '../contracts/accounts';
import type { CaseSnapshot } from '../contracts/cases';
import type { CatalogSnapshot } from '../contracts/catalog';
import type { ChatSnapshot, SupahelpApi } from '../contracts/chat';
import type { LinearSnapshot } from '../contracts/linear';
import type { ZendeskSnapshot } from '../contracts/zendesk';

let account: AccountSnapshot | undefined;
const remember = (next: AccountSnapshot) => {
  if (
    !account ||
    next.context.generation > account.context.generation ||
    (next.context.generation === account.context.generation &&
      next.revision > account.revision)
  )
    account = next;
};
const accountWaiters = new Set<() => void>();
ipcRenderer.on('accounts:changed', (_event, next: AccountSnapshot) => {
  remember(next);
  for (const wake of accountWaiters) wake();
});
const stampOf = (payload: unknown): ContextStamp | undefined => {
  const p = payload as { context?: ContextStamp } | undefined;
  return p && typeof p === 'object' ? p.context : undefined;
};
// Main rejects calls made while an account change (sign-in) is still
// settling, even when the stamp is the one that ends up current. Wait for the
// next snapshot and retry once; a changed stamp is left to the renderer, which
// already drops replies for contexts that are no longer current.
const call = async (channel: string, payload?: unknown): Promise<any> => {
  const reply = await ipcRenderer.invoke(channel, payload);
  const stamp = stampOf(payload);
  if (
    reply?.ok !== false ||
    typeof reply.error !== 'string' ||
    !reply.error.startsWith('The account or workspace changed') ||
    !stamp ||
    account?.context.generation !== stamp.generation
  )
    return reply;
  await new Promise<void>((resolve) => {
    const wake = () => {
      accountWaiters.delete(wake);
      resolve();
    };
    accountWaiters.add(wake);
  });
  return account?.context.generation === stamp.generation
    ? ipcRenderer.invoke(channel, payload)
    : reply;
};
const invoke = (channel: string, input?: unknown, supplied?: ContextStamp) => {
  const embedded =
    input && typeof input === 'object' && 'context' in input
      ? (input.context as ContextStamp)
      : undefined;
  const context: ContextStamp | undefined =
    supplied ?? embedded ?? account?.context;
  return call(channel, { context, input });
};

const api: SupahelpApi = {
  openCaseLink: (input) => call('sync:open-link', input),
  getCollaboration: (input) => call('sync:collaboration', input),
  collaborateCase: (input) => call('sync:collaborate', input),
  answerCaseQuestion: (input) => call('sync:answer', input),
  checkCaseAnswer: (input) => call('sync:check-answer', input),
  cancelCaseAnswer: (input) => call('sync:cancel-answer', input),
  readCaseNotification: (input) => call('sync:read-notification', input),
  setNotificationPreferences: (input) => call('sync:preferences', input),
  notificationBannerSettings: (input) => call('sync:banner-settings', input),
  resolveCaseLink: (input) => call('sync:resolve-link', input),
  clearCaseLink: (input) => call('sync:clear-link', input),
  getCasePeople: (input) => call('cases:people', input),
  assignCase: (input) => call('cases:assign', input),
  flagSharedDocument: (input) => call('sync:flag', input),
  correctSharedDocument: (input) => call('sync:correct', input),
  getSync: (context) => call('sync:status', { context }),
  syncNow: (context) => call('sync:now', { context }),
  createTeamCase: (context) => call('sync:create-case', { context }),
  onCloseRequested: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, id: string) =>
      listener(id);
    ipcRenderer.on('window:close-requested', receive);
    return () => ipcRenderer.removeListener('window:close-requested', receive);
  },
  respondToClose: (id, accepted) =>
    ipcRenderer.send('window:close-response', { id, accepted }),
  getPilotMetrics: (input) => call('pilot-metrics:get', input),
  startPilotMetrics: (input) => call('pilot-metrics:start', input),
  finishPilotMetrics: (input) => call('pilot-metrics:finish', input),
  exportPilotMetrics: (input) => call('pilot-metrics:export', input),
  deletePilotMetrics: (input) => call('pilot-metrics:delete', input),
  cancelDocumentWork: (input) => call('playbooks:cancel', input),
  getPlaybooks: (input) => call('playbooks:list', input),
  searchDocuments: (input) => call('playbooks:search', input),
  exportPlaybook: (input) => call('playbooks:export', input),
  openPlaybookLink: (input) => call('playbooks:openLink', input),
  savePlaybookDraft: (input) => call('playbooks:saveDraft', input),
  publishPlaybook: (input) => call('playbooks:publish', input),
  removePlaybook: (input) => call('playbooks:remove', input),
  discardPlaybookDraft: (input) => call('playbooks:discardDraft', input),
  choosePlaybookScreenshot: (input) =>
    call('playbooks:chooseScreenshot', input),
  confirmPlaybookScreenshot: (input) =>
    call('playbooks:confirmScreenshot', input),
  getPlaybookScreenshot: (input) => call('playbooks:screenshot', input),
  removePlaybookScreenshot: (input) =>
    call('playbooks:removeScreenshot', input),
  setChatPlaybooks: (input) => call('chat:setPlaybooks', input),
  attachCase: (input) => call('chat:attachCase', input),
  detachCase: (input) => call('chat:detachCase', input),
  createChat: (input) => call('chat:create', input),
  resumeCase: (input) => call('cases:resume', input),
  resumePlaybook: (input) => call('playbooks:resumeChat', input),
  runPlaybookChatAction: (input) => call('chat:playbookAction', input),
  draftResolution: (input) => call('cases:draftResolution', input),
  confirmResolve: (input) => call('cases:confirmResolve', input),
  reopenCase: (input) => call('cases:reopen', input),
  draftCasePlaybook: (input) => call('cases:draftPlaybook', input),
  proposeResolutionNote: (input) => call('cases:proposeResolutionNote', input),
  onPlaybooksChanged: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      snapshot: import('../contracts/accounts').Scoped<
        import('../contracts/playbooks').PlaybookSnapshot
      >,
    ) => listener(snapshot);
    ipcRenderer.on('playbooks:changed', receive);
    return () => ipcRenderer.removeListener('playbooks:changed', receive);
  },

  getAccount: async () => {
    const reply = await call('accounts:get');
    if (reply.ok) remember(reply.value);
    return reply;
  },
  getUpdateState: () => ipcRenderer.invoke('app:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('app:update-check'),
  installUpdate: () => ipcRenderer.invoke('app:update-install'),
  onUpdateState: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      state: import('../contracts/updates').UpdateState,
    ) => listener(state);
    ipcRenderer.on('app:update-state-changed', receive);
    return () =>
      ipcRenderer.removeListener('app:update-state-changed', receive);
  },
  getPreviousWork: () => invoke('accounts:previous-work'),
  recoverPersonalWork: () => invoke('accounts:recover-personal'),
  signInAccount: () => invoke('accounts:sign-in'),
  cancelAccountSignIn: () => invoke('accounts:cancel-sign-in'),
  signOutAccount: () => invoke('accounts:sign-out'),
  refreshAccount: () => invoke('accounts:refresh'),
  renameAccount: (name) => invoke('accounts:rename-account', { name }),
  getBilling: (organizationId, context) =>
    invoke('accounts:billing-view', { organizationId }, context),
  previewBillingCapacity: (organizationId, capacity, context) =>
    invoke(
      'accounts:billing-preview',
      {
        organizationId,
        capacity,
      },
      context,
    ),
  changeBilling: (input) => invoke('accounts:billing-change', input),
  selectWorkspace: (context, stamp) =>
    invoke('accounts:select', context, stamp),
  completeOnboarding: () => invoke('accounts:complete-onboarding'),
  saveOnboarding: (answers) => invoke('accounts:save-onboarding', { answers }),
  createOrganization: (input) => invoke('accounts:create-organization', input),
  createWorkspace: (input) => invoke('accounts:create-workspace', input),
  getWorkspaceMembers: (workspaceId, context) =>
    invoke('accounts:members', { workspaceId }, context),
  inviteWorkspaceMember: (input) => invoke('accounts:invite', input),
  resendWorkspaceInvitation: (input) => invoke('accounts:resend', input),
  revokeWorkspaceInvitation: (input) => invoke('accounts:revoke', input),
  getOrganizationMembers: (organizationId, context) =>
    invoke('accounts:organization-members', { organizationId }, context),
  acceptWorkspaceInvitation: (pendingId, requestId) =>
    invoke('accounts:accept', { pendingId, requestId }),
  declineWorkspaceInvitation: (pendingId, requestId) =>
    invoke('accounts:decline', { pendingId, requestId }),
  setWorkspaceRole: (input) => invoke('accounts:set-role', input),
  renameWorkspace: (input) => invoke('accounts:rename-workspace', input),
  deleteWorkspace: (input) => invoke('accounts:delete-workspace', input),
  removeWorkspaceMember: (input) =>
    invoke('accounts:remove-workspace-member', input),
  removeOrganizationMember: (input) =>
    invoke('accounts:remove-organization-member', input),
  leaveOrganization: (input) => invoke('accounts:leave', input),
  renameOrganization: (input) => invoke('accounts:rename-organization', input),
  deleteOrganization: (input) => invoke('accounts:delete-organization', input),
  setOrganizationIcon: (input) => invoke('accounts:organization-icon', input),
  transferOrganizationOwner: (input) =>
    invoke('accounts:transfer-owner', input),
  exportOrganization: (organizationId, context) =>
    invoke('accounts:export', { organizationId }, context),
  onAccountChanged: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      snapshot: AccountSnapshot,
    ) => listener(snapshot);
    ipcRenderer.on('accounts:changed', receive);
    return () => ipcRenderer.removeListener('accounts:changed', receive);
  },
  getConnections: () => call('connections:status'),
  openConnectionGuide: (id) => invoke('connections:guide', { id }),
  previewApiSpec: (request) => call('connections:api-spec', request),
  testConnectionRead: (id, tool, args) =>
    call('connections:test-read', { id, tool, args }),
  connectConnection: (setup) => invoke('connections:connect', setup),
  disconnectConnection: (id) => invoke('connections:disconnect', { id }),
  removeConnection: (id) => invoke('connections:remove', { id }),
  finishConnectionSignIn: (id, url) =>
    invoke('connections:finish', { id, url }),
  reviewConnectionReads: (id, tools) =>
    invoke('connections:review-reads', { id, tools }),
  decideConnectionAction: (id, action, decision) =>
    call('connections:decide', { id, action, decision }),
  onConnectionsChanged: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      snapshot: Scoped<CatalogSnapshot>,
    ) => listener(snapshot);
    ipcRenderer.on('connections:changed', receive);
    return () => ipcRenderer.removeListener('connections:changed', receive);
  },
  getZendesk: () => call('zendesk:status'),
  connectZendesk: (setup) => invoke('zendesk:connect', setup),
  disconnectZendesk: () => invoke('zendesk:disconnect'),
  decideZendeskAction: (id, decision) =>
    call('zendesk:decide', { id, decision }),
  onZendeskChanged: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      snapshot: Scoped<ZendeskSnapshot>,
    ) => listener(snapshot);
    ipcRenderer.on('zendesk:changed', receive);
    return () => ipcRenderer.removeListener('zendesk:changed', receive);
  },
  getLinear: () => call('linear:status'),
  connectLinear: (access) => invoke('linear:connect', access),
  disconnectLinear: () => invoke('linear:disconnect'),
  decideLinearAction: (id, decision) => call('linear:decide', { id, decision }),
  onLinearChanged: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      snapshot: Scoped<LinearSnapshot>,
    ) => listener(snapshot);
    ipcRenderer.on('linear:changed', receive);
    return () => ipcRenderer.removeListener('linear:changed', receive);
  },
  getProjects: (context) => invoke('chat:projects', undefined, context),
  chooseProject: (context) => invoke('chat:choose-project', undefined, context),
  discardAttachments: (ids, context) =>
    invoke('chat:discard-attachments', ids, context),
  chooseAttachments: (context) =>
    invoke('chat:attachments', undefined, context),
  getQuickTour: () => ipcRenderer.invoke('quick-tour:get'),
  completeQuickTour: () => ipcRenderer.invoke('quick-tour:complete'),
  getModelsSettings: () => call('models:settings'),
  connectProvider: (provider) => invoke('models:connect', provider),
  setProviderApiKey: (provider, key) =>
    invoke('models:api-key', { provider, key }),
  disconnectProvider: (provider) => invoke('models:disconnect', provider),
  chooseProviderExecutable: (provider) => invoke('models:choose', provider),
  openProviderInstall: (provider) => invoke('models:install', provider),
  setDefaultModel: (selection) => invoke('models:select', selection),
  getClaudeStatus: () => call('claude:status'),
  openClaudeSignIn: () => invoke('claude:sign-in'),
  openClaudeInstall: () => invoke('claude:install'),
  chooseClaudeExecutable: () => invoke('claude:choose'),
  setClaudeModel: (model) => invoke('claude:model', model),
  getChats: (context) => invoke('chat:list', undefined, context),
  removeChat: (input) => invoke('chat:remove', input),
  removeCase: (input) => call('cases:remove', input),
  setCaseStatus: (input) => call('cases:status', input),
  renameChat: (input) => invoke('chat:rename', input),
  renameCase: (input) => call('cases:rename', input),
  sendMessage: (message, context) => invoke('chat:send', message, context),
  stopReply: (id, context) => invoke('chat:stop', id, context),
  answerFileApproval: (input, context) =>
    invoke('chat:fileApproval', input, context),
  onChatsChanged: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      snapshot: Scoped<ChatSnapshot>,
    ) => listener(snapshot);
    ipcRenderer.on('chat:changed', receive);
    return () => ipcRenderer.removeListener('chat:changed', receive);
  },
  getCases: (context) => call('cases:list', { context }),
  getCustomers: (context) => call('cases:customers:list', { context }),
  editCaseEntry: (input) => call('cases:edit', input),
  cancelCaseEdit: (input) => call('cases:cancelEdit', input),
  createCase: (input) => call('cases:create', input),
  undoCaseChange: (input) => call('cases:undo', input),
  getCaseMarkdown: (input) => call('cases:markdown', input),
  onCasesChanged: (listener) => {
    const receive = (
      _event: Electron.IpcRendererEvent,
      snapshot: Scoped<CaseSnapshot>,
    ) => listener(snapshot);
    ipcRenderer.on('cases:changed', receive);
    return () => ipcRenderer.removeListener('cases:changed', receive);
  },
};

contextBridge.exposeInMainWorld('supahelp', api);
