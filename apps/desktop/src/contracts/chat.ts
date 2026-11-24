import type {
  AccountSnapshot,
  ActiveContext,
  ContextStamp,
  InvitationView,
  MemberView,
  Scoped,
  WorkspaceRole,
} from './accounts.ts';
import type {
  CaseEditRequest,
  CaseSnapshot,
  CaseUpdate,
  CustomerDirectory,
} from './cases.ts';
import type {
  ApiSpecPreview,
  ApiSpecRequest,
  CatalogSetup,
  CatalogSnapshot,
} from './catalog.ts';
import type { LinearAccess, LinearSnapshot } from './linear.ts';
import type { ZendeskSetup, ZendeskSnapshot } from './zendesk.ts';
export type ClaudeModel = 'default' | 'sonnet' | 'opus' | 'haiku';

export type ClaudeStatus = {
  state:
    | 'ready'
    | 'missing'
    | 'signed-out'
    | 'unsupported'
    | 'error'
    | 'disconnected';
  message: string;
  model: ClaudeModel;
  executable?: string;
  version?: string;
  email?: string;
  plan?: string;
};

export type ProviderId = 'claude' | 'chatgpt';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ModelSelection = { provider: ProviderId; model: string };
export type ChatOptions = {
  selection?: ModelSelection;
  effort?: Effort;
  confirmation?: 'ask' | 'skip';
  project?: string;
};
export type Attachment = { id: string; name: string; size: number };
export type ChatFile = Attachment & { mime: string; data: string };
export type Project = { path: string; name: string };
export type ProviderStatus = {
  id: ProviderId;
  authentication?: 'subscription' | 'api-key' | 'disconnected';
  state: ClaudeStatus['state'];
  message: string;
  email?: string;
  plan?: string;
  executable?: string;
  version?: string;
};
export type ModelsSettings = {
  providers: ProviderStatus[];
  models: (ModelSelection & { label: string; efforts?: Effort[] })[];
  selected: ModelSelection;
};

export type ChatMessage =
  | { role: 'user' | 'assistant'; text: string }
  | (CaseUpdate & { role: 'case'; note?: string });
/** A project file change the model is waiting for the user to approve. */
export type FileApproval = {
  requestId: string;
  tool: 'Edit' | 'Write';
  /** Relative to the selected project folder. */
  path: string;
  /** Edit: the text being replaced. Truncated for display. */
  before?: string;
  /** Edit: the replacement. Write: the new file contents. Truncated for display. */
  after: string;
};
export type Conversation = {
  fileApproval?: FileApproval;
  resolutionReview?: { id: string; version: number };
  playbookIds?: string[];
  playbookFocusId?: string;
  playbookAction?: import('./playbooks.ts').PlaybookChatAction;
  /** Team workspaces: the shared case this local chat works on. */
  teamCaseId?: string;
  /** Set on the one chat that belongs to this Playbook. */
  playbookId?: string;
  id: string;
  title: string;
  messages: ChatMessage[];
  status: 'idle' | 'running' | 'stopping';
  /** The connected tool the running reply is calling now; cleared when text arrives or the turn ends. */
  step?: { server: string; tool: string };
  model: string;
  options?: ChatOptions;
  error?: string;
  notice?: string;
};

export type ChatSnapshot = { revision: number; chats: Conversation[] };
export type SendMessage = {
  chatId?: string;
  text: string;
  options?: ChatOptions;
  attachments?: string[];
};
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

