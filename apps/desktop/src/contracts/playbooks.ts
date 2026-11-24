import type {
  PlaybookContent,
  PlaybookRecord,
} from '@supahelp/contracts/playbooks';
import type { ContextStamp, Scoped } from './accounts.ts';
import type { Reply } from './chat.ts';
export type {
  PlaybookContent,
  PlaybookRecord,
} from '@supahelp/contracts/playbooks';
export type ResolutionDraft = {
  id: string;
  caseId: string;
  source: string;
  version: number;
  text: string;
  playbookId?: string;
  committed?: boolean;
  noteActionId?: string;
  team?: {
    workspaceId: string;
    accountId: string;
    base: number;
    generation: number;
    confirmationId: string;
  };
};
export type PlaybookSnapshot = {
  revision: number;
  playbooks: PlaybookRecord[];
  resolutions: ResolutionDraft[];
};
export type DocumentRequest = {
  context: ContextStamp;
  cancel?: boolean;
  id?: string;
  version?: number;
  content?: PlaybookContent;
  caseId?: string;
  chatId?: string;
  text?: string;
  playbookId?: string;
  requestId?: string;
  screenshotId?: string;
  playbookIds?: string[];
};
export type ScreenshotPreview = {
  id: string;
  data: string;
  width: number;
  height: number;
  confirmed: boolean;
};
export const PLAYBOOK_CHAT_ACTIONS = [
  'open',
  'publish',
  'discard',
  'delete',
  'export',
  'copy',
  'screenshot',
] as const;
export type PlaybookChatAction = {
  kind: 'saved' | (typeof PLAYBOOK_CHAT_ACTIONS)[number];
  playbookId: string;
  title: string;
  version: number;
  requestId: string;
  completed?: boolean;
};
export type DocumentMatch = {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
  matchedTerms: string[];
};
export type DocumentSearch = {
  cases: DocumentMatch[];
  playbooks: DocumentMatch[];
};
export type DocumentResults = {
  runPlaybookChatAction: true | ScreenshotPreview | undefined;
  searchDocuments: DocumentSearch;
  exportPlaybook: boolean;
  openPlaybookLink: void;
  cancelDocumentWork: void;
  getPlaybooks: Scoped<PlaybookSnapshot>;
  savePlaybookDraft: PlaybookRecord;
  publishPlaybook: PlaybookRecord;
  removePlaybook: boolean;
  discardPlaybookDraft: boolean;
  choosePlaybookScreenshot: ScreenshotPreview | undefined;
  confirmPlaybookScreenshot: PlaybookRecord;
  getPlaybookScreenshot: ScreenshotPreview;
  removePlaybookScreenshot: PlaybookRecord;
  setChatPlaybooks: void;
  attachCase: void;
  detachCase: void;
  createChat: string;
  resumeCase: string;
  resumePlaybook: string;
  draftResolution: ResolutionDraft;
  confirmResolve: ResolutionDraft | undefined;
  reopenCase: void;
  draftCasePlaybook: PlaybookRecord;
  proposeResolutionNote: void;
};
export type DocumentApi = {
  [K in keyof DocumentResults]: (
    input: DocumentRequest,
  ) => Promise<Reply<DocumentResults[K]>>;
} & {
  onPlaybooksChanged(
    listener: (snapshot: Scoped<PlaybookSnapshot>) => void,
  ): () => void;
};
