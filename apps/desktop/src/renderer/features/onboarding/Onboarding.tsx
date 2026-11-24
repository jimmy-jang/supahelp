import { useEffect, useState, type ReactNode } from 'react';
import type { OnboardingAnswers } from '../../../contracts/onboarding';
import { HELPDESKS } from '../../../contracts/onboarding';
import wordmark from '../../assets/brand/supahelp-dark-grey.svg';
import wordmarkDark from '../../assets/brand/supahelp-white.svg';
import { Button } from '../../components/Button';
import { ConnectionLogo } from '../../components/ConnectionLogo';
import { useAccount } from '../accounts/AccountProvider';
import { ConnectChecklist } from './ConnectChecklist';
import {
  helpdeskName,
  MODE_OPTIONS,
  PAIN_OPTIONS,
  ROLE_OPTIONS,
  SIZE_OPTIONS,
  SOURCE_OPTIONS,
  TOOL_GROUPS,
  toolName,
} from './options';

type Draft = Partial<OnboardingAnswers> & {
  tools: OnboardingAnswers['tools'];
  pains: OnboardingAnswers['pains'];
};
type StepId =
  | 'role'
  | 'mode'
  | 'company'
  | 'helpdesk'
  | 'tools'
  | 'pains'
  | 'source';
const OPTIONAL: StepId[] = ['tools', 'pains', 'source'];

