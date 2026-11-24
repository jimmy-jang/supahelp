import type { CaseUpdate } from '../../../contracts/cases';
import type { Attached, Change, SectionKey } from '../cases/types';

export type Msg =
  | { kind: 'you'; text: string }
  | { kind: 'ai'; text: string }
  | { kind: 'steps'; tools: string[]; text: string }
  | { kind: 'suggest' }
  | { kind: 'created'; text: string }
  | { kind: 'refund' }
  | (CaseUpdate & { kind: 'case-change'; note?: string; pending?: boolean })
  // "Case updated · Section what changed" with Undo and View.
  | {
      kind: 'case-updated';
      caseId: string;
      section: SectionKey;
      what: string;
      change: Change;
      note?: string;
    }
  // Offered after Resolve: update or create a Playbook, plus the helpdesk note.
  | { kind: 'resolve'; caseId: string; choice?: string }
  | { kind: 'playbook-ready'; playbookId: string };

export type Chat = {
  id: string;
  title: string;
  messages: Msg[];
  attached: Attached;
};
