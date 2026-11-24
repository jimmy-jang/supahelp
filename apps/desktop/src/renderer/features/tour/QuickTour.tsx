import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import mark from '../../assets/brand/supahelp-mark.svg';
import { Button } from '../../components/Button';
import { ConnectionLogo } from '../../components/ConnectionLogo';
import { Icon } from '../../components/Icon';
import { connectionCatalog } from '../../fixtures/connections';
import { useAccount } from '../accounts/AccountProvider';
import { helpdeskName } from '../onboarding/options';
import { useConnections } from '../settings/useConnections';
import { useZendesk } from '../settings/useZendesk';
import {
  FINISH_COPY,
  finishKind,
  placeTourCard,
  TOUR_STEPS,
  type CardPlacement,
  type FinishKind,
  type HelpdeskState,
  type Rect,
} from './model';
import { SampleWorkspace } from './SampleWorkspace';

export type TourOutcome = 'skip' | FinishKind;
type Geometry = {
  spot: Rect & { radius: number; visible: boolean };
  card: CardPlacement | { x: number; y: number; side: 'center'; arrow?: never };
};

const FINISH = TOUR_STEPS.length + 1;
const PATH = ['Ticket', 'Investigate', 'Case', 'Approve', 'Reuse'];

function useTourSetup() {
  const { snapshot } = useAccount();
  const catalog = useConnections().snapshot?.connections;
  const zendesk = useZendesk().snapshot?.state;
  const [modelReady, setModelReady] = useState(false);
  useEffect(() => {
    let active = true;
    void window.supahelp
      .getModelsSettings()
      .then((reply) => {
        if (active && reply.ok)
          setModelReady(reply.value.providers.some((p) => p.state === 'ready'));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const picked = snapshot.view?.onboarding?.helpdesk;
  const isConnected = (id: string) =>
    id === 'zendesk'
      ? zendesk === 'connected'
      : catalog?.find((tool) => tool.id === id)?.state === 'connected';
  const named = picked && picked !== 'none' && picked !== 'other';
  const connected = named
    ? isConnected(picked)
    : connectionCatalog
        .filter((tool) => tool.group === 'helpdesk')
        .some((tool) => isConnected(tool.id));
  const helpdesk: HelpdeskState =
    picked === 'none' || picked === 'other'
      ? 'none'
      : connected
        ? 'connected'
        : 'missing';
  return {
    modelReady,
    helpdesk,
    helpdeskId: named ? picked : undefined,
    helpdeskLabel: named ? helpdeskName(picked) : 'Helpdesk',
    kind: finishKind(modelReady, helpdesk),
  };
}

export function QuickTour({
  name,
  onClose,
}: {
  name: string;
  onClose: (outcome: TourOutcome) => void;
}) {
  const root = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [index, setIndex] = useState(0);
  const [tried, setTried] = useState<ReadonlySet<number>>(new Set());
  const [geometry, setGeometry] = useState<Geometry>();
  const setup = useTourSetup();
  const step = index > 0 && index < FINISH ? TOUR_STEPS[index - 1] : undefined;
  const finishing = index === FINISH;
  const next = () => setIndex((i) => Math.min(i + 1, FINISH));
  const back = () => setIndex((i) => Math.max(i - 1, 0));

  useEffect(() => {
    const element = root.current!;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  const measure = useCallback(() => {
    const dialog = root.current;
    const card = cardRef.current;
    if (!dialog || !card) return;
    const view = { width: dialog.clientWidth, height: dialog.clientHeight };
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    const target =
      step && dialog.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!step || !target) {
      setGeometry({
        spot: {
          x: view.width / 2,
          y: view.height / 2,
          width: 0,
          height: 0,
          radius: 12,
          visible: false,
        },
        card: {
          x: (view.width - size.width) / 2,
          y: Math.max(12, (view.height - size.height) / 2),
          side: 'center',
        },
      });
      return;
    }
    const scroller = target.closest<HTMLElement>('[data-tour-scroll]');
    if (scroller)
      scroller.scrollTop =
        target.offsetTop - (scroller.clientHeight - target.offsetHeight) / 2;
    const place = () => {
      const box = target.getBoundingClientRect();
      const x = Math.max(0, box.left - step.pad);
      const y = Math.max(0, box.top - step.pad);
      const spot = {
        x,
        y,
        width: Math.min(view.width - x, box.width + step.pad * 2),
        height: Math.min(view.height - y, box.height + step.pad * 2),
      };
      return { spot, card: placeTourCard(spot, size, view, step.side) };
    };
    let placed = place();
    // In a short window, scroll the target down so the card can sit above it.
    if (scroller && placed.card.side === 'inside') {
      scroller.scrollTop =
        target.offsetTop +
        target.offsetHeight +
        step.pad -
        scroller.clientHeight;
      placed = place();
    }
    setGeometry({
      spot: { ...placed.spot, radius: step.radius, visible: true },
      card: placed.card,
    });
  }, [step]);

  useLayoutEffect(measure, [measure, tried, setup.kind, setup.helpdesk]);
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(root.current!);
    observer.observe(cardRef.current!);
    return () => observer.disconnect();
  }, [measure, index]);
  // The clicked control can disappear, so return focus to the card's main action.
  useEffect(() => {
    cardRef.current
      ?.querySelector<HTMLElement>('[data-tour-actions] button:last-child')
      ?.focus({ preventScroll: true });
  }, [index, tried]);

  const markTried = (n: number) => setTried((set) => new Set(set).add(n));
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'ArrowRight' && !finishing) {
      event.preventDefault();
      next();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      back();
    } else if (event.key === 'Tab') {
      const controls = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>('button'),
      ).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (
        !first ||
        (event.shiftKey
          ? document.activeElement === first
          : document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
  };
  const copy = FINISH_COPY[setup.kind];
  const wide = !step;
  const side = geometry?.card.side;

  return createPortal(
    <dialog
      ref={root}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose('skip');
      }}
      // Chromium can close without a cancel event after repeated Esc presses.
      onClose={(event) => {
        if (!event.currentTarget.open) onClose('skip');
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 h-dvh max-h-none w-dvw max-w-none overflow-hidden border-0 bg-canvas p-0 text-body text-ink backdrop:bg-transparent [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-busy"
    >
      <SampleWorkspace
        step={step}
        name={name}
        stepsOpen={tried.has(2)}
        approved={tried.has(4)}
        onSend={next}
        onToggleSteps={() =>
          setTried((set) => {
            const copy = new Set(set);
            if (!copy.delete(2)) copy.add(2);
            return copy;
          })
        }
        onApprove={() => markTried(4)}
      />
      <div className="drag absolute inset-x-0 top-0 z-[5] h-[52px]" />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute z-10 shadow-[0_0_0_9999px_var(--tour-dim)] transition-[left,top,width,height] duration-[180ms] ease-in-out ${geometry?.spot.visible ? 'outline-[1.5px] outline-white/70 outline-solid' : ''}`}
        style={{
          left: geometry?.spot.x ?? 0,
          top: geometry?.spot.y ?? 0,
          width: geometry?.spot.width ?? 0,
          height: geometry?.spot.height ?? 0,
          borderRadius: geometry?.spot.radius ?? 12,
        }}
      />
      <div
        key={index}
        ref={cardRef}
        data-tour-card
        className={`no-drag slide-in-line absolute z-20 flex flex-col rounded-card bg-surface shadow-2 ring-[0.5px] ring-line ${wide ? 'w-[420px] gap-2 p-6' : 'w-[340px] gap-1.5 p-4'} ${geometry ? '' : 'invisible'}`}
        style={{ left: geometry?.card.x ?? 0, top: geometry?.card.y ?? 0 }}
      >
        {side && side !== 'center' && side !== 'inside' && (
          <span
            aria-hidden="true"
            className="absolute size-3 rotate-45 bg-surface"
            style={
              side === 'top' || side === 'bottom'
                ? {
                    left: geometry?.card.arrow,
                    [side === 'bottom' ? 'top' : 'bottom']: -5,
                  }
                : {
                    top: geometry?.card.arrow,
                    [side === 'right' ? 'left' : 'right']: -5,
                  }
            }
          />
        )}
        {index === 0 && (
          <>
            <img
              src={mark}
              alt=""
              className="mb-2 block size-9 rounded-[9px] shadow-1"
            />
            <h2
              id={titleId}
              className="m-0 text-heading leading-[1.3] font-semibold tracking-[-0.01em]"
            >
              Welcome to Supahelp
            </h2>
            <p id={bodyId} className="m-0 text-ink-2">
              Follow one sample case from ticket to fix. It takes about a
              minute.
            </p>
            <ol
              aria-label="Tour steps"
              className="relative mt-2.5 mb-1.5 grid list-none grid-cols-5 p-0 before:absolute before:inset-x-[10%] before:top-2.5 before:h-px before:bg-line"
            >
              {PATH.map((label, i) => (
                <li
                  key={label}
                  className="relative flex flex-col items-center gap-[5px] text-label text-ink-2"
                >
                  <span className="grid size-5 place-items-center rounded-full bg-sunk text-[10.5px] font-semibold text-ink shadow-[0_0_0_3px_var(--surface)]">
                    {i + 1}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
            <p className="m-0 flex items-center gap-2 rounded-item bg-sunk px-2.5 py-2 text-meta text-ink-2">
              <Icon name="shield" size={14} />
              Uses sample data. Nothing in your tools changes.
            </p>
            <div data-tour-actions className="-ml-2 mt-3 flex items-center">
              <Button kind="ghost" onClick={() => onClose('skip')}>
                Skip for now
              </Button>
              <span className="flex-1" />
              <Button onClick={next}>Start tour</Button>
            </div>
          </>
        )}
        {step && (
          <>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-meta text-ink-3 tabular-nums">
                {step.n} of {TOUR_STEPS.length}
              </span>
              <span className="flex gap-1" aria-hidden="true">
                {TOUR_STEPS.map((s) => (
                  <i
                    key={s.n}
                    className={`h-[3px] w-6 rounded-full ${s.n <= step.n ? 'bg-ink' : 'bg-line'}`}
                  />
                ))}
              </span>
            </div>
            <h2
              id={titleId}
              className="m-0 text-title leading-[1.35] font-semibold"
            >
              {step.title}
            </h2>
            <p id={bodyId} className="m-0 text-ink-2">
              {step.body}
            </p>
            {step.tryIt &&
              (tried.has(step.n) && step.doneIt ? (
                <p className="m-0 mt-1.5 flex items-center gap-2 rounded-item bg-ok-soft px-2.5 py-2 text-meta text-ok">
                  <Icon name="check" size={14} />
                  {step.doneIt}
                </p>
              ) : (
                <p className="m-0 mt-1.5 flex gap-2 rounded-item bg-sunk px-2.5 py-2 text-meta text-ink-2">
                  <b className="flex-none font-medium text-ink">Try it</b>
                  {step.tryIt}
                </p>
              ))}
            <div
              data-tour-actions
              className="-ml-2 mt-2.5 flex items-center gap-1.5"
            >
              <Button kind="ghost" onClick={() => onClose('skip')}>
                Skip tour
              </Button>
              <span className="flex-1" />
              <Button kind="secondary" onClick={back}>
                Back
              </Button>
              <Button onClick={next}>
                {step.n === TOUR_STEPS.length ? 'Finish' : 'Next'}
              </Button>
            </div>
          </>
        )}
        {finishing && (
          <>
            <p className="m-0 flex items-center gap-[5px] text-meta font-medium text-ok">
              <Icon name="check" size={14} />
              Tour complete
            </p>
            <h2
              id={titleId}
              className="m-0 text-heading leading-[1.3] font-semibold tracking-[-0.01em]"
            >
              {copy.title}
            </h2>
            <p id={bodyId} className="m-0 text-ink-2">
              {copy.body}
            </p>
            <ul className="m-0 mt-2 list-none border-t border-line p-0">
              <SetupRow
                icon={<Icon name="claude" size={16} />}
                label="AI model"
                connected={setup.modelReady}
              />
              {setup.helpdesk !== 'none' && (
                <SetupRow
                  icon={
                    setup.helpdeskId ? (
                      <ConnectionLogo
                        id={setup.helpdeskId}
                        className="size-4"
                      />
                    ) : (
                      <Icon name="plug" size={16} />
                    )
                  }
                  label={setup.helpdeskLabel}
                  connected={setup.helpdesk === 'connected'}
                />
              )}
            </ul>
            <p className="m-0 mt-1 text-meta text-ink-3">
              Replay this tour anytime from your account menu.
            </p>
            <div
              data-tour-actions
              className="-ml-2 mt-3 flex items-center gap-1.5"
            >
              <Button kind="ghost" onClick={back}>
                Back
              </Button>
              <span className="flex-1" />
              <Button kind="secondary" onClick={() => onClose('skip')}>
                Not now
              </Button>
              <Button onClick={() => onClose(setup.kind)}>{copy.action}</Button>
            </div>
          </>
        )}
      </div>
    </dialog>,
    document.body,
  );
}

function SetupRow({
  icon,
  label,
  connected,
}: {
  icon: React.ReactNode;
  label: string;
  connected: boolean;
}) {
  return (
    <li className="flex items-center gap-2.5 border-b border-line py-2">
      <span className="grid size-5 flex-none place-items-center">{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full py-px pr-2 pl-1.5 text-[11px] font-medium ${connected ? 'bg-ok-soft text-ok' : 'bg-sunk text-ink-2'}`}
      >
        <span className="size-1.5 rounded-full bg-current" />
        {connected ? 'Connected' : 'Not connected'}
      </span>
    </li>
  );
}

export function TourClosedNote({
  onReplay,
  onDismiss,
}: {
  onReplay: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setTimeout(onDismiss, 10_000);
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    window.addEventListener('mousedown', onDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onDismiss]);
  return (
    <div
      ref={ref}
      role="status"
      className="no-drag slide-in-line fixed bottom-14 left-3 z-[5] flex w-[312px] items-start gap-2 rounded-card bg-surface py-2.5 pr-2 pl-3 shadow-2 ring-[0.5px] ring-line"
    >
      <span className="min-w-0 flex-1">
        <b className="block font-semibold">Tour closed</b>
        <span className="block text-meta text-ink-2">
          Replay it anytime from your account menu.
        </span>
      </span>
      <Button kind="secondary" onClick={onReplay}>
        Replay
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="grid size-7 flex-none place-items-center rounded-chip text-ink-3 hover:bg-hover hover:text-ink"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
