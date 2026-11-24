import { useEffect, useState, type ReactNode } from 'react';
import type { CatalogConnection } from '../../../contracts/catalog';
import type { OnboardingAnswers } from '../../../contracts/onboarding';
import { ZENDESK_REDIRECT_URI } from '../../../contracts/zendesk';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { connectionCatalog } from '../../fixtures/connections';
import { LinearConnection } from '../settings/LinearConnection';
import { Models } from '../settings/Models';
import { ServiceConnection } from '../settings/ServiceConnection';
import { ZendeskConnection } from '../settings/ZendeskConnection';
import { Pill, Tag, ToolTile } from '../settings/parts';
import { useConnections } from '../settings/useConnections';
import { useLinear } from '../settings/useLinear';
import { useZendesk } from '../settings/useZendesk';
import { FIRST_QUESTION, helpdeskName, pickedTools } from './options';

type Method = 'sign-in' | 'key' | 'admin' | 'unsupported';
const METHOD: Record<Method, string> = {
  'sign-in': 'Sign in with your browser',
  key: 'Paste one key',
  admin: 'Needs an OAuth app from an admin',
  unsupported: 'Not available yet',
};

// How a tool connects today, from its live setup form.
function methodOf(id: string, catalog?: CatalogConnection[]): Method {
  if (id === 'linear') return 'sign-in';
  if (id === 'zendesk') return 'admin';
  const c = catalog?.find((item) => item.id === id);
  if (!c) return 'unsupported';
  if (c.fields.some((f) => f.key === 'clientId' && f.value === undefined))
    return 'admin';
  if (c.fields.some((f) => f.secret)) return 'key';
  return 'sign-in';
}

