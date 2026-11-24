import type { CaseStatus, SectionKey } from '../../../contracts/cases';
import type { Msg } from '../chat/types';

export type StatusKey = CaseStatus;
// The 9 numbered sections of a case document, in order.
export type { SectionKey };

// One structured row in Findings, Actions or Open questions. `pill` is the
// verdict (Confirmed / Ruled out / Guess), the action result or the question
// state. `by` is who added it ("Priya", "AI for Sam").
export type Entry = {
  id: string;
  pill: string;
  text: string;
  detail?: string;
  by: string;
};

// A section is plain text, label/value rows or entries. Missing = hidden.
export type Section = {
  text?: string;
  rows?: [string, string][];
  entries?: Entry[];
};

export type Similar = { title: string; note: string; by: string };

export type CaseDoc = {
  ownerId: string;
  ownerName?: string;
  contributorIds: string[];
  customer: { name: string; id?: string; confirmed: boolean };
  issue?: string;
  playbook?: { id: string; state: 'suggested' | 'used' };
  updated: string;
  sync:
    | 'Synced'
    | 'Waiting to sync'
    | 'Waiting for masking'
    | 'On this computer';
  sections: Partial<Record<SectionKey, Section>>;
  similar: Similar[];
  log: { time: string; text: string; changeId?: string }[];
  // Entry ids or section keys the AI just changed (shown on a sunk background).
  fresh: string[];
};

// One undoable edit. With `entryId` it adds/replaces/removes that entry;
// without it, it replaces the whole section (undefined = hidden).
export type Change = {
  section: SectionKey;
  entryId?: string;
  before?: Entry | Section;
  after?: Entry | Section;
};

// Drag a case row from the sidebar onto the composer to attach it.
export const CASE_DRAG_TYPE = 'application/x-supahelp-case';
// Pasting this link into the composer attaches the case (preview format).
export const caseLink = (n: number) => `supahelp://case/${n}`;

// What a chat has attached in the composer: at most one case, any Playbooks.
export type Attached = { caseId?: string; playbookIds: string[] };
export type Target = { caseId: string } | { playbookId: string };

export type Case = {
  id: string;
  // A made-up preview case; real cases are stored by main.
  example?: boolean;
  number: number;
  ticket: string;
  title: string;
  customer: string;
  status: StatusKey;
  time: string;
  // The case's own chat, unless it was created from a chat (`chatId`).
  messages: Msg[];
  chatId?: string;
  doc: CaseDoc;
  attached: Attached;
  approved?: boolean;
  // Whether an open question in this case is addressed to you.
  questionsForYou: number;
};
