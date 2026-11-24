import type { ReactNode } from 'react';
import { Avatar } from '../../components/Avatar';
import { ConnectionLogo } from '../../components/ConnectionLogo';
import { Icon, type IconName } from '../../components/Icon';
import { shortcutLabel } from '../../components/shortcuts';
import type { TourStep } from './model';

const row = 'flex h-[30px] min-w-0 items-center gap-2 rounded-item px-2';
const heading = 'flex h-[26px] items-center px-2 text-meta text-ink-3';
const cta = 'ring-2 ring-busy ring-offset-2 ring-offset-surface';
const TICKET = 'zendesk.com/agent/tickets/48213 can you look at this?';

// A static copy of the app. Only the current step's control can be clicked.
export function SampleWorkspace({
  step,
  name,
  stepsOpen,
  approved,
  onSend,
  onToggleSteps,
  onApprove,
}: {
  step?: TourStep;
  name: string;
  stepsOpen: boolean;
  approved: boolean;
  onSend: () => void;
  onToggleSteps: () => void;
  onApprove: () => void;
}) {
  const chat = step?.view === 'chat';
  return (
    <div className="relative flex h-full select-none">
      <SampleSidebar chat={chat} name={name} />
      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        <header className="flex h-[52px] flex-none items-center pr-3.5 pl-[18px] font-medium">
          {chat && 'Charged twice in March'}
          {chat && (
            <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] text-ink-2">
              <Icon name="ext" size={14} />
              Open in Zendesk
            </span>
          )}
        </header>
        {chat ? (
          <SampleChat
            step={step}
            stepsOpen={stepsOpen}
            approved={approved}
            onToggleSteps={onToggleSteps}
            onApprove={onApprove}
          />
        ) : (
          <SampleHome step={step} name={name} onSend={onSend} />
        )}
      </div>
      {step?.panel && <SampleCase step={step} />}
    </div>
  );
}

function SampleSidebar({ chat, name }: { chat: boolean; name: string }) {
  return (
    <aside className="flex w-[272px] flex-none flex-col bg-sidebar">
      <div className="flex h-[52px] flex-none items-center justify-end gap-0.5 px-2.5 text-ink-2">
        <span className="grid size-7 place-items-center">
          <Icon name="bell" />
        </span>
        <span className="grid size-7 place-items-center">
          <Icon name="panel" />
        </span>
      </div>
      <div className="mx-2 mb-1 flex items-center gap-2 px-2 py-1.5 font-medium">
        <span className="grid size-5 place-items-center rounded-chip bg-surface text-label shadow-1">
          P
        </span>
        Personal
        <span className="ml-auto text-meta font-normal text-ink-3">
          This computer
        </span>
        <span className="text-ink-3">
          <Icon name="down" size={12} />
        </span>
      </div>
      <section className="flex flex-col px-2 pt-1 pb-2.5" aria-label="Chats">
        <h2 className={`${heading} m-0 font-normal`}>Chats</h2>
        <span className={`${row} ${chat ? '' : 'bg-surface shadow-1'}`}>
          <span className="text-ink-2">
            <Icon name="edit" />
          </span>
          New chat
        </span>
        {chat && (
          <span className={`${row} bg-surface shadow-1`}>
            Charged twice in March
          </span>
        )}
      </section>
      <div className="mb-1.5 h-px flex-none bg-line" />
      <section
        className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pt-1"
        aria-label="Cases"
      >
        <div className={heading}>
          <h2 className="m-0 flex-1 text-meta font-normal">Cases</h2>
          All cases <Icon name="down" size={12} />
        </div>
        <span className="mt-0.5 mb-1.5 flex h-7 flex-none items-center gap-2 rounded-item bg-field px-2 text-ink-3">
          <Icon name="search" size={14} />
          Search cases or customers
          <kbd className="ml-auto font-sans text-[10.5px]">
            {shortcutLabel('K')}
          </kbd>
        </span>
        <span className={row}>
          <span className="text-ink-2">
            <Icon name="edit" />
          </span>
          New case
        </span>
        {chat && (
          <span className="grid flex-none grid-cols-[7px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-item bg-surface px-2 py-1.5 shadow-1">
            <span className="size-[7px] rounded-full bg-attn" />
            <span className="truncate">Charged twice in March</span>
            <span className="text-[11px] text-ink-3">9:41</span>
            <span className="col-start-2 col-end-4 flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-attn">Needs approval</span> ·
                Brightway
              </span>
              Example
              <Avatar name="You" />
            </span>
          </span>
        )}
      </section>
      <div className="mb-1.5 h-px flex-none bg-line" />
      <section
        data-tour="playbooks"
        className="flex flex-none flex-col px-2 pt-1 pb-2.5"
        aria-label="Playbooks"
      >
        <h2 className={`${heading} m-0 font-normal`}>Playbooks</h2>
        <span className={row}>
          <span className="text-ink-2">
            <Icon name="edit" />
          </span>
          New Playbook
        </span>
        {chat && <span className={row}>Refund a duplicate charge</span>}
      </section>
      <footer className="flex h-12 flex-none items-center justify-between px-3 text-ink-3">
        <span className="flex items-center gap-1">
          <Avatar name={name || 'Personal'} size={22} />
          <Icon name="down" size={12} />
        </span>
        <Icon name="search" />
      </footer>
    </aside>
  );
}