// A setup note an admin can act on without opening Supahelp.
function adminNote(id: string, catalog?: CatalogConnection[]) {
  const name = connectionCatalog.find((t) => t.id === id)?.name ?? id;
  if (id === 'zendesk')
    return [
      `Supahelp needs a Zendesk OAuth client to connect ${name}.`,
      'In Zendesk Admin Center → Apps and integrations → APIs → OAuth clients, add a public client (no secret) with this redirect URL:',
      ZENDESK_REDIRECT_URI,
      'Then send me the Zendesk subdomain and the client’s unique identifier.',
    ].join('\n');
  const c = catalog?.find((item) => item.id === id);
  const redirect = c?.fields.find((f) => f.key === 'redirectUri')?.value;
  return [
    `Supahelp needs an OAuth app to connect ${name}.`,
    c?.instructions ?? '',
    redirect ? `Redirect URL: ${redirect}` : '',
    c ? `Setup guide: ${c.documentation}` : '',
    'Then send me the client ID (and secret, if the app has one) through a password manager.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function ConnectChecklist({
  answers,
  workspace,
  onDone,
  busy,
}: {
  answers: OnboardingAnswers;
  workspace?: string;
  onDone: () => void;
  busy: boolean;
}) {
  const snapshot = useConnections().snapshot;
  const catalog = snapshot?.connections;
  const linear = useLinear().snapshot?.state;
  const zendesk = useZendesk().snapshot?.state;
  const [ai, setAi] = useState(false);
  const [open, setOpen] = useState<string>();
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState<string>();

  // Re-read model status whenever the AI row closes or the window regains focus.
  useEffect(() => {
    let active = true;
    const read = () =>
      void window.supahelp
        .getModelsSettings()
        .then((r) => {
          if (active && r.ok)
            setAi(r.value.providers.some((p) => p.state === 'ready'));
        })
        .catch(() => undefined);
    read();
    window.addEventListener('focus', read);
    return () => {
      active = false;
      window.removeEventListener('focus', read);
    };
  }, [open]);

  const state = (id: string) =>
    id === 'linear'
      ? linear
      : id === 'zendesk'
        ? zendesk
        : catalog?.find((c) => c.id === id)?.state;
  const tools = pickedTools(answers);
  const done =
    tools.filter((id) => state(id) === 'connected').length + Number(ai);
  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(adminNote(id, catalog));
      setAsked((s) => new Set(s).add(id));
      setCopied(id);
    } catch {
      setCopied(undefined);
    }
  };
  const first = FIRST_QUESTION[answers.pains[0] ?? 'context'];

  return (
    <section className="slide-in-line">
      <h1 className="m-0 text-heading font-semibold tracking-[-0.01em]">
        {workspace ? `${workspace} is ready` : 'Your workspace is ready'}
      </h1>
      <p className="mt-1 mb-6 text-ink-2">
        Connect what you use. Each row is optional, and anything you skip stays
        in Settings → Connections.
      </p>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        <Item
          id="ai"
          title="AI access"
          detail={
            ai
              ? 'Connected'
              : 'Your Claude or ChatGPT subscription, or an API key'
          }
          lead={
            <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-surface text-ink-2 shadow-1">
              <Icon name="spark" />
            </span>
          }
          connected={ai}
          open={open === 'ai'}
          onToggle={() => setOpen(open === 'ai' ? undefined : 'ai')}
        >
          <Models />
        </Item>
        {tools.map((id) => {
          const tool = connectionCatalog.find((t) => t.id === id);
          const method = methodOf(id, catalog);
          const connected = state(id) === 'connected';
          const pending = !connected && snapshot?.pendingReview?.includes(id);
          const waiting = asked.has(id) && !connected;
          return (
            <Item
              key={id}
              id={id}
              title={tool?.name ?? helpdeskName(id)}
              detail={pending ? 'Pending provider review' : METHOD[method]}
              lead={
                <ToolTile id={id} abbr={tool?.abbr ?? id[0].toUpperCase()} />
              }
              connected={connected}
              status={waiting ? <Tag>Waiting on admin</Tag> : undefined}
              open={open === id}
              disabled={!snapshot || pending || method === 'unsupported'}
              onToggle={() => setOpen(open === id ? undefined : id)}
            >
              {method === 'admin' && (
                <div className="flex flex-wrap items-center gap-2 rounded-item bg-sunk px-3 py-2.5">
                  <span className="min-w-0 flex-1 text-meta text-ink-2">
                    Needs an OAuth app from your admin. Send them the note, or
                    follow “How to set up” below.
                  </span>
                  <Button kind="secondary" onClick={() => void copy(id)}>
                    <Icon name="copy" size={14} />
                    {copied === id ? 'Copied' : 'Copy note for my admin'}
                  </Button>
                </div>
              )}
              {tool &&
                (id === 'linear' ? (
                  <LinearConnection tool={tool} />
                ) : id === 'zendesk' ? (
                  <ZendeskConnection tool={tool} />
                ) : (
                  <ServiceConnection id={id} />
                ))}
            </Item>
          );
        })}
      </ol>
      {(answers.helpdesk === 'none' || answers.helpdesk === 'other') && (
        <p className="m-0 mt-3 text-meta text-ink-3">
          {answers.helpdesk === 'none'
            ? 'No helpdesk? Paste ticket text into a chat instead.'
            : 'Your helpdesk isn’t supported yet. Paste ticket text into a chat, or connect it as a custom API in Settings → Connections.'}
        </p>
      )}
      <div className="mt-6 flex items-center gap-3 rounded-item bg-sunk px-3 py-2.5">
        <span className="min-w-0 flex-1 text-meta text-ink-2">
          First question to try: <span className="text-ink">“{first}”</span>
        </span>
      </div>
      <div className="mt-6 flex items-center gap-3">
        <span className="flex-1 text-meta text-ink-3">
          {done} of {tools.length + 1} connected
        </span>
        <Button onClick={onDone} disabled={busy} autoFocus>
          {busy ? 'Saving…' : done ? 'Start using Supahelp' : 'Skip for now'}
        </Button>
      </div>
    </section>
  );
}

function Item({
  id,
  title,
  detail,
  lead,
  connected,
  status,
  open,
  disabled,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  detail: string;
  lead: ReactNode;
  connected: boolean;
  status?: ReactNode;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <li className="rounded-card bg-surface shadow-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`connect-${id}`}
        disabled={disabled}
        onClick={onToggle}
        className="no-drag flex w-full items-center gap-3 rounded-card px-3 py-2.5 text-left hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
      >
        {lead}
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          <span className="block text-meta text-ink-2">{detail}</span>
        </span>
        {connected ? <Pill tone="ok">Connected</Pill> : status}
        {!disabled && (
          <span className={`text-ink-3 ${open ? 'rotate-90' : ''}`}>
            <Icon name="chev" size={14} />
          </span>
        )}
      </button>
      {open && (
        <div
          id={`connect-${id}`}
          className="flex flex-col gap-4 border-t border-line px-4 pt-4 pb-4"
        >
          {children}
        </div>
      )}
    </li>
  );
}