// Shown once after sign-up: seven short questions, then the connect checklist.
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { snapshot, mutate, busy, error } = useAccount();
  const firstName = snapshot.view?.account.name.split(' ')[0] ?? '';
  const organization = snapshot.view?.organizations[0];
  const [draft, setDraft] = useState<Draft>({ tools: [], pains: [] });
  const [company, setCompany] = useState('');
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<OnboardingAnswers | undefined>(
    snapshot.view?.onboarding ?? undefined,
  );
  const steps: StepId[] = [
    'role',
    'mode',
    ...(draft.mode === 'team' ? (['company'] as const) : []),
    'helpdesk',
    'tools',
    'pains',
    'source',
  ];
  const id = steps[Math.min(step, steps.length - 1)];
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const valid =
    id === 'role'
      ? !!draft.role
      : id === 'mode'
        ? !!draft.mode
        : id === 'company'
          ? !!organization || !!company.trim()
          : id === 'helpdesk'
            ? !!draft.helpdesk
            : true;
  const last = step === steps.length - 1;

  const finish = async () => {
    const answers = { ...draft } as OnboardingAnswers;
    if (answers.mode !== 'team') delete answers.teamSize;
    if (answers.mode === 'team' && !organization) {
      const org = await mutate('onboarding-organization', (requestId) =>
        window.supahelp.createOrganization({
          context: snapshot.context,
          name: company.trim(),
          requestId,
        }),
      );
      if (!org) return;
    }
    const result = await mutate('onboarding-answers', () =>
      window.supahelp.saveOnboarding(answers),
    );
    if (result) setSaved(result.value.onboarding);
  };
  const next = () => {
    if (!valid || busy) return;
    if (last) void finish();
    else setStep((s) => s + 1);
  };
  const back = () => {
    if (!busy) setStep((s) => Math.max(0, s - 1));
  };
  const complete = async () => {
    const result = await mutate('onboarding-complete', () =>
      window.supahelp.completeOnboarding(),
    );
    if (result) onDone();
  };

  // Number keys pick a listed option; Enter continues; Escape goes back.
  useEffect(() => {
    if (saved) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = (e.target as HTMLElement).matches('input');
      if (e.key === 'Enter' && !(e.target as HTMLElement).matches('button')) {
        e.preventDefault();
        next();
      } else if (e.key === 'Escape' && !typing) back();
      else if (!typing && /^[1-9]$/.test(e.key))
        document
          .querySelectorAll<HTMLButtonElement>('[data-numbered]')
          [Number(e.key) - 1]?.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (saved)
    return (
      <Shell
        top={
          <Button
            kind="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(saved);
              setStep(5 + Number(saved.mode === 'team'));
              setSaved(undefined);
            }}
          >
            ‹ Back
          </Button>
        }
      >
        <ConnectChecklist
          answers={saved}
          workspace={
            saved.mode === 'team'
              ? organization?.name || company.trim()
              : undefined
          }
          onDone={() => void complete()}
          busy={busy}
        />
        {error && (
          <p role="alert" className="text-meta text-bad">
            {error}
          </p>
        )}
      </Shell>
    );

  return (
    <Shell
      top={
        <>
          {step > 0 && (
            <Button kind="ghost" onClick={back} disabled={busy}>
              ‹ Back
            </Button>
          )}
          <div className="flex flex-1 justify-center gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <i
                key={s}
                className={`h-[3px] w-6 rounded-full transition-colors duration-[180ms] motion-reduce:transition-none ${i <= step ? 'bg-ink' : 'bg-line'}`}
              />
            ))}
          </div>
          <span className="min-w-[60px] text-right text-meta text-ink-3">
            {step + 1} of {steps.length}
          </span>
        </>
      }
      foot={
        <>
          <span role="alert" className="flex-1 text-meta text-bad">
            {error}
          </span>
          {OPTIONAL.includes(id) && !last && (
            <Button kind="ghost" onClick={next} disabled={busy}>
              Skip
            </Button>
          )}
          <Button onClick={next} disabled={!valid || busy}>
            {busy ? 'Setting up…' : last ? 'Finish' : 'Continue'}
          </Button>
        </>
      }
    >
      {id === 'role' && (
        <Question
          title={
            firstName
              ? `Welcome, ${firstName}. What do you do?`
              : 'What do you do?'
          }
          lede="Supahelp shows different tools to support staff and to developers."
        >
          <Choices
            label="Your role"
            options={ROLE_OPTIONS}
            value={draft.role}
            onPick={(role) => set({ role })}
            numbered
          />
          {draft.role === 'other' && (
            <TextField
              label="Your role"
              value={draft.roleOther ?? ''}
              onChange={(roleOther) => set({ roleOther })}
            />
          )}
        </Question>
      )}
      {id === 'mode' && (
        <Question
          title="How will you use Supahelp?"
          lede="You can add a team later. Your personal workspace stays on this computer either way."
        >
          <Choices
            label="How you will use Supahelp"
            options={MODE_OPTIONS}
            value={draft.mode}
            onPick={(mode) => set({ mode })}
            numbered
          />
          {draft.mode === 'invited' && (
            <p className="m-0 mt-3 rounded-item bg-sunk px-3 py-2.5 text-meta text-ink-2">
              Open the invite link in your email. It adds you to your team’s
              workspace. Until then you can carry on in your personal workspace.
            </p>
          )}
        </Question>
      )}
      {id === 'company' && (
        <Question
          title={
            organization
              ? 'Tell us about your team'
              : 'Set up your team workspace'
          }
          lede={
            organization
              ? organization.name
              : 'Colleagues you invite will see this name.'
          }
        >
          {!organization && (
            <TextField
              label="Company name"
              value={company}
              onChange={setCompany}
              hint="Becomes your organization. You can rename it later."
              visibleLabel
            />
          )}
          <p className="m-0 mt-4 mb-2 font-medium">
            How many people work on support?
          </p>
          <Choices
            label="Support team size"
            options={SIZE_OPTIONS}
            value={draft.teamSize}
            onPick={(teamSize) => set({ teamSize })}
            chips
          />
        </Question>
      )}
      {id === 'helpdesk' && (
        <Question
          title="Which helpdesk do you use?"
          lede="We’ll connect it first, so you can paste a ticket link right away."
        >
          <Choices
            label="Helpdesk"
            options={HELPDESKS.map((h) => ({ id: h, label: helpdeskName(h) }))}
            value={draft.helpdesk}
            onPick={(helpdesk) => set({ helpdesk })}
            grid
          />
          {draft.helpdesk === 'other' && (
            <TextField
              label="Which helpdesk?"
              value={draft.helpdeskOther ?? ''}
              onChange={(helpdeskOther) => set({ helpdeskOther })}
            />
          )}
        </Question>
      )}
      {id === 'tools' && (
        <Question
          title="What else do you check on a ticket?"
          lede="Pick any. We’ll help you connect them next, in this order."
        >
          {TOOL_GROUPS.map((g) => (
            <div key={g.title} className="mt-4 first:mt-0">
              <p className="m-0 mb-2 text-label text-ink-3">{g.title}</p>
              <Choices
                label={g.title}
                options={g.ids.map((t) => ({ id: t, label: toolName(t) }))}
                values={draft.tools}
                onToggle={(tools) => set({ tools })}
                grid
              />
            </div>
          ))}
        </Question>
      )}
      {id === 'pains' && (
        <Question
          title="What slows your support work down most?"
          lede="Pick up to 2. Your first suggested question is based on this."
        >
          <Choices
            label="What slows you down"
            options={PAIN_OPTIONS}
            values={draft.pains}
            onToggle={(pains) => set({ pains })}
            max={2}
            numbered
          />
          {draft.pains.length === 2 && (
            <p className="m-0 mt-3 text-meta text-ink-3">
              That’s 2. Unpick one to change.
            </p>
          )}
        </Question>
      )}
      {id === 'source' && (
        <Question
          title="How did you hear about Supahelp?"
          lede="Helps a small team know what’s working."
        >
          <Choices
            label="Where you heard about Supahelp"
            options={SOURCE_OPTIONS}
            value={draft.source}
            onPick={(source) => set({ source })}
            chips
          />
          <TextField
            label="Anything specific? Optional"
            value={draft.sourceDetail ?? ''}
            onChange={(sourceDetail) => set({ sourceDetail })}
            placeholder="A post, a person, a community"
            visibleLabel
          />
        </Question>
      )}
    </Shell>
  );
}

