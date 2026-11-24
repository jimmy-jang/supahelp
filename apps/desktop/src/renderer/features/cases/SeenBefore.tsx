import { useEffect, useState } from 'react';
import type { CaseRecord } from '../../../contracts/cases';
import type { DocumentSearch } from '../../../contracts/playbooks';
import { Button } from '../../components/Button';
import { DocSection } from '../../components/DocPanel';
import { useAccount } from '../accounts/AccountProvider';
import type { usePlaybooks } from '../playbooks/usePlaybooks';

export function SeenBefore({
  record,
  revision,
  documents,
  chat,
  onOpenCase,
  onOpenPlaybook,
}: {
  record: CaseRecord;
  revision: number;
  documents: ReturnType<typeof usePlaybooks>;
  chat?: { id: string; playbookIds?: string[]; status: string };
  onOpenCase(id: string): void;
  onOpenPlaybook(id: string): void;
}) {
  const { snapshot: account, isCurrent } = useAccount();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{
    key: string;
    scope: string;
    data?: DocumentSearch;
    error?: string;
  }>();
  const key = JSON.stringify([
    account.context.generation,
    record.id,
    revision,
    documents.revision,
    query,
  ]);
  // Results stay on screen while a newer search runs (same case + account),
  // so revision bumps don't blank the section and make it jump.
  const scope = `${account.context.generation}:${record.id}`;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void window.supahelp
        .searchDocuments({
          context: account.context,
          caseId: record.id,
          text: query || undefined,
        })
        .then((r) => {
          if (active && isCurrent(account.context))
            setResult(
              r.ok
                ? { key, scope, data: r.value }
                : { key, scope, error: r.error },
            );
        })
        .catch(() => {
          if (active && isCurrent(account.context))
            setResult({
              key,
              scope,
              error: 'Saved work could not be searched. Try again.',
            });
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key]);
  const current = result?.scope === scope ? result : undefined;
  return (
    <DocSection title="Seen before">
      <label className="block text-meta text-ink-2">
        Search saved work
        <input
          type="search"
          maxLength={2000}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Match this case, or type keywords…"
          className="mt-1 w-full rounded-item border border-line bg-surface p-2 text-body"
        />
      </label>
      {!current && (
        <p role="status" className="mt-2 text-meta text-ink-3">
          Searching saved work…
        </p>
      )}
      {current?.error && (
        <p role="alert" className="mt-2 text-meta text-bad">
          {current.error}
        </p>
      )}
      {current?.data && (
        <div className="mt-3 space-y-3">
          <p className="text-meta text-ink-3">
            {query
              ? 'Keyword matches in this workspace.'
              : 'Matches based on this case.'}{' '}
            Open a result to check it.
          </p>
          <div>
            <h4 className="text-body font-semibold">Resolved cases</h4>
            {!current.data.cases.length && (
              <p className="text-meta text-ink-3">
                No matching resolved cases.
              </p>
            )}
            {current.data.cases.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenCase(c.id)}
                className="block w-full rounded-item p-2 text-left hover:bg-hover"
              >
                <span className="text-body">{c.title}</span>
                <span className="block whitespace-pre-wrap text-meta text-ink-3">
                  {c.excerpt}
                </span>
                <span className="block text-meta text-ink-3">
                  Matched: {c.matchedTerms.join(', ')}
                </span>
              </button>
            ))}
          </div>
          <div>
            <h4 className="text-body font-semibold">Suggested Playbooks</h4>
            {!current.data.playbooks.length && (
              <p className="text-meta text-ink-3">
                No matching published Playbooks.
              </p>
            )}
            {current.data.playbooks.map((p) => (
              <div key={p.id} className="py-2">
                <button
                  type="button"
                  className="rounded-chip text-body hover:underline"
                  onClick={() => onOpenPlaybook(p.id)}
                >
                  {p.title}
                </button>
                <p className="whitespace-pre-wrap text-meta text-ink-3">
                  {p.excerpt}
                </p>
                <p className="text-meta text-ink-3">
                  Matched: {p.matchedTerms.join(', ')}
                </p>
                {chat && (
                  <Button
                    kind="ghost"
                    disabled={
                      documents.busy ||
                      chat.status !== 'idle' ||
                      (chat.playbookIds?.length ?? 0) >= 5 ||
                      chat.playbookIds?.includes(p.id)
                    }
                    onClick={() =>
                      void documents.run('setChatPlaybooks', {
                        chatId: chat.id,
                        playbookIds: [...(chat.playbookIds ?? []), p.id],
                      })
                    }
                  >
                    {chat.playbookIds?.includes(p.id)
                      ? 'Attached'
                      : 'Attach Playbook'}
                  </Button>
                )}
              </div>
            ))}
            <p className="text-meta text-ink-3">
              Suggestions do not choose the Playbook used. Choose it when
              resolving the case.
            </p>
          </div>
        </div>
      )}
    </DocSection>
  );
}
