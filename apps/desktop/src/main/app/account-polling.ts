import type { BrowserWindow } from 'electron';
import type { AccountService } from '../features/accounts/service';
import type { NotificationDelivery } from '../features/notifications/service';
import type { SyncService, SyncTransport } from '../features/sync/service';

export function startAccountPolling({
  accounts,
  sync,
  teamTransport,
  notifications,
  getWindow,
}: {
  accounts: AccountService;
  sync: SyncService;
  teamTransport?: SyncTransport;
  notifications: NotificationDelivery;
  getWindow(): BrowserWindow | undefined;
}) {
  let checkingNotifications = false;
  const notificationPolling = new AbortController();
  const accountTimer = setInterval(() => {
    if (
      !checkingNotifications &&
      accounts.principal() &&
      teamTransport?.allNotifications
    ) {
      checkingNotifications = true;
      const principal = accounts.principal();
      void teamTransport
        .allNotifications(notificationPolling.signal)
        .then(async (value) => {
          if (
            !notificationPolling.signal.aborted &&
            accounts.principal() === principal
          ) {
            await notifications.preferences(
              `${principal}/personal`,
              value.preferences,
            );
            if (
              notificationPolling.signal.aborted ||
              accounts.principal() !== principal
            )
              return;
            await notifications.deliver(
              `${principal}/team`,
              value.events,
              value.preferences,
            );
          }
        })
        .catch(() => {})
        .finally(() => {
          checkingNotifications = false;
        });
    }
    if (
      getWindow()?.isFocused() &&
      accounts.snapshot().context.context.kind === 'team'
    )
      void accounts.refresh().then(() => sync.sync());
    sync.checkExpiry();
    void sync.sweep();
  }, 60_000);
  accountTimer.unref();
  return () => {
    clearInterval(accountTimer);
    notificationPolling.abort();
  };
}
