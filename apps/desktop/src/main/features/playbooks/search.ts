import type { CaseRecord } from '../../../contracts/cases';
import type { DocumentMatch } from '../../../contracts/playbooks';

const stop = new Set(
  'a an and are as at be been before by case for from how i in is it of on or our that the their this to was we what when with you your'.split(
    ' ',
  ),
);
function words(text: string) {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}
export function caseSearchText(c: CaseRecord) {
  return [
    c.title,
    ...c.entries
      .filter((e) => ['summary', 'problem', 'reproduction'].includes(e.section))
      .map((e) => e.text),
  ].join('\n');
}

// shortcut: scan current documents, use a local index if measured workspace size makes this slow.
export function rankDocuments(
  query: string,
  documents: Omit<DocumentMatch, 'matchedTerms'>[],
): DocumentMatch[] {
  const terms = [...new Set(words(query).filter((t) => !stop.has(t)))].slice(
    0,
    32,
  );
  if (!terms.length) return [];
  return documents
    .map((d) => {
      const title = new Set(words(d.title)),
        body = new Set(words(d.excerpt));
      const matchedTerms = terms.filter((t) => title.has(t) || body.has(t));
      const score = matchedTerms.reduce(
        (n, t) => n + (title.has(t) ? 3 : 1),
        0,
      );
      const at = d.excerpt
        .toLowerCase()
        .indexOf(matchedTerms.find((t) => body.has(t)) ?? '');
      return {
        ...d,
        excerpt: d.excerpt.slice(
          Math.max(0, at - 80),
          Math.max(0, at - 80) + 240,
        ),
        matchedTerms,
        score,
      };
    })
    .filter((d) => d.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 5)
    .map(({ score: _score, ...d }) => d);
}
