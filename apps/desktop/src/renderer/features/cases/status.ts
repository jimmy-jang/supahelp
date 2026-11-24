import type { StatusKey } from './types';

// Statuses from DESIGN.md. Amber ("attn") only for the two that need you.
export const STATUS: Record<
  StatusKey,
  { label: string; dot: string; text: string; pill: string; needsYou?: boolean }
> = {
  inv: {
    label: 'Investigating',
    dot: 'bg-busy',
    text: 'text-busy',
    pill: 'bg-busy-soft text-busy',
  },
  run: {
    label: 'Running',
    dot: 'bg-busy animate-pulse',
    text: 'text-busy',
    pill: 'bg-busy-soft text-busy',
  },
  appr: {
    label: 'Needs approval',
    dot: 'bg-attn',
    text: 'text-attn',
    pill: 'bg-attn-soft text-attn',
    needsYou: true,
  },
  unk: {
    label: 'Outcome unknown',
    dot: 'ring-[1.5px] ring-inset ring-attn',
    text: 'text-attn',
    pill: 'ring-1 ring-inset ring-attn text-attn',
    needsYou: true,
  },
  wcust: {
    label: 'Waiting on customer',
    dot: 'bg-ink-3',
    text: 'text-ink-3',
    pill: 'bg-sunk text-ink-2',
  },
  weng: {
    label: 'Waiting on engineering',
    dot: 'bg-ink-3',
    text: 'text-ink-3',
    pill: 'bg-sunk text-ink-2',
  },
  done: {
    label: 'Resolved',
    dot: 'bg-ok',
    text: 'text-ok',
    pill: 'bg-ok-soft text-ok',
  },
  fail: {
    label: 'Failed',
    dot: 'bg-bad',
    text: 'text-bad',
    pill: 'bg-bad-soft text-bad',
  },
};
