import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AccountSnapshot,
  ContextStamp,
} from '../../../contracts/accounts';
import type { Reply } from '../../../contracts/chat';
import { isContextChanged, newerAccount, sameContext } from './snapshots';

const initial: AccountSnapshot = {
  revision: -1,
  context: { generation: 0, accountId: null, context: { kind: 'personal' } },
  status: 'signed-out',
  view: null,
  members: [],
  invitations: [],
};
type AccountState = {
  snapshot: AccountSnapshot;
  busy: boolean;
  error?: string;
  isCurrent: (stamp: ContextStamp | undefined) => boolean;
  run: <T>(
    operation: () => Promise<Reply<T>>,
  ) => Promise<{ value: T } | undefined>;
  mutate: <T>(
    intent: string,
    operation: (requestId: string) => Promise<Reply<T>>,
  ) => Promise<{ value: T } | undefined>;
};
const AccountContext = createContext<AccountState | null>(null);
export function AccountProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const pending = useRef(false),
    intents = useRef(new Map<string, string>());
  useEffect(() => {
    let active = true;
    if (!window.supahelp?.getAccount) {
      setError('Account services are available in the desktop app.');
      setLoaded(true);
      return;
    }
    const receive = (next: AccountSnapshot) => {
      if (next.view && next.view.account.id !== next.context.accountId)
        next = { ...next, view: null, members: [], invitations: [] };
      if (active) {
        setLoaded(true);
        const current = latest.current;
        if (!newerAccount(current, next)) return;
        if (next.context.generation !== current.context.generation) {
          intents.current.clear();
          pending.current = false;
          setBusy(false);
          setError(undefined);
        }
        latest.current = next;
        setSnapshot(next);
      }
    };
    const unsubscribe = window.supahelp.onAccountChanged(receive);
    void window.supahelp
      .getAccount()
      .then((reply) => {
        if (reply.ok) receive(reply.value);
        else if (active) {
          setError(reply.error);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError('Account settings could not load. Restart Supahelp.');
          setLoaded(true);
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const isCurrent = useCallback(
    (stamp: ContextStamp | undefined) =>
      sameContext(latest.current.context, stamp),
    [],
  );
  const run = useCallback(async <T,>(operation: () => Promise<Reply<T>>) => {
    if (pending.current) return;
    const generation = latest.current.context.generation;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const reply = await operation();
      if (generation !== latest.current.context.generation) return;
      if (!reply.ok) {
        if (!isContextChanged(reply.error)) setError(reply.error);
        return;
      }
      return { value: reply.value };
    } catch {
      if (generation === latest.current.context.generation)
        setError('The request could not complete. Try again.');
    } finally {
      if (generation === latest.current.context.generation) {
        pending.current = false;
        setBusy(false);
      }
    }
  }, []);
  const mutate = useCallback(
    async <T,>(
      intent: string,
      operation: (requestId: string) => Promise<Reply<T>>,
    ) => {
      const id = intents.current.get(intent) ?? crypto.randomUUID();
      intents.current.set(intent, id);
      const result = await run(() => operation(id));
      if (result) intents.current.delete(intent);
      return result;
    },
    [run],
  );
  return (
    <AccountContext value={{ snapshot, busy, error, isCurrent, run, mutate }}>
      {loaded ? (
        <Fragment key={snapshot.context.generation}>{children}</Fragment>
      ) : (
        <div role="status" className="m-auto p-6 text-ink-2">
          Loading account settings…
        </div>
      )}
    </AccountContext>
  );
}
export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw Error('AccountProvider is missing.');
  return value;
}
