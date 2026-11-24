import type {
  CollaborateCase,
  CollaborationSnapshot,
  NotificationPreferences,
} from '@supahelp/contracts/sync';
import type { EntryValue } from './cases.ts';
import type { PlaybookContent } from './playbooks.ts';
export type {
  AnswerCandidate,
  CaseNotification,
  CollaborateCase,
  CollaborationSnapshot,
  NotificationCategory,
  NotificationPreferences,
  SyncDocument,
  SyncLease,
  SyncOperation,
  SyncPage,
  SyncReceipt,
} from '@supahelp/contracts/sync';
export type SyncStatus = {
  state:
    | 'disabled'
    | 'checking'
    | 'synced'
    | 'offline'
    | 'read-only'
    | 'locked'
    | 'revoked'
    | 'error';
  pending: number;
  hidden?: string[];
  review?: {
    id: string;
    documentId: string;
    title?: string;
    value?: EntryValue;
    content?: PlaybookContent;
  }[];
  warning?: string;
};

export type SyncApi = {
  flagSharedDocument(input: {
    context: import('./accounts.ts').ContextStamp;
    id: string;
  }): Promise<import('./chat.ts').Reply<SyncStatus>>;
  correctSharedDocument(input: {
    context: import('./accounts.ts').ContextStamp;
    id: string;
    title: string;
    text: string;
  }): Promise<import('./chat.ts').Reply<SyncStatus>>;
  getSync(
    context: import('./accounts.ts').ContextStamp,
  ): Promise<import('./chat.ts').Reply<SyncStatus>>;
  syncNow(
    context: import('./accounts.ts').ContextStamp,
  ): Promise<import('./chat.ts').Reply<SyncStatus>>;
  createTeamCase(
    context: import('./accounts.ts').ContextStamp,
  ): Promise<import('./chat.ts').Reply<string>>;
};
export type CollaborationApi = {
  openCaseLink(input: {
    context: import('./accounts.ts').ContextStamp;
    id: string;
  }): Promise<import('./chat.ts').Reply<void>>;
  getCollaboration(input: {
    context: import('./accounts.ts').ContextStamp;
  }): Promise<import('./chat.ts').Reply<CollaborationSnapshot>>;
  collaborateCase(
    input: CollaborateCase & { context: import('./accounts.ts').ContextStamp },
  ): Promise<import('./chat.ts').Reply<CollaborationSnapshot>>;
  answerCaseQuestion(input: {
    context: import('./accounts.ts').ContextStamp;
    id: string;
    caseId: string;
    entryId: string;
    base: number;
    text: string;
  }): Promise<import('./chat.ts').Reply<CollaborationSnapshot>>;
  checkCaseAnswer(input: {
    context: import('./accounts.ts').ContextStamp;
    id: string;
  }): Promise<import('./chat.ts').Reply<CollaborationSnapshot>>;
  cancelCaseAnswer(input: {
    context: import('./accounts.ts').ContextStamp;
    id: string;
  }): Promise<import('./chat.ts').Reply<CollaborationSnapshot>>;
  readCaseNotification(input: {
    context: import('./accounts.ts').ContextStamp;
    id: string;
  }): Promise<import('./chat.ts').Reply<CollaborationSnapshot>>;
  setNotificationPreferences(input: {
    context: import('./accounts.ts').ContextStamp;
    preferences: NotificationPreferences;
  }): Promise<import('./chat.ts').Reply<CollaborationSnapshot>>;
  notificationBannerSettings(input: {
    context: import('./accounts.ts').ContextStamp;
    value?: { enabled: boolean; hideDetails: boolean };
  }): Promise<
    import('./chat.ts').Reply<{ enabled: boolean; hideDetails: boolean }>
  >;
  resolveCaseLink(input: {
    context: import('./accounts.ts').ContextStamp;
    id: string;
  }): Promise<
    import('./chat.ts').Reply<{ workspaceId: string; caseId: string }>
  >;
  clearCaseLink(input: {
    context: import('./accounts.ts').ContextStamp;
    id: string;
  }): Promise<import('./chat.ts').Reply<void>>;
};

export const notificationDefaults: NotificationPreferences = {
  approval: true,
  failure: true,
  question: true,
  'brought-in': true,
  'handed-off': true,
  'playbook-published': true,
  'playbook-updated': true,
};
