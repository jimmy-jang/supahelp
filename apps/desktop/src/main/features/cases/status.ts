import type { CaseRecord, CaseStatus } from '../../../contracts/cases';
import type { ConnectionAction } from '../../../contracts/connections';

export type LiveInputs = {
  actions: Pick<ConnectionAction, 'chatId' | 'source' | 'status'>[];
  chats: { id: string; status: string; error?: string }[];
};

/** Statuses a person may pick. Resolved goes through Resolve; the rest are live. */
export const MANUAL_STATUSES: readonly CaseStatus[] = ['inv', 'wcust', 'weng'];

// Running, Needs approval, Outcome unknown and Failed follow from what is
// happening now, never from a model or a person. Display only: the stored
// status stays in the record, so read() and Resolve's change checks ignore it.
export function liveStatus(
  c: Pick<CaseRecord, 'id' | 'status' | 'chatIds'>,
  live: LiveInputs,
): CaseStatus {
  if (c.status === 'done') return c.status;
  const actions = live.actions.filter(
    (a) => a.source?.caseId === c.id || c.chatIds.includes(a.chatId),
  );
  if (actions.some((a) => a.status === 'pending')) return 'appr';
  if (actions.some((a) => a.status === 'unknown')) return 'unk';
  const chats = live.chats.filter((chat) => c.chatIds.includes(chat.id));
  if (chats.some((chat) => chat.status !== 'idle')) return 'run';
  if (chats.some((chat) => chat.error)) return 'fail';
  return c.status;
}
