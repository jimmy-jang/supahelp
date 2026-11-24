import type { CaseRecord, EntryValue } from './cases.js';
import type { PlaybookContent, PlaybookRecord } from './playbooks.js';
import type { WorkspaceRole } from './accounts.js';
export type SyncDocument = {
  id: string;
  kind: 'case' | 'playbook';
  generation: number;
  version: number;
  record: CaseRecord | PlaybookRecord;
};

export type SyncLease = {
  accountId: string;
  organizationId: string;
  workspaceId: string;
  enrollment: string;
  epoch: string;
  role: WorkspaceRole;
  owner: boolean;
  serverTime: number;
  expiresAt: number;
  graceEnd: number;
};

export type SyncOperation = {
  id: string;
  documentId: string;
  enrollment: string;
  epoch: string;
  generation: number;
  base: number;
  type:
    | 'bring-in'
    | 'handoff'
    | 'assign-question'
    | 'create-case'
    | 'entry'
    | 'title'
    | 'delete'
    | 'publish'
    | 'undo'
    | 'resolve'
    | 'confirm-resolution'
    | 'flag'
    | 'remediate';
  recipientId?: string;
  ownerRevision?: number;
  entryId?: string;
  changeId?: string;
  value?: EntryValue;
  title?: string;
  content?: PlaybookContent;
  resolved?: boolean;
  onBehalfOf?: boolean;
};

export type SyncPage = {
  lease: SyncLease;
  sequence: number;
  after: number;
  done: boolean;
  documents: SyncDocument[];
  deleted: string[];
  quarantined: string[];
};

export type SyncReceipt = { id: string; version: number; sequence: number };

export type NotificationCategory =
  | 'approval'
  | 'failure'
  | 'question'
  | 'brought-in'
  | 'handed-off'
  | 'playbook-published'
  | 'playbook-updated';

export type NotificationPreferences = Record<NotificationCategory, boolean>;

export type CaseNotification = {
  workspaceId?: string;
  id: string;
  documentId: string;
  category: NotificationCategory;
  at: string;
  read: boolean;
};

export type AnswerCandidate = {
  id: string;
  documentId: string;
  entryId: string;
  base: number;
  text: string;
  enrollment: string;
  generation?: number;
};

export type CollaborationSnapshot = {
  members: { id: string; name: string; role: 'admin' | 'member' | 'viewer' }[];
  events: CaseNotification[];
  preferences: NotificationPreferences;
  candidates: AnswerCandidate[];
};

export type CollaborateCase = {
  id: string;
  caseId: string;
  type: 'bring-in' | 'handoff' | 'assign-question';
  recipientId?: string;
  ownerRevision?: number;
  entryId?: string;
  base?: number;
};
