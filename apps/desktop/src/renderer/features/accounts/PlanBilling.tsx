import { formatDate } from '../../app/formatDate';
import { useState, type ReactNode } from 'react';
import type { OrganizationView } from '../../../contracts/accounts';
import { Button } from '../../components/Button';
import { Card, Group, Note, PageHeader, Row } from '../settings/parts';
import { useAccount } from './AccountProvider';
import {
  BillingSettings,
  TeamOffer,
  money,
  type Intent,
} from './BillingSettings';

const DAY = 86_400_000;
// Billing-for choice that means "set up another organization".
const NEW = 'new';

type Tone = 'ok' | 'busy' | 'attn' | 'grey' | 'bad';
const tones: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  busy: 'bg-busy-soft text-busy',
  attn: 'bg-attn-soft text-attn',
  grey: 'bg-sunk text-ink-2',
  bad: 'bg-bad-soft text-bad',
};
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[11.5px] font-normal whitespace-nowrap ${tones[tone]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

function Facts({ items }: { items: [string, string][] }) {
  return (
    <dl className="m-0 grid grid-cols-1 gap-px overflow-hidden rounded-item bg-line sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="bg-sunk px-2.5 py-2">
          <dt className="text-[11px] text-ink-3">{k}</dt>
          <dd className="m-0 font-mono text-[12px] tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CurrentPlan({
  organization,
  owner,
}: {
  organization?: OrganizationView;
  owner: boolean;
}) {
  if (!organization || organization.access === 'setup')
    return (
      <PlanCard
        over={organization ? organization.name : 'Personal workspace'}
        title="Free"
        pill={<Pill tone="grey">Current</Pill>}
        text={
          organization
            ? `Local work on this computer. ${organization.name} is set up but Team isn't active yet.`
            : 'Local work on this computer with your own model connection. Nothing is shared.'
        }
      />
    );
  const o = organization;
  const left = o.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(o.expiresAt) - Date.now()) / DAY))
    : null;
  const seats: [string, string] = [
    'Seats',
    `${o.assigned} of ${o.capacity} used${o.reserved ? ` · ${o.reserved} invited` : ''}`,
  ];
  const trial = o.source === 'trial';
  const pill =
    o.access === 'locked' ? (
      <Pill tone="bad">Locked</Pill>
    ) : o.access === 'read-only' ? (
      <Pill tone="attn">Read-only</Pill>
    ) : trial && left !== null ? (
      <Pill tone="busy">
        {left} day{left === 1 ? '' : 's'} left
      </Pill>
    ) : (
      <Pill tone="ok">{o.source === 'pilot' ? 'Pilot' : 'Active'}</Pill>
    );
  const facts: [string, string][] = [seats];
  if (o.source === 'paid' && o.access === 'active')
    facts.push(['Monthly', money(14900 + Math.max(0, o.capacity - 5) * 2900)]);
  if (o.expiresAt)
    facts.push([
      o.access === 'active' ? (trial ? 'Trial ends' : 'Access ends') : 'Ended',
      formatDate(o.expiresAt),
    ]);
  if (trial && o.access === 'active')
    facts.push(['After that', 'Read-only 30 days']);
  const text =
    o.access === 'locked'
      ? 'Team access is locked. Subscribe to unlock your shared cases and Playbooks.'
      : o.access === 'read-only'
        ? 'Nobody can edit shared cases or Playbooks. Owners can still export. Your personal workspace is unaffected.'
        : trial
          ? 'Full Team features with five seats. No card on file, so nothing is charged when the trial ends.'
          : 'Shared workspaces, cases and Playbooks for your organization.';
  return (
    <PlanCard
      over={o.name}
      title={
        trial
          ? o.access === 'active'
            ? 'Team trial'
            : 'Team trial ended'
          : 'Team'
      }
      pill={pill}
      text={text}
    >
      {trial && o.access === 'active' && left !== null && (
        <div
          className="h-1 overflow-hidden rounded-full bg-sunk"
          role="img"
          aria-label={`${left} of 14 trial days left`}
        >
          <i
            className="block h-full rounded-full bg-busy"
            style={{
              width: `${Math.max(0, Math.min(100, ((14 - left) / 14) * 100))}%`,
            }}
          />
        </div>
      )}
      <Facts items={facts} />
      {!owner && (
        <p className="m-0 text-meta text-ink-3">
          Billing is managed by your organization owner. Ask them to add seats
          or change the plan.
        </p>
      )}
    </PlanCard>
  );
}

function PlanCard({
  over,
  title,
  pill,
  text,
  children,
}: {
  over: string;
  title: string;
  pill: ReactNode;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3.5 rounded-card bg-surface p-4 ring-1 ring-line">
      <div>
        <div className="text-[11px] text-ink-3">{over}</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-title font-semibold">{title}</span>
          {pill}
        </div>
        <p className="mt-0.5 mb-0 text-ink-2">{text}</p>
      </div>
      {children}
    </div>
  );
}

