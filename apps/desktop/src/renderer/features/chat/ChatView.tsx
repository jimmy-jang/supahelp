import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatOptions, Conversation } from '../../../contracts/chat';
import { Button } from '../../components/Button';
import { ConnectionLogo } from '../../components/ConnectionLogo';
import { Icon } from '../../components/Icon';
import { useAccount } from '../accounts/AccountProvider';
import {
  CaseUpdatedLine,
  PlaybookReadyCard,
  ResolveCard,
} from '../cases/ChatCards';
import { STATUS } from '../cases/status';
import {
  type Attached,
  type Case,
  type SectionKey,
  type Target,
} from '../cases/types';
import type { Playbook } from '../playbooks/types';
import { type AttachProps } from './AttachChips';
import { CatalogActions } from './CatalogActions';
import { Composer } from './Composer';
import { LinearActions } from './LinearActions';
import { stepLabel } from './step-label';
import type { Msg } from './types';
import { ZendeskActions } from './ZendeskActions';

// Plain text with **bold** spans.
const rich = (t: string) =>
  t.split('**').map((s, i) => (i % 2 ? <b key={i}>{s}</b> : s));

function ChatError({
  error,
  onOpenModels,
  className = '',
}: {
  error: string;
  onOpenModels?: () => void;
  className?: string;
}) {
  return (
    <p role="alert" className={`m-0 text-bad ${className}`}>
      {error}
      {onOpenModels && error.startsWith('Connect this model provider') && (
        <>
          {' '}
          <button
            type="button"
            className="text-ink underline underline-offset-2"
            onClick={onOpenModels}
          >
            Open Models settings
          </button>
        </>
      )}
    </p>
  );
}

