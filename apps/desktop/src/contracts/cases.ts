import type {
  CaseRecord,
  EntryValue,
  SectionKey,
} from '@supahelp/contracts/cases';
export type {
  CaseChange,
  CaseEntry,
  CaseRecord,
  CaseStatus,
  EntryValue,
  SectionKey,
} from '@supahelp/contracts/cases';

export type CaseSnapshot = {
  revision: number;
  cases: CaseRecord[];
  maskingRequired?: boolean;
};

export type CaseUpdate = {
  caseId: string;
  changeId: string;
  entryId: string;
  section: SectionKey;
  text: string;
};

export type CaseEditCommand = {
  caseId: string;
  requestId: string;
} & (
  | { action: 'add'; value: EntryValue }
  | { action: 'update'; entryId: string; version: number; value: EntryValue }
  | { action: 'remove'; entryId: string; version: number }
);
export type CaseEditRequest = CaseEditCommand & {
  context: import('./accounts.ts').ContextStamp;
};

export type CasePerson = { id: string; name: string; role: string };
export type CaseAssignment = {
  caseId: string;
  action: 'bring-in' | 'handoff';
  recipientId: string;
  ownerRevision: number;
  context: import('./accounts.ts').ContextStamp;
};

export type Customer = { id: string; name: string; reference?: string };
export type CustomerDirectory = {
  customers: Customer[];
  links: { caseId: string; customerId: string }[];
};