// `startNew` opens the page on the "new organization" offer even when the
// account already has organizations.
export function PlanBilling({ startNew = false }: { startNew?: boolean }) {
  const { snapshot, busy, error, run, mutate } = useAccount();
  const [choice, setChoice] = useState(startNew ? NEW : '');
  const [name, setName] = useState('');
  const [naming, setNaming] = useState<Intent | null>(null);
  const [handoff, setHandoff] = useState<{ id: string; intent: Intent } | null>(
    null,
  );
  const organizations = snapshot.view?.organizations ?? [];
  const context = snapshot.context.context;
  const organization =
    choice === NEW
      ? undefined
      : (organizations.find(
          (o) =>
            o.id ===
            (choice || (context.kind === 'team' ? context.organizationId : '')),
        ) ?? organizations[0]);
  const account = snapshot.view?.account;
  const owner =
    !!organization && organization.ownerId === snapshot.context.accountId;
  const description = !account
    ? 'Your personal workspace is free. Sign in to start Team.'
    : choice === NEW
      ? 'Set up another organization with its own plan, seats and members.'
      : !organization || organization.access === 'setup'
        ? "You're on the free personal plan. Upgrade to Team to share cases and Playbooks."
        : owner
          ? "Your team's plan, seats and invoices."
          : "Your team's plan. Only the owner can change billing.";
  return (
    <>
      <PageHeader
        title="Plan & billing"
        description={description}
        action={
          account &&
          organizations.length > 0 && (
            <label className="flex items-center gap-1.5 text-meta text-ink-3">
              Billing for
              <select
                aria-label="Billing organization"
                className="h-8 max-w-48 rounded-item bg-sunk px-2 text-ink ring-1 ring-line"
                value={organization?.id ?? NEW}
                disabled={busy}
                onChange={(e) => {
                  setChoice(e.target.value);
                  setNaming(null);
                }}
              >
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
                <option value={NEW}>New organization…</option>
              </select>
            </label>
          )
        }
      />
      {error && (
        <p role="alert" className="m-0 text-bad">
          {error}
        </p>
      )}
      {choice !== NEW && (
        <Group label="Current plan">
          <CurrentPlan
            organization={organization}
            owner={owner || !organization}
          />
        </Group>
      )}
      {!account ? (
        <TeamOffer
          note="No card needed for the trial."
          actions={
            <Button
              disabled={busy || snapshot.error?.code === 'not-configured'}
              onClick={() =>
                void run(() =>
                  snapshot.status === 'signing-in'
                    ? window.supahelp.cancelAccountSignIn()
                    : window.supahelp.signInAccount(),
                )
              }
            >
              {snapshot.status === 'signing-in'
                ? 'Cancel sign-in'
                : 'Sign in to start Team'}
            </Button>
          }
        >
          {snapshot.status === 'signing-in' && (
            <Note>Finish signing in in your browser.</Note>
          )}
          {snapshot.error && <Note>{snapshot.error.message}</Note>}
        </TeamOffer>
      ) : !organization ? (
        naming ? (
          <Group
            label={
              naming === 'trial' ? 'Start your Team trial' : 'Subscribe to Team'
            }
          >
            <Card>
              <form
                className="flex flex-col gap-3 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate(`org:${name.trim()}`, (requestId) =>
                    window.supahelp.createOrganization({
                      context: snapshot.context,
                      name: name.trim(),
                      requestId,
                    }),
                  ).then((result) => {
                    if (result) {
                      setChoice(result.value.organizationId);
                      setHandoff({
                        id: result.value.organizationId,
                        intent: naming,
                      });
                      setName('');
                      setNaming(null);
                    }
                  });
                }}
              >
                <label className="flex flex-col gap-1">
                  <span className="text-meta font-medium">
                    Organization name
                  </span>
                  <input
                    aria-label="Organization name"
                    className="h-8 max-w-80 rounded-item bg-sunk px-2 text-ink ring-1 ring-line"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={100}
                    autoFocus
                  />
                  <span className="text-[11.5px] text-ink-3">
                    This is your organization. Teammates see it when you invite
                    them.
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy || !name.trim()}>
                    {naming === 'trial'
                      ? 'Create organization and start trial'
                      : 'Continue to seats'}
                  </Button>
                  <Button kind="ghost" onClick={() => setNaming(null)}>
                    Back
                  </Button>
                </div>
              </form>
            </Card>
          </Group>
        ) : (
          <TeamOffer
            note="No card needed for the trial."
            actions={
              <>
                <Button disabled={busy} onClick={() => setNaming('trial')}>
                  Start 14-day free trial
                </Button>
                <Button
                  kind="secondary"
                  disabled={busy}
                  onClick={() => setNaming('paid')}
                >
                  Subscribe
                </Button>
              </>
            }
          />
        )
      ) : owner ? (
        <BillingSettings
          key={organization.id}
          organization={organization}
          intent={handoff?.id === organization.id ? handoff.intent : undefined}
        />
      ) : null}
      {account && (
        <details className="text-meta">
          <summary className="cursor-pointer px-0.5 text-ink-2">
            Compare plans
          </summary>
          <div className="mt-2">
            <Card>
              <Row
                title="Personal · Free"
                description="Local work on this computer with your own model connection."
              />
              <Row
                title="Team · US$149/month"
                description="Five named seats across your organization's workspaces. US$29/month per extra seat, plus applicable tax. Your model connection is separate."
              />
              <Row
                title="Team trial · 14 days"
                description="Five seats, no card and no automatic charge. Afterwards read-only for 30 days with owner export, then access locks."
              />
            </Card>
          </div>
        </details>
      )}
    </>
  );
}