function SampleHome({
  step,
  name,
  onSend,
}: {
  step?: TourStep;
  name: string;
  onSend: () => void;
}) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const active = step?.n === 1;
  const starters: [IconName, string][] = [
    ['link', 'Paste a Zendesk or Intercom link'],
    ['chart', 'Check New Relic for errors'],
    ['user', 'Look up a customer in Stripe'],
  ];
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-12 pb-[52px]">
      <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">
        {greeting}
        {name ? `, ${name}` : ''}
      </h1>
      <p className="-mt-3 mb-0 text-ink-2">
        0 cases need you · 0 in progress · 0 waiting
      </p>
      <div
        data-tour="composer"
        className="flex w-full max-w-[680px] flex-col gap-2.5 rounded-composer bg-surface px-4 pt-3.5 pb-2.5 shadow-2"
      >
        <div
          className={`min-h-[42px] text-[14px] ${active ? 'text-ink' : 'text-ink-3'}`}
        >
          {active ? TICKET : 'Ask anything, or paste a ticket link…'}
        </div>
        <ChipRow>
          <button
            type="button"
            aria-label="Send the sample ticket"
            tabIndex={active ? 0 : -1}
            onClick={active ? onSend : undefined}
            className={`no-drag ml-1 grid size-7 place-items-center rounded-full bg-ink text-on-ink ${active ? cta : 'cursor-default opacity-25'}`}
          >
            <Icon name="up" size={14} />
          </button>
        </ChipRow>
      </div>
      <div className="flex max-w-[680px] flex-wrap justify-center gap-2">
        {starters.map(([icon, label]) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface py-[5px] pr-3 pl-2.5 text-[12.5px] text-ink-2 shadow-1"
          >
            <Icon name={icon} size={14} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div className="-ml-1.5 flex items-center gap-1 text-[11.5px] text-ink-2">
      <span className="inline-flex items-center rounded-chip px-2 py-[3px]">
        <Icon name="plus" size={14} />
      </span>
      <Chip>Ask before every action</Chip>
      <span className="flex-1" />
      <Chip>
        <Icon name="claude" size={14} />
        Claude Sonnet 5.5
      </Chip>
      {children}
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-chip px-2 py-[3px] whitespace-nowrap">
      {children}
      <Icon name="down" size={12} />
    </span>
  );
}

