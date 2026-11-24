export type PlaybookContent = {
  title: string;
  markdown: string;
};

export type PlaybookRecord = {
  id: string;
  workspaceId: string;
  ownerId: string;
  securityGeneration?: number;
  version: number;
  published?: PlaybookContent;
  draft?: PlaybookContent;
  publishedAt?: string;
  publishedBy?: string;
  updatedAt: string;
  draftFrom?: string;
  /** Case the Playbook was first drafted from; survives publish. */
  sourceCaseId?: string;
  draftBaseVersion?: number;
  history?: { at: string; content: PlaybookContent; authorId?: string }[];
};
