export type TourTarget =
  | 'composer'
  | 'steps'
  | 'panel'
  | 'approval'
  | 'playbooks';
export type TourSide = 'top' | 'right' | 'bottom' | 'left';
export type Size = { width: number; height: number };
export type Rect = Size & { x: number; y: number };
export type CardPlacement = {
  x: number;
  y: number;
  side: TourSide | 'inside';
  arrow?: number;
};
export type TourStep = {
  n: number;
  target: TourTarget;
  side: TourSide;
  pad: number;
  radius: number;
  view: 'home' | 'chat';
  panel: boolean;
  title: string;
  body: string;
  tryIt?: string;
  doneIt?: string;
};
export type FinishKind = 'model' | 'helpdesk' | 'ready';
export type HelpdeskState = 'connected' | 'missing' | 'none';

export const TOUR_STEPS: TourStep[] = [
  {
    n: 1,
    target: 'composer',
    side: 'bottom',
    pad: 6,
    radius: 12,
    view: 'home',
    panel: false,
    title: 'Start with a ticket',
    body: 'Paste a ticket link or ask a question. We added a sample ticket for you.',
    tryIt: 'Click Send to run the sample.',
  },
  {
    n: 2,
    target: 'steps',
    side: 'bottom',
    pad: 5,
    radius: 12,
    view: 'chat',
    panel: false,
    title: 'See what Supahelp checked',
    body: 'It read the ticket, the Stripe charges and the New Relic logs before giving you an answer.',
    tryIt: 'Click this row to see each step.',
    doneIt: 'Every answer shows where it came from.',
  },
  {
    n: 3,
    target: 'panel',
    side: 'left',
    pad: 0,
    radius: 0,
    view: 'chat',
    panel: true,
    title: 'Keep the case in one place',
    body: 'Customer, problem, findings and next step stay in this document, ready to share with a developer.',
  },
  {
    n: 4,
    target: 'approval',
    side: 'right',
    pad: 6,
    radius: 12,
    view: 'chat',
    panel: true,
    title: 'You approve every change',
    body: 'Supahelp shows the exact amount, customer and how it will check the result. Nothing runs until you approve.',
    tryIt: 'Click Approve refund. No money moves.',
    doneIt: 'Sample approved. No refund was made.',
  },
  {
    n: 5,
    target: 'playbooks',
    side: 'right',
    pad: -2,
    radius: 12,
    view: 'chat',
    panel: true,
    title: 'Reuse what worked',
    body: 'Save a solved case as a Playbook, then attach it to the next similar ticket.',
  },
];

export const FINISH_COPY: Record<
  FinishKind,
  { title: string; body: string; action: string }
> = {
  model: {
    title: 'Connect an AI model to start',
    body: 'Supahelp needs a model before it can work on your real tickets.',
    action: 'Connect a model',
  },
  helpdesk: {
    title: 'Connect your helpdesk',
    body: 'Then you can paste a real ticket link and start your first case.',
    action: 'Connect helpdesk',
  },
  ready: {
    title: 'You’re ready for a real ticket',
    body: 'Paste a ticket link into the composer to start your first case.',
    action: 'Paste a ticket',
  },
};

// People who already have work never get the first-run tour on upgrade.
export function tourDecision({
  seen,
  loaded,
  hasWork,
  onHome,
}: {
  seen?: boolean;
  loaded: boolean;
  hasWork: boolean;
  onHome: boolean;
}): 'wait' | 'start' | 'retire' {
  if (seen !== false || !loaded) return 'wait';
  if (hasWork) return 'retire';
  return onHome ? 'start' : 'wait';
}

export function finishKind(
  modelReady: boolean,
  helpdesk: HelpdeskState,
): FinishKind {
  if (!modelReady) return 'model';
  return helpdesk === 'missing' ? 'helpdesk' : 'ready';
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, Math.max(low, high)));

// Beside the target when it fits; otherwise in its corner, clear of its left-side actions.
export function placeTourCard(
  target: Rect,
  card: Size,
  view: Size,
  preferred: TourSide,
): CardPlacement {
  const margin = 12;
  const gap = 14;
  const right = target.x + target.width;
  const bottom = target.y + target.height;
  const fits: Record<TourSide, boolean> = {
    bottom: bottom + gap + card.height <= view.height - margin,
    top: target.y - gap - card.height >= margin,
    right: right + gap + card.width <= view.width - margin,
    left: target.x - gap - card.width >= margin,
  };
  const side = ([preferred, 'bottom', 'top', 'right', 'left'] as const).find(
    (option) => fits[option],
  );
  if (!side)
    return {
      x: clamp(
        right - card.width - 16,
        margin,
        view.width - card.width - margin,
      ),
      y: clamp(
        bottom - card.height - 16,
        margin,
        view.height - card.height - margin,
      ),
      side: 'inside',
    };
  const centerX = clamp(
    target.x + target.width / 2 - card.width / 2,
    margin,
    view.width - card.width - margin,
  );
  const centerY = clamp(
    target.y + target.height / 2 - card.height / 2,
    margin,
    view.height - card.height - margin,
  );
  const x =
    side === 'right'
      ? right + gap
      : side === 'left'
        ? target.x - gap - card.width
        : centerX;
  const y =
    side === 'bottom'
      ? bottom + gap
      : side === 'top'
        ? target.y - gap - card.height
        : centerY;
  const arrow =
    side === 'top' || side === 'bottom'
      ? clamp(target.x + target.width / 2 - x - 6, 14, card.width - 26)
      : clamp(target.y + target.height / 2 - y - 6, 14, card.height - 26);
  return { x, y, side, arrow };
}
