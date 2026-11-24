import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Popover, menuRow } from '../components/Popover';
import { searchSidebar, type SearchSource } from './searchSidebar';

export function SidebarSearch({
  chats,
  cases,
  playbooks,
  onOpenChat,
  onOpenCase,
  onOpenPlaybook,
}: SearchSource & {
  onOpenChat: (id: string) => void;
  onOpenCase: (id: string) => void;
  onOpenPlaybook: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const results = searchSidebar({ chats, cases, playbooks }, query);
  const open = { Chat: onOpenChat, Case: onOpenCase, Playbook: onOpenPlaybook };
  return (
    <Popover
      label={
        <>
          <Icon name="search" />
          <span className="sr-only">Search everything</span>
        </>
      }
      title="Search everything"
      buttonClass="grid size-7 flex-none place-items-center rounded-[7px] text-ink-2 hover:bg-hover hover:text-ink"
      area="top span-right"
      className="w-[360px] max-w-[calc(100vw-32px)]"
    >
      <input
        ref={(input) => {
          // Native autofocus runs when the popover opens; React focuses at mount.
          if (input) input.autofocus = true;
        }}
        aria-label="Search chats, cases and Playbooks"
        placeholder="Search chats, cases and Playbooks"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="m-0.5 mb-1.5 rounded-item bg-field px-2 py-1.5 text-ink outline-none placeholder:text-ink-3"
      />
      <div className="max-h-[min(400px,60vh)] overflow-y-auto">
        {results.map((result) => (
          <button
            key={`${result.kind}:${result.id}`}
            type="button"
            className={menuRow}
            onClick={() => open[result.kind](result.id)}
          >
            <span className="min-w-0 flex-1 truncate">{result.title}</span>
            <span className="text-meta text-ink-3">{result.kind}</span>
          </button>
        ))}
        {!results.length && (
          <p role="status" className="px-2 py-3 text-meta text-ink-3">
            No results.
          </p>
        )}
      </div>
    </Popover>
  );
}
