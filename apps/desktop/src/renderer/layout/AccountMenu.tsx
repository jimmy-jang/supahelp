import { useEffect, useRef, type ReactNode } from 'react';
import { Avatar } from '../components/Avatar';
import { Icon, type IconName } from '../components/Icon';
import { shortcutLabel } from '../components/shortcuts';
import { openSupport } from '../components/support';
import { useAccount } from '../features/accounts/AccountProvider';

// Opens upward from the avatar at the bottom of the sidebar.
export function AccountMenu({
  onClose,
  onSettings,
  onShortcuts,
  onAccount,
  onQuickTour,
  onContextChange,
}: {
  onClose: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onAccount: () => void;
  onQuickTour: () => void;
  onContextChange: () => Promise<boolean>;
}) {
  const { snapshot, run, isCurrent } = useAccount();
  const account = snapshot.view?.account;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element;
      // The avatar button toggles the menu itself.
      if (!ref.current?.contains(t) && !t.closest?.('[data-menu-anchor]'))
        onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Defer so the click that opened the menu doesn't close it.
    const t = setTimeout(() => window.addEventListener('mousedown', onDown));
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const item = (
    icon: IconName,
    label: ReactNode,
    onClick?: () => void,
    kbd?: string,
  ) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClick?.();
        onClose();
      }}
      className="flex h-[30px] items-center gap-2.5 rounded-[7px] px-2 text-left text-ink outline-none hover:bg-hover focus-visible:bg-hover"
    >
      <span className="text-ink-2">
        <Icon name={icon} />
      </span>
      {label}
      {kbd && (
        <kbd className="ml-auto font-sans text-[11.5px] text-ink-3">{kbd}</kbd>
      )}
    </button>
  );

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Account"
      className="no-drag absolute bottom-[50px] left-2 z-10 flex w-64 flex-col gap-px rounded-card bg-surface p-1.5 shadow-2 ring-[0.5px] ring-line"
    >
      <div className="flex items-center gap-2.5 px-2 pt-2 pb-2.5">
        <Avatar
          name={account?.name || account?.email || 'Personal'}
          size={36}
        />
        <div>
          <div className="font-medium">
            {account?.name || 'Personal on this computer'}
          </div>
          <div className="text-[11.5px] text-ink-3">
            {account?.email || 'Local work · no account required'}
          </div>
        </div>
      </div>
      <div className="mx-0.5 my-1 h-px bg-line" />
      {item('gear', 'Settings', onSettings, shortcutLabel(','))}
      {item('keyboard', 'Keyboard shortcuts', onShortcuts)}
      {item('info', 'Quick tour', onQuickTour)}
      {item('chat', 'Get support', openSupport)}
      {/* Builds without the account service have no account to open. */}
      {snapshot.error?.code !== 'not-configured' && (
        <>
          <div className="mx-0.5 my-1 h-px bg-line" />
          {item('users', 'Account', onAccount)}
        </>
      )}
      {account &&
        item('out', 'Sign out', async () => {
          if ((await onContextChange()) && isCurrent(snapshot.context))
            void run(() => window.supahelp.signOutAccount());
        })}
    </div>
  );
}