function SampleChat({
  step,
  stepsOpen,
  approved,
  onToggleSteps,
  onApprove,
}: {
  step?: TourStep;
  stepsOpen: boolean;
  approved: boolean;
  onToggleSteps: () => void;
  onApprove: () => void;
}) {
  const stepsActive = step?.n === 2;
  const approveActive = step?.n === 4 && !approved;
  const receipt: [string, string][] = [
    ['Charge', 'ch_3PqK8L2eZvKYlo2C9xQ'],
    ['Customer', 'Brightway Studio · cus_Nf7a'],
    ['Environment', 'Live'],
    ['Check after', 'Read refund status in Stripe'],
  ];
  return (
    <>
      <div data-tour-scroll className="relative min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3.5 px-7 py-3">
          <div className="max-w-[85%] self-end rounded-[14px] bg-sunk px-3 py-2">
            {TICKET}
          </div>
          <button
            type="button"
            data-tour="steps"
            aria-expanded={stepsOpen}
            tabIndex={stepsActive ? 0 : -1}
            onClick={stepsActive ? onToggleSteps : undefined}
            className={`no-drag -mx-1.5 -my-1 flex flex-col gap-1.5 self-start rounded-item px-1.5 py-1 text-left text-meta text-ink-3 ${stepsActive ? 'hover:bg-hover' : 'cursor-default'}`}
          >
            <span className="flex items-center gap-1.5">
              {['zendesk', 'stripe', 'newrelic'].map((id) => (
                <span
                  key={id}
                  className="grid size-[18px] place-items-center rounded-[5px] bg-surface shadow-1"
                >
                  <ConnectionLogo id={id} className="size-3" />
                </span>
              ))}
              Checked 3 tools in 14s
              <span className={stepsOpen ? 'rotate-90' : ''}>
                <Icon name="chev" size={14} />
              </span>
            </span>
            {stepsOpen && (
              <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-ink-2">
                <b className="font-medium text-ink">Zendesk</b>
                <span>Read ticket #48213</span>
                <b className="font-medium text-ink">Stripe</b>
                <span>Found 2 charges, 41 s apart</span>
                <b className="font-medium text-ink">New Relic</b>
                <span>Found 1 checkout request</span>
              </span>
            )}
          </button>
          <p className="m-0">
            Brightway Studio (<Mono>cus_Nf7a</Mono>) has two{' '}
            <Mono>$149.00</Mono> charges 41 seconds apart on the same
            subscription. New Relic shows only one checkout request, so this
            isn’t a double-click. It looks like a webhook retry.
          </p>
          <div className="flex items-center gap-2.5 text-[11.5px] text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
            Case #412 created from this chat · attached
          </div>
          <div className="flex items-center gap-1.5 text-meta text-ink-3">
            <Icon name="doc" size={14} />
            Case updated · <b className="font-medium text-ink-2">
              Findings
            </b> +1
            · Ruled out: double-click
          </div>
          <p className="m-0">
            I’ve drafted the refund for the duplicate charge.
          </p>
          <div
            data-tour="approval"
            className="flex flex-col gap-2.5 rounded-card bg-surface px-3.5 py-3 shadow-1"
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full py-px pr-2 pl-1.5 text-[11px] font-medium ${approved ? 'bg-ok-soft text-ok' : 'bg-attn-soft text-attn'}`}
              >
                <span className="size-1.5 rounded-full bg-current" />
                {approved ? 'Sample approved' : 'Needs approval'}
              </span>
              <b>Refund in Stripe</b>
            </div>
            <dl className="m-0 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1 rounded-item bg-canvas px-3 py-2.5">
              <dt className="text-meta text-ink-3">Amount</dt>
              <dd className="m-0 font-mono text-body font-medium tabular-nums">
                $149.00 USD
              </dd>
              {receipt.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-meta text-ink-3">{label}</dt>
                  <dd className="m-0 font-mono text-[11.5px] tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {approved ? (
              <p className="m-0 flex items-center gap-1.5 text-ok">
                <Icon name="check" size={14} />
                Sample only. No refund was made.
              </p>
            ) : (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  tabIndex={approveActive ? 0 : -1}
                  onClick={approveActive ? onApprove : undefined}
                  className={`no-drag rounded-item bg-ink px-3 py-1.5 text-[12.5px] font-medium text-on-ink ${approveActive ? cta : 'cursor-default'}`}
                >
                  Approve refund
                </button>
                <span className="rounded-item bg-surface px-3 py-1.5 text-[12.5px] font-medium shadow-1">
                  Change
                </span>
                <span className="rounded-item px-3 py-1.5 text-[12.5px] font-medium text-ink-2">
                  Cancel
                </span>
              </div>
            )}
          </div>
          <p className="m-0 text-meta text-ink-3">
            Sample conversation. Replies and actions are simulated.
          </p>
        </div>
      </div>
      <div className="flex flex-none justify-center px-7 pt-2 pb-4">
        <div className="flex w-full max-w-[680px] flex-col gap-2.5 rounded-composer bg-surface px-4 pt-3 pb-2.5 shadow-2">
          <span className="inline-flex items-center gap-1.5 self-start rounded-chip bg-sunk px-2 py-[3px] text-meta">
            <Icon name="doc" size={14} />
            Case #412 · Charged twice in March
          </span>
          <div className="text-ink-3">
            Ask about the attached case, or paste a ticket link…
          </div>
          <ChipRow>
            <span className="ml-1 grid size-7 place-items-center rounded-full bg-ink text-on-ink opacity-25">
              <Icon name="up" size={14} />
            </span>
          </ChipRow>
        </div>
      </div>
    </>
  );
}

const Mono = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[11.5px] tabular-nums">{children}</span>
);

function SampleCase({ step }: { step: TourStep }) {
  // Below 1280px the panel covers the chat, so it closes after its own step.
  const narrow =
    step.n === 3
      ? 'max-[1279px]:absolute max-[1279px]:inset-y-0 max-[1279px]:right-0 max-[1279px]:left-[272px] max-[1279px]:w-auto'
      : 'max-[1279px]:hidden';
  const rows: [string, ReactNode][] = [
    ['Owner', 'You'],
    [
      'Customer',
      <>
        Brightway Studio <Mono>cus_Nf7a</Mono>{' '}
        <span className="text-meta text-ok">✓ Confirmed</span>
      </>,
    ],
    ['Ticket', <Mono>ZD #48213</Mono>],
    ['Playbook', 'Refund a duplicate charge'],
  ];
  return (
    <aside
      data-tour="panel"
      aria-label="Sample case 412"
      className={`flex w-[540px] flex-none flex-col overflow-hidden border-l border-line bg-surface ${narrow}`}
    >
      <header className="flex h-[52px] flex-none items-center gap-2 pr-3 pl-6 font-medium">
        <Icon name="doc" />
        Case #412
        <span className="text-meta font-normal text-ink-3">Example</span>
        <span className="inline-flex items-center gap-1 text-meta font-normal text-ok">
          <span className="size-1.5 rounded-full bg-current" />
          Synced
        </span>
        <span className="ml-auto flex items-center text-ink-2">
          {(['more', 'expand', 'close'] as const).map((icon) => (
            <span key={icon} className="grid size-7 place-items-center">
              <Icon name={icon} />
            </span>
          ))}
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] px-7 pt-1 pb-6">
        <dl className="m-0 grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-b border-line pb-4">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-3">{label}</dt>
              <dd className="m-0">{value}</dd>
            </div>
          ))}
        </dl>
        <CaseSection n={1} title="Summary">
          Brightway Studio was charged $149.00 twice on its 3 March renewal. The
          second charge came from a Stripe webhook retry. A refund is drafted
          and waiting for approval.
        </CaseSection>
        <CaseSection n={2} title="Problem">
          <dl className="m-0 grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <dt className="text-ink-3">Reported</dt>
            <dd className="m-0">“I was charged twice for my renewal.”</dd>
            <dt className="text-ink-3">Observed</dt>
            <dd className="m-0">
              Two $149.00 charges 41 s apart on the same subscription
            </dd>
            <dt className="text-ink-3">Affected</dt>
            <dd className="m-0">3 annual customers renewing since 2 Mar</dd>
          </dl>
        </CaseSection>
        <CaseSection n={3} title="Findings">
          <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5">
            <span className="justify-self-start rounded-full bg-ok-soft px-2 py-px text-[11px] font-medium text-ok">
              Confirmed
            </span>
            <span>Two invoices created 41 s apart for one renewal</span>
            <span className="col-start-2 font-mono text-[11.5px] text-ink-3">
              Stripe in_1Qa…a1, in_1Qa…a2
            </span>
            <span className="mt-1.5 justify-self-start rounded-full bg-sunk px-2 py-px text-[11px] font-medium text-ink-2">
              Ruled out
            </span>
            <span className="mt-1.5">Customer double-clicked checkout</span>
            <span className="col-start-2 font-mono text-[11.5px] text-ink-3">
              New Relic: 1 request in the window
            </span>
          </div>
        </CaseSection>
        <CaseSection n={4} title="Next step">
          Approve the refund, then decide whether to bring in a developer for
          the retry handler.
        </CaseSection>
      </div>
    </aside>
  );
}

function CaseSection({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="m-0 text-body font-semibold">
        <span className="mr-3 font-normal text-ink-3">{n}</span>
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}
