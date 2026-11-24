import type { ConnectionAction } from '../../../contracts/connections';
import type {
  CaseNotification,
  NotificationPreferences,
} from '../../../contracts/sync';
import { notificationDefaults } from '../../../contracts/sync.ts';
import type { Encryption } from '../../platform/auth-store';
import { ConnectionStore } from '../../platform/connection-store.ts';
type State = {
  access: 'read';
  actions: ConnectionAction[];
  enabled: boolean;
  hideDetails: boolean;
  seen: Record<string, string[]>;
  events?: Record<string, CaseNotification[]>;
  preferences?: Record<string, NotificationPreferences>;
};
// Persist checkpoints before display: a process crash may miss a banner but never repeats one.
export class NotificationDelivery {
  private store: ConnectionStore<State>;
  private tail: Promise<unknown> = Promise.resolve();
  private show: (event: CaseNotification, hideDetails: boolean) => void;
  constructor(
    file: string,
    encryption: Encryption,
    show: (event: CaseNotification, hideDetails: boolean) => void,
  ) {
    this.show = show;
    this.store = new ConnectionStore(file, encryption);
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    return next;
  }
  private async load() {
    return (
      (await this.store.load()) ?? {
        access: 'read' as const,
        actions: [],
        enabled: false,
        hideDetails: true,
        seen: {},
      }
    );
  }
  settings(value?: { enabled: boolean; hideDetails: boolean }) {
    return this.serialize(async () => {
      const state = await this.load();
      if (value) {
        if (
          typeof value.enabled !== 'boolean' ||
          typeof value.hideDetails !== 'boolean'
        )
          throw Error('Invalid notification settings.');
        Object.assign(state, value);
        await this.store.save(state);
      }
      return { enabled: state.enabled, hideDetails: state.hideDetails };
    });
  }
  async local(scope: string) {
    return this.serialize(async () => {
      const s = await this.load();
      if (!s.seen[scope]) {
        s.seen[scope] = [];
        await this.store.save(s);
      }
      return {
        events: s.events?.[scope] ?? [],
        preferences: s.preferences?.[scope] ?? notificationDefaults,
      };
    });
  }
  async preferences(scope: string, value: NotificationPreferences) {
    return this.serialize(async () => {
      const s = await this.load();
      (s.preferences ??= {})[scope] = value;
      await this.store.save(s);
    });
  }
  async read(scope: string, id: string) {
    return this.serialize(async () => {
      const s = await this.load();
      for (const e of s.events?.[scope] ?? []) if (e.id === id) e.read = true;
      await this.store.save(s);
    });
  }
  async observe(scope: string, actions: ConnectionAction[]) {
    const result = await this.serialize(async () => {
      const s = await this.load(),
        events = ((s.events ??= {})[scope] ?? []).filter((e) => {
          const action = actions.find((a) => e.id.startsWith(a.id + '/'));
          return !action || e.id === `${action.id}/${action.status}`;
        });
      for (const a of actions)
        if (
          (a.principal ?? 'anonymous') === scope.split('/')[0] &&
          a.source &&
          ['pending', 'failed', 'unknown'].includes(a.status)
        ) {
          const id = `${a.id}/${a.status}`;
          if (!events.some((e) => e.id === id))
            events.unshift({
              id,
              documentId: a.source.caseId,
              category: a.status === 'pending' ? 'approval' : 'failure',
              at: new Date().toISOString(),
              read: false,
            });
        }
      s.events[scope] = events.slice(0, 100);
      await this.store.save(s);
      return {
        events: s.events[scope],
        preferences: s.preferences?.[scope] ?? notificationDefaults,
      };
    });
    await this.deliver(scope, result.events, result.preferences);
  }
  deliver(
    scope: string,
    events: CaseNotification[],
    preferences: NotificationPreferences,
  ) {
    return this.serialize(async () => {
      const state = await this.load(),
        old = state.seen[scope],
        seen = new Set(old ?? []);
      const fresh = old
        ? events.filter(
            (e) => !seen.has(e.id) && !e.read && preferences[e.category],
          )
        : [];
      // shortcut: checkpoint 1000 recent IDs for the 100-event feed, use a server cursor before increasing feed retention.
      state.seen[scope] = [
        ...new Set([...events.map((e) => e.id), ...seen]),
      ].slice(0, 1000);
      await this.store.save(state);
      if (state.enabled)
        for (const e of fresh)
          try {
            this.show(e, state.hideDetails);
          } catch {
            /* Banner delivery is best effort; the durable in-app event remains. */
          }
    });
  }
}