export type SupahelpApi = import('./sync.ts').SyncApi &
  import('./sync.ts').CollaborationApi &
  import('./playbooks.ts').DocumentApi &
  import('./pilot-metrics.ts').PilotMetricsApi &
  import('./updates.ts').UpdatesApi & {
    onCloseRequested(listener: (id: string) => void): () => void;
    respondToClose(id: string, accepted: boolean): void;
    getQuickTour(): Promise<Reply<{ seen: boolean }>>;
    completeQuickTour(): Promise<Reply<{ seen: boolean }>>;
    getAccount(): Promise<Reply<AccountSnapshot>>;
    getPreviousWork(): Promise<Reply<{ available: boolean }>>;
    recoverPersonalWork(): Promise<Reply<void>>;
    signInAccount(): Promise<Reply<void>>;
    cancelAccountSignIn(): Promise<Reply<void>>;
    signOutAccount(): Promise<Reply<void>>;
    refreshAccount(): Promise<Reply<void>>;
    getBilling(
      organizationId: string,
      context?: ContextStamp,
    ): Promise<Reply<import('./accounts.ts').BillingView>>;
    previewBillingCapacity(
      organizationId: string,
      capacity: number,
      context?: ContextStamp,
    ): Promise<Reply<import('./accounts.ts').BillingPreview>>;
    changeBilling(
      input: import('./accounts.ts').BillingRequest & {
        context?: ContextStamp;
      },
    ): Promise<Reply<{ opened: boolean }>>;
    selectWorkspace(
      context: ActiveContext,
      stamp?: ContextStamp,
    ): Promise<Reply<void>>;
    completeOnboarding(): Promise<Reply<{ completed: true }>>;
    saveOnboarding(
      answers: import('./onboarding.ts').OnboardingAnswers,
    ): Promise<
      Reply<{ onboarding: import('./onboarding.ts').OnboardingAnswers }>
    >;
    createOrganization(input: {
      name: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<{ organizationId: string; workspaceId: string }>>;
    createWorkspace(input: {
      organizationId: string;
      name: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<{ workspaceId: string }>>;
    getWorkspaceMembers(
      workspaceId: string,
      context?: ContextStamp,
    ): Promise<Reply<{ members: MemberView[]; invitations: InvitationView[] }>>;
    getOrganizationMembers(
      organizationId: string,
      context?: ContextStamp,
    ): Promise<
      Reply<
        {
          account: import('./accounts.ts').PublicAccount;
          seated: boolean;
          workspaceCount: number;
        }[]
      >
    >;
    inviteWorkspaceMember(input: {
      workspaceId: string;
      email: string;
      role: WorkspaceRole;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<InvitationView>>;
    resendWorkspaceInvitation(input: {
      invitationId: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<InvitationView>>;
    revokeWorkspaceInvitation(input: {
      invitationId: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<void>>;
    acceptWorkspaceInvitation(
      pendingId: string,
      requestId: string,
    ): Promise<Reply<{ organizationId: string; workspaceId: string }>>;
    declineWorkspaceInvitation(
      pendingId: string,
      requestId: string,
    ): Promise<Reply<void>>;
    setWorkspaceRole(input: {
      workspaceId: string;
      accountId: string;
      role: WorkspaceRole;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<void>>;
    renameWorkspace(input: {
      workspaceId: string;
      name: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<{ workspaceId: string; name: string }>>;
    deleteWorkspace(input: {
      workspaceId: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<void>>;
    removeWorkspaceMember(input: {
      workspaceId: string;
      accountId: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<void>>;
    removeOrganizationMember(input: {
      organizationId: string;
      accountId: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<void>>;
    leaveOrganization(input: {
      organizationId: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<void>>;
    deleteOrganization(input: {
      organizationId: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<void>>;
    renameAccount(name: string): Promise<Reply<{ name: string }>>;
    setOrganizationIcon(input: {
      organizationId: string;
      icon: string | null;
      context?: ContextStamp;
    }): Promise<Reply<void>>;
    renameOrganization(input: {
      organizationId: string;
      name: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<{ organizationId: string; name: string }>>;
    transferOrganizationOwner(input: {
      organizationId: string;
      accountId: string;
      requestId: string;
      context?: ContextStamp;
    }): Promise<Reply<void>>;
    exportOrganization(
      organizationId: string,
      context?: ContextStamp,
    ): Promise<Reply<{ saved: boolean }>>;
    onAccountChanged(listener: (snapshot: AccountSnapshot) => void): () => void;
    getConnections(): Promise<Reply<Scoped<CatalogSnapshot>>>;
    openConnectionGuide(id: string): Promise<Reply<void>>;
    previewApiSpec(request: ApiSpecRequest): Promise<Reply<ApiSpecPreview>>;
    testConnectionRead(
      id: string,
      tool: string,
      args: Record<string, unknown>,
    ): Promise<Reply<{ preview: string }>>;
    connectConnection(setup: CatalogSetup): Promise<Reply<CatalogSnapshot>>;
    disconnectConnection(id: string): Promise<Reply<void>>;
    removeConnection(id: string): Promise<Reply<void>>;
    finishConnectionSignIn(id: string, url: string): Promise<Reply<void>>;
    reviewConnectionReads(
      id: string,
      tools: { name: string; fingerprint: string }[],
    ): Promise<Reply<void>>;
    decideConnectionAction(
      id: string,
      action: string,
      decision: 'approve' | 'deny' | 'checked',
    ): Promise<Reply<void>>;
    onConnectionsChanged(
      listener: (snapshot: Scoped<CatalogSnapshot>) => void,
    ): () => void;
    getZendesk(): Promise<Reply<Scoped<ZendeskSnapshot>>>;
    connectZendesk(setup: ZendeskSetup): Promise<Reply<ZendeskSnapshot>>;
    disconnectZendesk(): Promise<Reply<void>>;
    decideZendeskAction(
      id: string,
      decision: 'approve' | 'deny' | 'checked',
    ): Promise<Reply<void>>;
    onZendeskChanged(
      listener: (snapshot: Scoped<ZendeskSnapshot>) => void,
    ): () => void;
    getLinear(): Promise<Reply<Scoped<LinearSnapshot>>>;
    connectLinear(access: LinearAccess): Promise<Reply<LinearSnapshot>>;
    disconnectLinear(): Promise<Reply<void>>;
    decideLinearAction(
      id: string,
      decision: 'approve' | 'deny' | 'checked',
    ): Promise<Reply<void>>;
    onLinearChanged(
      listener: (snapshot: Scoped<LinearSnapshot>) => void,
    ): () => void;
    getProjects(context?: ContextStamp): Promise<Reply<Project[]>>;
    chooseProject(context?: ContextStamp): Promise<Reply<Project | undefined>>;
    discardAttachments(
      ids: string[],
      context?: ContextStamp,
    ): Promise<Reply<void>>;
    chooseAttachments(context?: ContextStamp): Promise<Reply<Attachment[]>>;
    getModelsSettings(): Promise<Reply<Scoped<ModelsSettings>>>;
    connectProvider(provider: ProviderId): Promise<Reply<void>>;
    setProviderApiKey(provider: ProviderId, key: string): Promise<Reply<void>>;
    disconnectProvider(provider: ProviderId): Promise<Reply<void>>;
    chooseProviderExecutable(provider: ProviderId): Promise<Reply<void>>;
    openProviderInstall(provider: ProviderId): Promise<Reply<void>>;
    setDefaultModel(selection: ModelSelection): Promise<Reply<void>>;
    getClaudeStatus(): Promise<Reply<ClaudeStatus>>;
    openClaudeSignIn(): Promise<Reply<void>>;
    openClaudeInstall(): Promise<Reply<void>>;
    chooseClaudeExecutable(): Promise<Reply<ClaudeStatus>>;
    setClaudeModel(model: ClaudeModel): Promise<Reply<ClaudeStatus>>;
    getChats(context?: ContextStamp): Promise<Reply<Scoped<ChatSnapshot>>>;
    removeChat(input: {
      chatId: string;
      context: ContextStamp;
    }): Promise<Reply<void>>;
    removeCase(input: {
      caseId: string;
      context: ContextStamp;
    }): Promise<Reply<void>>;
    setCaseStatus(input: {
      caseId: string;
      status: import('./cases.ts').CaseStatus;
      context: ContextStamp;
    }): Promise<Reply<void>>;
    renameChat(
      input: import('./titles.ts').TitleEdit & {
        chatId: string;
        context: ContextStamp;
      },
    ): Promise<Reply<string>>;
    renameCase(
      input: import('./titles.ts').TitleEdit & {
        caseId: string;
        context: ContextStamp;
      },
    ): Promise<Reply<string>>;
    sendMessage(
      message: SendMessage,
      context?: ContextStamp,
    ): Promise<Reply<string>>;
    stopReply(chatId: string, context?: ContextStamp): Promise<Reply<void>>;
    answerFileApproval(
      input: { chatId: string; requestId: string; approved: boolean },
      context?: ContextStamp,
    ): Promise<Reply<void>>;
    onChatsChanged(
      listener: (snapshot: Scoped<ChatSnapshot>) => void,
    ): () => void;
    getCases(context: ContextStamp): Promise<Reply<Scoped<CaseSnapshot>>>;
    getCustomers(context: ContextStamp): Promise<Reply<CustomerDirectory>>;
    getCasePeople(input: {
      context: ContextStamp;
    }): Promise<Reply<import('./cases.ts').CasePerson[]>>;
    assignCase(
      input: import('./cases.ts').CaseAssignment,
    ): Promise<Reply<import('./cases.ts').CaseRecord>>;
    editCaseEntry(
      input: CaseEditRequest,
    ): Promise<Reply<CaseUpdate & { version: number }>>;
    cancelCaseEdit(input: {
      context: ContextStamp;
      requestId: string;
    }): Promise<Reply<void>>;
    // Returns the new (or already linked) case id.
    createCase(input: {
      chatId: string;
      context: ContextStamp;
    }): Promise<Reply<string>>;
    undoCaseChange(input: {
      caseId: string;
      changeId: string;
      context: ContextStamp;
    }): Promise<Reply<void>>;
    getCaseMarkdown(input: {
      caseId: string;
      context: ContextStamp;
    }): Promise<Reply<string>>;
    onCasesChanged(
      listener: (snapshot: Scoped<CaseSnapshot>) => void,
    ): () => void;
  };
