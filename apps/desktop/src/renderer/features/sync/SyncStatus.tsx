import { useEffect, useState } from 'react';
import type { SyncStatus as Status } from '../../../contracts/sync';
import { useAccount } from '../accounts/AccountProvider';

const labels: Record<Status['state'], string> = {
  checking: 'Checking sync…',
  disabled: 'Shared sync is unavailable',
  synced: 'Synced',
  offline: 'Offline',
  'read-only': 'Read-only',
  locked: 'Team content locked',
  revoked: 'Workspace access removed',
  error: 'Sync needs attention',
};

// Team sync state for the sidebar footer; clicking it syncs now.
export function SyncStatus({
  revision,
  onSynced,
}: {
  revision: number;
  onSynced(): void;
}) {
  const { snapshot: account, isCurrent } = useAccount();
  const [status, setStatus] = useState<Status>({
    state: 'checking',
    pending: 0,
  });
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void window.supahelp
      .getSync(account.context)
      .then((r) => {
        if (active && isCurrent(account.context) && r.ok) setStatus(r.value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [revision, account.context, isCurrent]);
  const syncNow = async () => {
    setSyncing(true);
    setError('');
    try {
      const reply = await window.supahelp.syncNow(account.context);
      if (!isCurrent(account.context)) return;
      if (reply.ok) {
        setStatus(reply.value);
        onSynced();
      } else setError(reply.error);
    } catch {
      if (isCurrent(account.context))
        setError('Sync could not complete. Try again.');
    } finally {
      setSyncing(false);
    }
  };
  const label = syncing ? 'Syncing…' : labels[status.state];
  const ok = !error && status.state === 'synced' && !status.pending;
  return (
    <button
      type="button"
      title={error || 'Sync now'}
      aria-label={`${label}. Sync now`}
      disabled={syncing}
      onClick={() => void syncNow()}
      className="flex min-w-0 items-center gap-1.5 rounded-item px-2 py-1 text-meta text-ink-3 hover:bg-hover hover:text-ink-2 disabled:cursor-wait"
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${ok ? 'bg-ok' : error ? 'bg-bad' : 'bg-ink-3'}`}
      />
      <span role="status" className="truncate">
        {error ? 'Sync failed' : label}
        {!error && status.pending > 0 && ` · ${status.pending} pending`}
      </span>
    </button>
  );
}
