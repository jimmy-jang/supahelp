import type { Case, StatusKey } from './types';

// Needs-you first, then in progress, waiting, resolved. Stable within a group.
const ORDER: StatusKey[] = [
  'appr',
  'unk',
  'fail',
  'run',
  'inv',
  'weng',
  'wcust',
  'done',
];
export const sortCases = (cs: Case[]) =>
  [...cs].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