function Shell({
  top,
  foot,
  children,
}: {
  top?: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* Window drag strip; leaves room for the traffic lights. */}
      <div className="drag flex h-[52px] flex-none items-center gap-2 pr-[calc(16px+var(--bar-right))] pl-[var(--bar-left-onboarding)]">
        {top}
      </div>
      <main className="flex min-h-0 flex-1 justify-center overflow-y-auto px-4 pt-6 pb-8">
        <div className="w-full max-w-[480px]">
          <picture>
            <source
              srcSet={wordmarkDark}
              media="(prefers-color-scheme: dark)"
            />
            <img
              src={wordmark}
              alt="Supahelp"
              className="mb-8 block h-5 w-auto"
            />
          </picture>
          {children}
        </div>
      </main>
      {foot && (
        <footer className="flex flex-none justify-center border-t border-line px-4 py-4">
          <div className="flex w-full max-w-[480px] items-center gap-2">
            {foot}
          </div>
        </footer>
      )}
    </div>
  );
}

function Question({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <section className="slide-in-line">
      <h1 className="m-0 text-heading font-semibold tracking-[-0.01em]">
        {title}
      </h1>
      <p className="mt-1 mb-6 text-ink-2">{lede}</p>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
  visibleLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  visibleLabel?: boolean;
}) {
  return (
    <label className="mt-3 flex flex-col gap-1">
      <span className={visibleLabel ? 'font-medium' : 'sr-only'}>{label}</span>
      <input
        autoFocus
        value={value}
        maxLength={label === 'Company name' ? 100 : 200}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="no-drag min-h-9 rounded-item bg-surface px-3 text-body text-ink shadow-1 outline-none placeholder:text-ink-3 focus:ring-[1.5px] focus:ring-ink"
      />
      {hint && <span className="text-meta text-ink-3">{hint}</span>}
    </label>
  );
}

type ChoiceProps<T extends string> = {
  label: string;
  options: { id: T; label: string; hint?: string }[];
  numbered?: boolean;
  grid?: boolean;
  chips?: boolean;
} & (
  | {
      value: T | undefined;
      onPick: (v: T) => void;
      values?: never;
      onToggle?: never;
      max?: never;
    }
  | {
      values: T[];
      onToggle: (v: T[]) => void;
      max?: number;
      value?: never;
      onPick?: never;
    }
);

function Choices<T extends string>(props: ChoiceProps<T>) {
  const { label, options, numbered, grid, chips } = props;
  const many = 'values' in props && props.values !== undefined;
  const isOn = (id: T) =>
    many ? props.values!.includes(id) : props.value === id;
  const full =
    many && props.max !== undefined && props.values!.length >= props.max;
  const pick = (id: T) => {
    if (!many) return props.onPick!(id);
    const list = props.values!;
    props.onToggle!(
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    );
  };
  const logo = grid;
  return (
    <div
      role={many ? 'group' : 'radiogroup'}
      aria-label={label}
      className={
        grid
          ? 'grid grid-cols-3 gap-2'
          : chips
            ? 'flex flex-wrap gap-2'
            : 'flex flex-col gap-2'
      }
    >
      {options.map((o, i) => {
        const on = isOn(o.id);
        return (
          <button
            key={o.id}
            type="button"
            role={many ? 'checkbox' : 'radio'}
            aria-checked={on}
            data-numbered={numbered ? '' : undefined}
            disabled={full && !on}
            onClick={() => pick(o.id)}
            className={`no-drag flex items-center gap-3 bg-surface text-left shadow-1 transition-shadow duration-[80ms] hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-45 ${chips ? 'rounded-chip px-2.5 py-1.5' : 'rounded-item px-3 py-2.5'} ${on ? 'ring-[1.5px] ring-ink hover:bg-surface' : ''}`}
          >
            {numbered && (
              <span
                aria-hidden="true"
                className={`grid size-5 flex-none place-items-center rounded-chip text-label ${on ? 'bg-ink text-on-ink' : 'bg-sunk text-ink-3'}`}
              >
                {i + 1}
              </span>
            )}
            {logo && (
              <span className="grid size-5 flex-none place-items-center rounded-chip text-label font-semibold text-ink-2">
                <ConnectionLogo
                  id={o.id}
                  className="size-5"
                  fallback={o.label[0]}
                />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{o.label}</span>
              {o.hint && (
                <span className="block text-meta text-ink-2">{o.hint}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
