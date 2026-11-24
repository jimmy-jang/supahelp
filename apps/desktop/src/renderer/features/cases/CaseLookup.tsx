import { useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { Popover, menuRow } from '../../components/Popover';

export type LookupItem = {
  id: string;
  search: string;
  content: ReactNode;
  select?: () => void;
};

export function CaseLookup({
  property,
  value,
  items,
  actions,
  empty = 'No matches.',
}: {
  property: string;
  value: ReactNode;
  items: LookupItem[];
  actions?: ReactNode;
  empty?: string;
}) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  const found = items.filter((item) => item.search.toLowerCase().includes(q));
  return (
    <Popover
      label={value}
      title={`Look up ${property.toLowerCase()}`}
      buttonClass="-ml-1 inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 rounded-item px-1 py-0.5 text-left hover:bg-hover"
      className="w-[280px] max-w-[calc(100vw-16px)]"
      onToggle={(open) => {
        if (open) input.current?.focus();
        else setQuery('');
      }}
    >
      <label className="m-0.5 mb-1.5 flex h-7 items-center gap-2 rounded-item bg-field px-2 text-ink-3">
        <Icon name="search" size={14} />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${property.toLowerCase()}`}
          aria-label={`Search ${property.toLowerCase()}`}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
      </label>
      <div className="max-h-56 overflow-y-auto">
        {found.map(({ id, content, select }) =>
          select ? (
            <button key={id} type="button" className={menuRow} onClick={select}>
              {content}
            </button>
          ) : (
            <div key={id} className="flex min-h-8 items-center gap-2 px-2 py-1">
              {content}
            </div>
          ),
        )}
        {!found.length && (
          <p className="m-0 px-2 py-2 text-meta text-ink-3">
            {q ? 'No matches.' : empty}
          </p>
        )}
      </div>
      {actions && (
        <div className="mt-1 border-t border-line pt-1">{actions}</div>
      )}
    </Popover>
  );
}
