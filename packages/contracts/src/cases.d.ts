// Case documents stored by main (docs/product/supahelp-build-foundations.md, D3).
export type CaseStatus =
  | 'inv'
  | 'run'
  | 'appr'
  | 'unk'
  | 'wcust'
  | 'weng'
  | 'done'
  | 'fail';

// The 9 numbered sections of a case document, in order.
export type SectionKey =
  | 'summary'
  | 'customer'
  | 'problem'
  | 'reproduction'
  | 'findings'
  | 'actions'
  | 'questions'
  | 'next'
  | 'resolution';

// One stored piece of a section. `text`: Summary / Next step. `row`: a
// label + value line. `item`: a Finding, Action or Open question with a pill.
export type EntryValue = {
  section: SectionKey;
  kind: 'text' | 'row' | 'item';
  label?: string;
  text: string;
  detail?: string;
  pill?: string;
  recipientId?: string;
  answer?: string;
  answeredBy?: string;
};

export type CaseEntry = EntryValue & {
  id: string;
  position: number;
  version: number;
  authorId: string;
  authorName?: string;
  onBehalfOf?: string;
  updatedAt: string;
  systemOwned?: boolean;
};

export type CaseChange = {
  id: string;
  entryId: string;
  before?: EntryValue;
  after?: EntryValue;
  by: string;
  byName?: string;
  onBehalfOf?: string;
  at: string;
  undoneAt?: string;
  baseVersion?: number;
  conflict?: boolean;
  version?: number;
};

export type CaseRecord = {
  playbookId?: string;
  id: string;
  workspaceId: string;
  number: number;
  title: string;
  status: CaseStatus;
  ownerId: string;
  ownerRevision?: number;
  contributorIds?: string[];
  collaborationChanges?: {
    id: string;
    by: string;
    at: string;
    type: string;
    recipientId?: string;
  }[];
  securityGeneration?: number;
  ownerName?: string;
  syncState?: 'Synced' | 'Waiting to sync';
  ticket: string;
  issue?: string;
  customer: { name: string; reference?: string; confirmed: boolean };
  // Chats on this computer that worked on the case. Chats never sync.
  chatIds: string[];
  createdAt: string;
  updatedAt: string;
  entries: CaseEntry[];
  // Newest first.
  changes: CaseChange[];
};
