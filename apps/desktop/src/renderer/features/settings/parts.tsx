import { useState, type ReactNode } from 'react';
import { ConnectionLogo } from '../../components/ConnectionLogo';
import { Icon, type IconName } from '../../components/Icon';

// Building blocks for settings pages: a titled group of rows inside a card.

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end gap-3">
      <div className="flex-1">
        <h1 className="m-0 text-heading font-semibold tracking-[-0.01em]">
          {title}
        </h1>
        {description && <p className="mt-1 mb-0 text-ink-2">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Group({
  label,
  aside,
  children,
}: {
  label?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      {label && (
        <h2 className="m-0 flex items-center px-0.5 text-meta font-normal text-ink-3">
          <span className="flex-1">{label}</span>
          {aside}
        </h2>
      )}
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface ring-1 ring-line">
      {children}
    </div>
  );
}

export function Row({
  title,
  description,
  lead,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 ${description ? 'min-h-[54px] py-[11px]' : 'min-h-[42px] py-2'}`}
    >
      {lead}
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {description && (
          <div className="text-meta leading-[1.45] text-ink-3">
            {description}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// Square badge in front of a row: a tool's initials or an icon.
export function Lead({ text, icon }: { text?: string; icon?: IconName }) {
  return (
    <span className="grid size-8 flex-none place-items-center rounded-item bg-sunk text-[11px] font-bold text-ink-2">
      {icon ? <Icon name={icon} size={15} /> : text}
    </span>
  );
}

export function ToolTile({
  id,
  abbr,
  large,
  needsYou,
}: {
  id: string;
  abbr: string;
  large?: boolean;
  needsYou?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative grid flex-none place-items-center bg-surface font-semibold text-ink-2 shadow-1 ${large ? 'size-14 rounded-card text-[16px]' : 'size-9 rounded-[9px] text-[11px]'}`}
    >
      <ConnectionLogo
        id={id}
        className={large ? 'size-8' : 'size-5'}
        fallback={abbr}
      />
      {needsYou && (
        <span className="absolute -top-0.5 -right-0.5 size-[9px] rounded-full bg-attn ring-2 ring-surface" />
      )}
    </span>
  );
}

export type Ability = { label: string; code?: string };

const abilityLabels: Record<string, string> = {
  search_tickets: 'Find tickets',
  get_ticket: 'Read ticket details',
  list_comments: 'Read public replies and internal notes',
  reply_to_ticket: 'Reply to the customer',
  add_internal_note: 'Add an internal note',
  update_ticket: 'Change ticket status',
};

// What a connection can read and change, in plain words; `code` is the tool's own name.
export function Abilities({
  name,
  reads,
  changes,
  children,
}: {
  name: string;
  reads: Ability[];
  changes: Ability[];
  children?: ReactNode;
}) {
  const list = (items: Ability[]) => (
    <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
      {items.map((a) => (
        <li
          key={a.code ?? a.label}
          className="flex flex-col rounded-item bg-sunk px-3 py-2"
        >
          <span className="font-medium">{a.label}</span>
          {a.code && (
            <code className="font-mono text-[11px] text-ink-3">{a.code}</code>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <More label={`What it can do · ${reads.length + changes.length}`}>
      <Group label={`Can read · ${reads.length}`}>
        {reads.length ? (
          list(reads)
        ) : (
          <Note>No read operations are available.</Note>
        )}
      </Group>
      <Group
        label={
          changes.length
            ? `Can change · ${changes.length} · always asks you first`
            : 'Can change'
        }
      >
        {changes.length ? (
          list(changes)
        ) : (
          <Note>Nothing. Supahelp only reads from {name}.</Note>
        )}
      </Group>
      {children}
    </More>
  );
}

// Live tool list → abilities. Tool names are snake_case ("list_issues").
export function abilitiesFrom(
  tools: { name: string; readOnly: boolean }[],
  readOnly: boolean,
): Ability[] {
  return tools
    .filter((tool) => tool.readOnly === readOnly)
    .map((tool) => {
      const words = tool.name.replace(/[_-]+/g, ' ').trim();
      return {
        label:
          abilityLabels[tool.name] ??
          words.charAt(0).toUpperCase() + words.slice(1),
        code: tool.name,
      };
    });
}

export function Tag({
  children,
  mono,
}: {
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <span
      className={`rounded-chip bg-sunk px-[7px] py-px whitespace-nowrap text-ink-2 ${mono ? 'font-mono text-[11px]' : 'text-[11.5px]'}`}
    >
      {children}
    </span>
  );
}

const pillTones = {
  ok: 'bg-ok-soft text-ok',
  attn: 'bg-attn-soft text-attn',
};
export function Pill({
  tone,
  children,
}: {
  tone: keyof typeof pillTones;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex flex-none items-center gap-1.5 rounded-full py-px pr-2 pl-1.5 text-[11px] font-medium whitespace-nowrap ${pillTones[tone]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex gap-2 px-0.5 text-meta text-ink-2">
      <span className="mt-px text-ink-3">
        <Icon name="info" size={14} />
      </span>
      {children}
    </p>
  );
}

// Secondary detail, closed until the user asks for it.
export function More({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 px-0.5 text-meta text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="text-ink-3 transition-transform group-open:rotate-90">
          <Icon name="chev" size={12} />
        </span>
        {label}
      </summary>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </details>
  );
}

// A value the user pastes elsewhere, like a redirect address.
export function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-1 flex items-center gap-2 rounded-item bg-sunk px-2.5 py-1.5">
      <code className="min-w-0 flex-1 font-mono text-[11.5px] break-all text-ink select-text">
        {text}
      </code>
      <button
        type="button"
        aria-label="Copy"
        className="flex-none text-ink-3 hover:text-ink"
        onClick={() =>
          void navigator.clipboard.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
    </span>
  );
}

// Provider instructions are prose; one sentence per step reads faster.
export const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);

// Numbered setup steps, folded. Shared by Settings and the onboarding checklist.
export function SetupGuide({ steps }: { steps: ReactNode[] }) {
  if (!steps.length) return null;
  return (
    <More label="How to set up">
      <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-meta text-ink-2 marker:text-ink-3">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </More>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="min-w-7 rounded-chip bg-sunk px-2 py-0.5 text-center font-sans text-meta text-ink-2">
      {children}
    </kbd>
  );
}

export const mono = (text: string) => (
  <span className="font-mono text-[11.5px]">{text}</span>
);
