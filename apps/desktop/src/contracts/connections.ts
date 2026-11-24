export type ConnectionAccess = 'read' | 'write';
export type ConnectionAction = {
  source?: { caseId: string; resolutionId: string };
  principal?: string;
  id: string;
  chatId: string;
  tool: string;
  account?: string;
  scope?: string;
  arguments: Record<string, unknown>;
  status:
    | 'pending'
    | 'running'
    | 'verified'
    | 'returned'
    | 'failed'
    | 'unknown'
    | 'cancelled'
    | 'reviewed';
  message?: string;
};
