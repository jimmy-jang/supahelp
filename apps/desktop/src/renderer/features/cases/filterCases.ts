import type { Case } from './types';

export type CaseFilter = 'Mine' | 'Contributing' | 'All cases';

export function filterCases(
  cases: Case[],
  filter: CaseFilter,
  personId: string | null,
  query: string,
) {
  const q = query.trim().toLowerCase();
  return cases.filter((c) => {
    const owned = c.doc.ownerId === personId;
    const included =
      filter === 'All cases' ||
      (filter === 'Mine'
        ? owned
        : !owned &&
          personId !== null &&
          c.doc.contributorIds.includes(personId));
    return (
      included &&
      `${c.title} ${c.customer} ${c.ticket}`.toLowerCase().includes(q)
    );
  });
}
