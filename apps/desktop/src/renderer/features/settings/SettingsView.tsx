import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { useAccount } from '../accounts/AccountProvider';
import { SETTINGS_NAV, SETTINGS_PAGES, type SettingsPage } from './pages';

export function settingsTitle(page: SettingsPage) {
  if (page === 'new-organization') return 'New organization';
  for (const g of SETTINGS_NAV)
    for (const i of g.items) if (i.page === page) return i.title;
  return 'Settings';
}

// Settings in the main area: its own nav column and a scrolling content panel.
export function SettingsView({
  page,
  onPage,
  onOpenWorkspace,
}: {
  page: SettingsPage;
  onPage: (page: SettingsPage) => void;
  onOpenWorkspace: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const Page = SETTINGS_PAGES[page];
  // Builds without the account service have no Team features to manage.
  const team = useAccount().snapshot.error?.code !== 'not-configured';

  return (
    <div className="flex min-h-0 flex-1 pr-2 pb-2">
      <nav
        aria-label="Settings"
        className="flex w-[224px] flex-none flex-col gap-px pr-2 pl-2.5"
      >
        <label className="mb-2.5 flex h-7 items-center gap-2 rounded-item bg-surface px-2 text-ink-3 shadow-1">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
          />
        </label>
        {SETTINGS_NAV.map((g, gi) => {
          const items = g.items.filter((i) =>
            i.title.toLowerCase().includes(q),
          );
          if (!items.length || (g.group === 'Team' && !team)) return null;
          return (
            <div
              key={g.group}
              className={`flex flex-col gap-px ${gi ? 'mt-2.5' : ''}`}
            >
              <h2 className="m-0 px-2 pb-1 text-meta font-normal text-ink-3">
                {g.group}
              </h2>
              {items.map((i) => {
                const current =
                  page === i.page ||
                  (page === 'new-organization' && i.page === 'billing');
                return (
                  <button
                    key={i.page}
                    type="button"
                    aria-current={current ? 'page' : undefined}
                    onClick={() => onPage(i.page)}
                    className={`flex h-[30px] items-center gap-[9px] rounded-item px-2 text-left ${current ? 'bg-surface font-medium shadow-1' : 'hover:bg-hover'}`}
                  >
                    <span className="text-ink-2">
                      <Icon name={i.icon} />
                    </span>
                    {i.title}
                    {i.badge ? (
                      <span
                        className="ml-auto text-[11px] font-medium text-attn"
                        title={`${i.badge} need${i.badge === 1 ? 's' : ''} you`}
                      >
                        {i.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div
        data-settings-scroll
        className="min-w-0 flex-1 overflow-y-auto rounded-card bg-surface shadow-1"
      >
        <div
          key={page}
          className="mx-auto flex w-full max-w-[640px] flex-col gap-[22px] px-8 pt-10 pb-12 select-text"
        >
          <Page onOpenWorkspace={onOpenWorkspace} />
        </div>
      </div>
    </div>
  );
}
