import type { Case } from './types';

export type CaseFilter = 'Mine' | 'Contributing' | 'All cases';

export function filterCases(
  cases: Case[],
  filter: CaseFilter,
  personId: string | null,
  query: string,
  people: readonly { id: string; name: string; email?: string }[] = [],
) {
  const q = query.trim().toLowerCase();
  const names = new Map(
    people.map((p) => [p.id, `${p.name} ${p.email ?? ''}`]),
  );
  return cases.filter((c) => {
    const owned = c.doc.ownerId === personId;
    const included =
      filter === 'All cases' ||
      (filter === 'Mine'
        ? owned
        : !owned &&
          personId !== null &&
          c.doc.contributorIds.includes(personId));
    if (!included || !q) return included;
    return [
      c.title,
      c.customer,
      c.ticket,
      names.get(c.doc.ownerId) ?? c.doc.ownerName,
      ...c.doc.contributorIds.map((id) => names.get(id)),
    ]
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
}