export function Home({
  needsYou,
  inProgress,
  waiting,
  onSend,
  sending,
  error,
  notice,
  onOpenModels,
  cases,
  playbooks,
  onOpenAttached,
}: {
  cases: Case[];
  playbooks: Playbook[];
  onOpenAttached?: (t: Target) => void;
  needsYou: number;
  inProgress: number;
  waiting: number;
  onSend: (
    text: string,
    options?: ChatOptions,
    attachments?: string[],
    attached?: Attached,
  ) => void | Promise<boolean>;
  sending?: boolean;
  error?: string;
  notice?: string;
  onOpenModels?: () => void;
}) {
  const { snapshot: account } = useAccount();
  const name = account.view?.account.name.split(' ')[0];
  const [text, setText] = useState('');
  const [attached, setAttached] = useState<Attached>({ playbookIds: [] });
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const starters: [Parameters<typeof Icon>[0]['name'], string, string][] = [
    [
      'link',
      'Paste a Zendesk or Intercom link',
      'zendesk.com/agent/tickets/48230 can you look at this?',
    ],
    [
      'chart',
      'Check New Relic for errors',
      'Check New Relic for errors on checkout in the last 24 hours',
    ],
    [
      'user',
      'Look up a customer in Stripe',
      'Look up maria@brightway.studio in Stripe',
    ],
  ];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-12">
      <h1 className="text-[28px] font-semibold tracking-[-0.01em]">
        {greeting}
        {name ? `, ${name}` : ''}
      </h1>
      <p className="-mt-3 flex items-center gap-1.5 text-ink-2">
        <span className={needsYou ? 'font-medium text-attn' : undefined}>
          {needsYou} cases need you
        </span>
        ·<span>{inProgress} in progress</span>·<span>{waiting} waiting</span>
      </p>
      <Composer
        large
        disabled={sending}
        value={text}
        onChange={setText}
        onSend={(options, attachments) =>
          onSend(text, options, attachments, attached)
        }
        attach={{
          attached,
          cases,
          playbooks,
          onAttach: (target) =>
            setAttached((current) =>
              'caseId' in target
                ? { ...current, caseId: target.caseId }
                : {
                    ...current,
                    playbookIds: [
                      ...new Set([...current.playbookIds, target.playbookId]),
                    ],
                  },
            ),
          onDetach: (target) =>
            setAttached((current) =>
              'caseId' in target
                ? { ...current, caseId: undefined }
                : {
                    ...current,
                    playbookIds: current.playbookIds.filter(
                      (id) => id !== target.playbookId,
                    ),
                  },
            ),
        }}
        onOpenAttached={onOpenAttached}
        placeholder="Ask anything, or paste a ticket link…"
      />
      {error && (
        <ChatError
          error={error}
          onOpenModels={onOpenModels}
          className="max-w-[680px]"
        />
      )}
      {!error && notice && (
        <p role="status" className="m-0 text-meta text-ink-3">
          {notice}
        </p>
      )}
      <div className="flex max-w-[680px] flex-wrap justify-center gap-2">
        {starters.map(([icon, label, fill]) => (
          <button
            key={label}
            type="button"
            onClick={() => setText(fill)}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface py-[5px] pr-3 pl-2.5 text-[12.5px] text-ink-2 shadow-1 hover:text-ink"
          >
            <Icon name={icon} size={14} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Thread({
  chatId,
  documentControls,
  messages,
  approved = false,
  cases: caseTools,
  caseChanges,
  creatingCase,
  attachedCase,
  attachedPlaybooks,
  menu,
  onOpenAttached,
  onSend,
  onCreateCase,
  onKeepChat,
  onApprove,
  busy = false,
  stopping = false,
  step,
  onStop,
  error,
  notice,
  onOpenModels,
  options,
  preview = true,
}: {
  step?: Conversation['step'];
  chatId?: string;
  documentControls?: ReactNode;
  messages: Msg[];
  approved?: boolean;
  cases?: CaseTools;
  caseChanges?: {
    undo: (caseId: string, changeId: string) => void;
    view: (caseId: string, section: SectionKey) => void;
  };
  creatingCase?: boolean;
  attachedCase?: Case;
  attachedPlaybooks?: Playbook[];
  menu?: AttachProps;
  onOpenAttached?: (t: Target) => void;
  onSend: (
    text: string,
    options?: ChatOptions,
    attachments?: string[],
  ) => void | Promise<boolean>;
  onCreateCase?: () => void;
  onKeepChat?: () => void;
  onApprove?: () => void;
  busy?: boolean;
  stopping?: boolean;
  onStop?: () => void;
  error?: string;
  notice?: string;
  onOpenModels?: () => void;
  options?: ChatOptions;
  preview?: boolean;
}) {
  const [text, setText] = useState('');
  const transcript = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const log = transcript.current;
    const content = log?.firstElementChild;
    if (!log || !content) return;

    let previousBottom = 0;
    const followLatest = () => {
      const bottom = log.scrollHeight - log.clientHeight;
      // Compare with the previous layout so a growing reply doesn't unpin the view.
      if (
        bottom !== previousBottom &&
        Math.abs(log.scrollTop - previousBottom) <= 1
      )
        log.scrollTop = log.scrollHeight;
      previousBottom = bottom;
    };
    followLatest();
    const observer = new ResizeObserver(followLatest);
    observer.observe(log);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const col = 'mx-auto w-full max-w-[680px] px-7';
  const lastAi = messages.findLastIndex((m) => m.kind === 'ai');

  return (
    <>
      <div ref={transcript} className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${col} flex flex-col gap-4 py-6`}>
          {messages.map((m, i) => {
            switch (m.kind) {
              case 'you':
                return (
                  <div
                    key={i}
                    className="max-w-[80%] self-end rounded-[14px] bg-sunk px-3 py-2 break-words whitespace-pre-wrap select-text"
                  >
                    {m.text}
                  </div>
                );
              case 'ai':
                return (
                  <p
                    key={i}
                    className="m-0 whitespace-pre-wrap break-words select-text"
                  >
                    {m.text && rich(m.text)}
                    {busy &&
                      (!m.text || (step && i === lastAi)) &&
                      (() => {
                        const current = step && !stopping && stepLabel(step);
                        return (
                          <span
                            role="status"
                            className={`flex items-center gap-1.5 ${m.text ? 'mt-2' : ''}`}
                          >
                            {current && current.logo && (
                              <ConnectionLogo
                                id={current.logo}
                                className="size-3.5"
                                fallback={null}
                              />
                            )}
                            <span
                              className={stopping ? 'text-ink-3' : 'shimmer'}
                            >
                              {stopping
                                ? 'Stopping…'
                                : current
                                  ? current.text
                                  : `${options?.selection?.provider === 'chatgpt' ? 'ChatGPT' : options?.selection?.provider === 'claude' ? 'Claude' : 'Supa'} is replying…`}
                            </span>
                          </span>
                        );
                      })()}
                  </p>
                );
              case 'steps':
                return (
                  <button
                    key={i}
                    type="button"
                    className="flex items-center gap-1.5 self-start text-meta text-ink-3 hover:text-ink-2"
                  >
                    {m.tools.map((t) => (
                      <span
                        key={t}
                        className="grid size-[18px] place-items-center rounded-[5px] bg-surface text-[8.5px] font-bold text-ink-2 shadow-1"
                      >
                        <ConnectionLogo id={t} className="size-3" />
                      </span>
                    ))}
                    {m.text} ›
                  </button>
                );
              case 'created':
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 text-[11.5px] text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line"
                  >
                    {m.text}
                  </div>
                );
              case 'suggest':
                return (
                  <div
                    key={i}
                    className="flex flex-col gap-2.5 rounded-card bg-surface px-3.5 py-3 shadow-1"
                  >
                    <div>
                      <b>This looks like a support request from a customer.</b>
                      <p className="m-0 text-ink-2">
                        Create a case so it’s tracked under Cases, linked to the
                        ticket, and saved for next time.
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button onClick={onCreateCase} disabled={creatingCase}>
                        {creatingCase ? 'Checking…' : 'Create case'}
                      </Button>
                      <Button kind="ghost" onClick={onKeepChat}>
                        Keep as chat
                      </Button>
                    </div>
                  </div>
                );
              case 'refund':
                return (
                  <RefundCard
                    key={i}
                    approved={approved}
                    onApprove={onApprove}
                  />
                );
              case 'case-updated':
                return (
                  <CaseUpdatedLine
                    key={i}
                    section={m.section}
                    what={m.what}
                    note={m.note}
                    onUndo={() => caseTools?.onUndo(i)}
                    onView={() => caseTools?.onView(m.caseId, m.section)}
                  />
                );
              case 'case-change':
                return (
                  <CaseUpdatedLine
                    key={m.changeId}
                    section={m.section}
                    what={m.text}
                    note={m.note}
                    pending={m.pending}
                    onUndo={
                      m.section === 'resolution'
                        ? undefined
                        : () => caseChanges?.undo(m.caseId, m.changeId)
                    }
                    onView={() => caseChanges?.view(m.caseId, m.section)}
                  />
                );
              case 'resolve': {
                const c = caseTools?.attach.cases.find(
                  (x) => x.id === m.caseId,
                );
                const pb = caseTools?.attach.playbooks.find(
                  (p) => p.id === c?.doc.playbook?.id,
                );
                return (
                  <ResolveCard
                    key={i}
                    playbook={pb?.title}
                    ticket={c?.ticket ?? ''}
                    choice={m.choice}
                    onChoose={(choice) => caseTools?.onResolveChoice(i, choice)}
                  />
                );
              }
              case 'playbook-ready':
                return (
                  <PlaybookReadyCard
                    key={i}
                    title={
                      caseTools?.attach.playbooks.find(
                        (p) => p.id === m.playbookId,
                      )?.title ?? 'Playbook'
                    }
                    onOpen={() => caseTools?.onOpenPlaybook(m.playbookId)}
                  />
                );
            }
          })}
          {documentControls}
          {preview && (
            <p className="m-0 text-meta text-ink-3">
              Preview conversation. Replies and actions are simulated.
            </p>
          )}
          {error && <ChatError error={error} onOpenModels={onOpenModels} />}
          {notice && (
            <p role="status" className="m-0 text-meta text-ink-3">
              {notice}
            </p>
          )}
          {chatId && (
            <>
              <LinearActions chatId={chatId} />
              <ZendeskActions chatId={chatId} />
              <CatalogActions chatId={chatId} />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-none justify-center px-7 pb-5">
        <Composer
          value={text}
          busy={busy}
          onStop={stopping ? undefined : onStop}
          options={options}
          preview={preview}
          attach={caseTools?.attach}
          menu={menu}
          attachedCase={attachedCase}
          attachedPlaybooks={attachedPlaybooks}
          onOpenAttached={onOpenAttached}
          onChange={setText}
          onSend={(options, attachments) => {
            return Promise.resolve(onSend(text, options, attachments)).then(
              (accepted) => {
                if (accepted === false) return false;
                setText((current) => (current === text ? '' : current));
                const log = transcript.current;
                if (log) log.scrollTop = log.scrollHeight;
                return true;
              },
            );
          }}
          placeholder={
            caseTools?.attach.attached.caseId || attachedCase
              ? 'Ask about the attached case, or paste a ticket link…'
              : 'Ask a follow-up…'
          }
        />
      </div>
    </>
  );
}

// Preview-only callbacks for case documents in a chat.
export type CaseTools = {
  attach: AttachProps;
  onUndo: (index: number) => void;
  onView: (caseId: string, section: SectionKey) => void;
  onResolveChoice: (
    index: number,
    choice: 'update' | 'create' | 'later',
  ) => void;
  onOpenPlaybook: (id: string) => void;
};

function RefundCard({
  approved,
  onApprove,
}: {
  approved: boolean;
  onApprove?: () => void;
}) {
  const rows: [string, ReactNode][] = [
    [
      'Amount',
      <span className="text-body font-medium text-ink">$149.00 USD</span>,
    ],
    ['Charge', 'ch_3PqK8L2eZvKYlo2C9xQ'],
    ['Customer', 'Brightway Studio · cus_Nf7a'],
    ['Environment', 'Live'],
    ['Check after', 'Read refund status in Stripe'],
  ];
  return (
    <div className="flex flex-col gap-2.5 rounded-card bg-surface px-3.5 py-3 shadow-1">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full py-px pr-2 pl-1.5 text-[11px] font-medium ${approved ? STATUS.done.pill : STATUS.appr.pill}`}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {approved ? 'Done' : 'Needs approval'}
        </span>
        <b>Refund in Stripe</b>
      </div>
      <dl className="m-0 grid grid-cols-[100px_1fr] gap-x-3 gap-y-1 rounded-item bg-canvas px-3 py-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-meta text-ink-3">{k}</dt>
            <dd className="m-0 font-mono text-[11.5px] tabular-nums select-text">
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {approved ? (
        <p className="m-0 flex items-center gap-1.5 text-ok">
          <Icon name="check" size={14} />
          Refund re_3PqL9a… created. Stripe shows it as pending; written to
          Actions.
        </p>
      ) : (
        <div className="flex gap-1.5">
          <Button onClick={onApprove}>Approve refund</Button>
          <Button kind="secondary">Change</Button>
          <Button kind="ghost">Cancel</Button>
        </div>
      )}
    </div>
  );
}
