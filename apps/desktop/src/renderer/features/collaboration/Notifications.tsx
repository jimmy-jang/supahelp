import { useState } from 'react';
import { formatDateTime } from '../../app/formatDate';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import type { CaseNotification } from '../../../contracts/sync';
import type { useCollaboration } from './useCollaboration';
const labels = {
  approval: 'A case needs approval',
  failure: 'An action needs checking',
  question: 'An open question is for you',
  'brought-in': 'You were brought into a case',
  'handed-off': 'A case was handed to you',
  'playbook-published': 'A new Playbook was published',
  'playbook-updated': 'Your Playbook was updated',
};
type Collaboration = ReturnType<typeof useCollaboration>;
type Props = {
  collaboration: Collaboration;
  // Opens the notification's case or Playbook; resolves false when it could not.
  onOpen: (event: CaseNotification) => Promise<boolean>;
  titleOf: (id: string) => string | undefined;
};
const visible = (c: Collaboration) =>
  (c.value?.events ?? [])
    .filter((e) => c.value!.preferences[e.category] ?? true)
    .sort((a, b) => b.at.localeCompare(a.at));

function NotificationList({
  collaboration: c,
  onOpen,
  titleOf,
  limit,
  onOpened,
}: Props & { limit?: number; onOpened?: () => void }) {
  const events = visible(c).slice(0, limit);
  return (
    <div className="space-y-2 text-left">
      {c.error && (
        <p role="alert" className="text-meta text-bad">
          {c.error}
        </p>
      )}
      {!c.error && !events.length && (
        <p className="text-meta text-ink-3">No notifications yet.</p>
      )}
      {events.map((e) => (
        <button
          key={e.id}
          disabled={c.busy}
          type="button"
          className="block w-full rounded-item border border-line bg-surface p-3 text-left text-body hover:bg-hover"
          onClick={async () => {
            // Send the read first (opening may switch workspace and end this
            // context) but don't wait: it costs several network round trips.
            if (!e.read) void c.read(e.id);
            if (await onOpen(e)) onOpened?.();
          }}
        >
          <span className="flex items-baseline gap-2">
            {!e.read && (
              <span aria-label="Unread" className="text-attn">
                ●
              </span>
            )}
            <span className={e.read ? 'text-ink-2' : 'font-medium'}>
              {labels[e.category]}
            </span>
            <span className="ml-auto shrink-0 text-meta text-ink-3">
              {formatDateTime(e.at)}
            </span>
          </span>
          {titleOf(e.documentId) && (
            <span className="mt-0.5 block truncate text-meta text-ink-2">
              {titleOf(e.documentId)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function NotificationsPage(props: Props & { onSettings: () => void }) {
  return (
    <section
      className="mx-auto w-full max-w-[680px] flex-1 overflow-y-auto px-6 pb-8"
      aria-label="Notifications"
    >
      <div className="mb-3 flex items-center">
        <h1 className="text-title font-semibold">Notifications</h1>
        <button
          type="button"
          className="ml-auto rounded-item px-2 py-1 text-meta text-ink-2 hover:bg-hover"
          onClick={props.onSettings}
        >
          Notification settings
        </button>
      </div>
      <NotificationList {...props} />
    </section>
  );
}

const RECENT = 8;
export function NotificationBell(props: Props & { onViewAll: () => void }) {
  const [open, setOpen] = useState(false);
  const unread = visible(props.collaboration).filter((e) => !e.read).length;
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={() => setOpen(true)}
        className="no-drag relative grid size-7 flex-none place-items-center rounded-[7px] text-ink-2 hover:bg-hover hover:text-ink"
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-attn px-1 text-[10px] leading-none font-medium text-on-ink">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <Modal title="Notifications" onCancel={() => setOpen(false)}>
          <button
            type="button"
            title="Close"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 grid size-7 place-items-center rounded-[7px] text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Icon name="close" />
          </button>
          <NotificationList
            {...props}
            limit={RECENT}
            onOpened={() => setOpen(false)}
          />
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="rounded-item px-3 py-1.5 text-meta font-medium text-ink-2 hover:bg-hover"
              onClick={() => {
                setOpen(false);
                props.onViewAll();
              }}
            >
              View all notifications
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
