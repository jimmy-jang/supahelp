import { formatDate, formatDateTime } from '../../app/formatDate';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  BillingPreview,
  BillingRequest,
  BillingView,
  OrganizationView,
} from '../../../contracts/accounts';
import { Button } from '../../components/Button';
import { Card, Group, Note, Row } from '../settings/parts';
import { useAccount } from './AccountProvider';

export type Intent = 'trial' | 'paid';
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );
const monthly = (seats: number) => 14900 + Math.max(0, seats - 5) * 2900;

export function TeamOffer({
  actions,
  note,
  children,
}: {
  actions: ReactNode;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <Group label="Upgrade">
      <div className="flex flex-col gap-4 rounded-card bg-surface p-4 ring-1 ring-line">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-48 flex-1">
            <div className="text-title font-semibold">Team</div>
            <ul className="mt-2 mb-0 flex list-none flex-col gap-1 p-0 text-ink-2">
              {[
                'Shared workspaces for your organization',
                'Cases and Playbooks your teammates can open and edit',
                'Invite teammates by email, five seats included',
              ].map((t) => (
                <li key={t}>
                  <span className="mr-2 text-[11px] text-ok">✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="sm:text-right">
            <div className="font-mono text-[20px] font-semibold tracking-[-0.02em]">
              US$149
            </div>
            <div className="text-[11.5px] text-ink-3">
              per month, five seats
            </div>
            <div className="text-[11.5px] text-ink-3">
              +US$29 per extra seat, plus tax
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {note && <span className="text-meta text-ink-3">{note}</span>}
        </div>
        {children}
      </div>
    </Group>
  );
}

function Banner({
  tone,
  title,
  children,
  actions,
  busy,
}: {
  tone: 'busy' | 'attn' | 'grey' | 'ok';
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
}) {
  const bg = {
    busy: 'bg-busy-soft',
    attn: 'bg-attn-soft',
    grey: 'bg-sunk',
    ok: 'bg-ok-soft',
  }[tone];
  return (
    <div
      role="status"
      className={`flex flex-wrap items-start gap-3 rounded-card px-3.5 py-3 ${bg}`}
    >
      {busy && (
        <span className="mt-0.5 size-3.5 flex-none animate-spin rounded-full border-2 border-busy border-r-transparent motion-reduce:animate-none" />
      )}
      <div className="min-w-48 flex-1">
        <div className="font-semibold">{title}</div>
        <div className="text-meta text-ink-2">{children}</div>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

function Seats({
  value,
  min,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  const step =
    'grid size-8 place-items-center text-ink-2 hover:bg-hover disabled:opacity-45';
  return (
    <span className="inline-flex items-center overflow-hidden rounded-item bg-surface ring-1 ring-line">
      <button
        type="button"
        aria-label="Fewer seats"
        className={step}
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <input
        aria-label="Purchased seat capacity"
        className="h-8 w-12 bg-transparent text-center font-mono text-[13px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        type="number"
        min={min}
        max={10000}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button
        type="button"
        aria-label="More seats"
        className={step}
        disabled={disabled || value >= 10000}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </span>
  );
}

export function BillingSettings({
  organization,
  intent,
}: {
  organization: OrganizationView;
  intent?: Intent;
}) {
  const { snapshot, busy, mutate } = useAccount();
  const [billing, setBilling] = useState<BillingView | null>(null),
    [error, setError] = useState(''),
    [capacity, setCapacity] = useState(5),
    [preview, setPreview] = useState<BillingPreview | null>(null),
    [loading, setLoading] = useState(false),
    [version, setVersion] = useState(0),
    [review, setReview] = useState(false),
    [waiting, setWaiting] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const autoTrial = useRef(false);
  // The team can appear before the owner's choice is handed over, so apply it when it arrives.
  useEffect(() => {
    if (intent === 'paid') setReview(true);
    if (intent === 'trial') autoTrial.current = true;
  }, [intent]);
  useEffect(() => {
    const refresh = () => {
      setVersion((v) => v + 1);
      void window.supahelp.refreshAccount().catch(() => {});
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  useEffect(() => {
    if (!waiting) return;
    let checks = 0;
    const timer = window.setInterval(() => {
      setVersion((v) => v + 1);
      if (++checks >= 10) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    void window.supahelp
      .getBilling(organization.id, snapshot.context)
      .then((r) => {
        if (canceled) return;
        if (r.ok) {
          setBilling(r.value);
          setCapacity((current) =>
            r.value.hasSubscription ? r.value.capacity : current,
          );
          if (
            waiting &&
            r.value.hasSubscription &&
            (r.value.status === 'trialing' ||
              (r.value.status === 'active' && organization.source === 'paid'))
          ) {
            setWaiting(false);
            setConfirmed(true);
            void window.supahelp.refreshAccount().catch(() => {});
          }
          setError('');
        } else {
          setBilling(null);
          setError(r.error);
        }
      })
      .catch(() => {
        if (!canceled) setError('Refresh to try again.');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [
    organization.id,
    snapshot.revision,
    version,
    waiting,
    organization.source,
  ]);
  const change = async (action: BillingRequest['action']) => {
    const result = await mutate(
      `billing:${organization.id}:${action}:${capacity}:${preview?.id ?? ''}`,
      (requestId) =>
        window.supahelp.changeBilling({
          context: snapshot.context,
          organizationId: organization.id,
          requestId,
          action,
          capacity,
          previewId: preview?.id,
        }),
    );
    if (result) {
      setPreview(null);
      setReview(false);
      if (action === 'checkout' && result.value.opened) {
        setWaiting(true);
        setConfirmed(false);
      }
      setVersion((v) => v + 1);
    }
  };
  // The owner chose "Start free trial" before the team existed: finish that choice once.
  useEffect(() => {
    if (autoTrial.current && billing?.enabled && billing.trialAvailable) {
      autoTrial.current = false;
      void change('trial');
    }
  });
  const disabled = busy || loading;
  const min = Math.max(5, organization.assigned + organization.reserved);
  const validCapacity =
    Number.isSafeInteger(capacity) && capacity >= min && capacity <= 10000;
  const grantActive =
    !!organization.expiresAt && Date.parse(organization.expiresAt) > Date.now();
  const trialActive = grantActive && organization.source === 'trial';
  const deferred =
    grantActive &&
    ((trialActive && capacity === 5) || organization.source === 'pilot');
  const start =
    deferred && organization.expiresAt
      ? `Billing starts ${formatDate(organization.expiresAt)}. Your remaining ${organization.source} access stays intact.`
      : 'Billing starts immediately after successful payment.';
  const subscribeLabel = deferred ? 'Add payment method' : 'Subscribe now';
  const checkAgain = (
    <Button
      kind="ghost"
      disabled={disabled}
      onClick={() => setVersion((v) => v + 1)}
    >
      Check again
    </Button>
  );
  return (
    <>
      {waiting && (
        <Banner
          tone="busy"
          busy
          title="Finish payment in your browser"
          actions={
            <>
              <Button
                kind="secondary"
                disabled={disabled}
                onClick={() => setVersion((v) => v + 1)}
              >
                Check payment status
              </Button>
              <Button kind="ghost" onClick={() => setWaiting(false)}>
                Dismiss
              </Button>
            </>
          }
        >
          Checkout for {organization.name} is open in your browser. This page
          updates when Stripe confirms the payment. Waiting does not mean a
          payment succeeded.
        </Banner>
      )}
      {confirmed && (
        <Banner tone="ok" title="Subscription confirmed">
          {billing?.status === 'trialing'
            ? 'Your payment method is saved. Billing begins when your trial or pilot ends.'
            : 'Your subscription is confirmed by the server. Team access follows verified payment.'}
        </Banner>
      )}
      {error && (
        <Banner
          tone="grey"
          title="Billing could not be loaded"
          actions={checkAgain}
        >
          {error}
        </Banner>
      )}
      {billing && !billing.enabled && (
        <Banner
          tone="grey"
          title="Billing isn't available yet"
          actions={checkAgain}
        >
          Your current access is unchanged. Trials, subscriptions and seat
          changes will appear here once billing opens.
        </Banner>
      )}
      {billing?.enabled && (
        <>
          {billing.pendingAction && (
            <Banner
              tone="attn"
              title="Billing change pending"
              actions={
                <Button
                  kind="secondary"
                  disabled={disabled}
                  onClick={() => void change('retry')}
                >
                  Retry pending change
                </Button>
              }
            >
              Its outcome needs confirmation. Retry safely using the original
              request.
            </Banner>
          )}
          {billing.reviewRequired && (
            <Note>
              A refund or payment dispute needs billing review. Contact support.
            </Note>
          )}
          {!billing.hasSubscription && review && (
            <Group label="Subscribe to Team">
              <div className="flex flex-col gap-4 rounded-card bg-surface p-4 ring-1 ring-line">
                <div className="flex flex-col gap-1">
                  <span className="text-meta font-medium">
                    Seats for {organization.name}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Seats
                      value={capacity}
                      min={min}
                      disabled={disabled}
                      onChange={setCapacity}
                    />
                    <span className="text-[11.5px] text-ink-3">
                      Minimum {min}. Add more any time.
                    </span>
                  </div>
                </div>
                {validCapacity && (
                  <div className="flex flex-col gap-1 rounded-item bg-sunk px-3 py-2.5 text-[12.5px]">
                    <div className="flex justify-between gap-3">
                      <span>Team, five seats included</span>
                      <span className="font-mono tabular-nums">
                        {money(14900)}
                      </span>
                    </div>
                    {capacity > 5 && (
                      <div className="flex justify-between gap-3">
                        <span>
                          {capacity - 5} extra seat{capacity === 6 ? '' : 's'} ×{' '}
                          {money(2900)}
                        </span>
                        <span className="font-mono tabular-nums">
                          {money((capacity - 5) * 2900)}
                        </span>
                      </div>
                    )}
                    <div className="mt-0.5 flex justify-between gap-3 border-t border-line pt-1.5 font-semibold">
                      <span>Per month, before tax</span>
                      <span className="font-mono tabular-nums">
                        {money(monthly(capacity))}
                      </span>
                    </div>
                    <span className="text-[11.5px] text-ink-3">
                      {money(monthly(capacity))}/month before applicable tax.{' '}
                      {start} Renews monthly until you cancel. Stripe shows the
                      final tax and total.
                    </span>
                    {trialActive && capacity > 5 && (
                      <span className="text-[11.5px] text-attn">
                        This ends your free trial early.
                      </span>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={disabled || waiting || !validCapacity}
                    onClick={() => void change('checkout')}
                  >
                    {deferred
                      ? 'Continue to save payment method'
                      : trialActive
                        ? 'End trial and continue to payment'
                        : 'Continue to payment'}
                  </Button>
                  <Button
                    kind="ghost"
                    disabled={disabled}
                    onClick={() => setReview(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </Group>
          )}
          {!billing.hasSubscription &&
            !review &&
            (organization.access === 'setup' ? (
              <TeamOffer
                note={
                  billing.trialAvailable
                    ? 'No card and no automatic charge.'
                    : undefined
                }
                actions={
                  <>
                    {billing.trialAvailable && (
                      <Button
                        disabled={disabled}
                        onClick={() => void change('trial')}
                      >
                        Start free trial
                      </Button>
                    )}
                    <Button
                      kind={billing.trialAvailable ? 'secondary' : 'primary'}
                      disabled={disabled || waiting}
                      onClick={() => setReview(true)}
                    >
                      {subscribeLabel}
                    </Button>
                  </>
                }
              />
            ) : (
              <Group label="Subscription">
                <Card>
                  <Row
                    title={
                      trialActive
                        ? 'Keep Team after your trial'
                        : grantActive && organization.source === 'pilot'
                          ? 'Keep Team after your pilot'
                          : 'Subscribe to Team'
                    }
                    description={
                      trialActive
                        ? 'Your remaining trial days stay free; billing starts when the trial ends. Choosing more than five seats ends the trial early.'
                        : deferred
                          ? 'Your pilot remains intact. Billing starts when the pilot ends.'
                          : 'Paid access begins after payment succeeds.'
                    }
                  >
                    <Button
                      kind={grantActive ? 'secondary' : 'primary'}
                      disabled={disabled || waiting}
                      onClick={() => setReview(true)}
                    >
                      {subscribeLabel}
                    </Button>
                  </Row>
                </Card>
              </Group>
            ))}
          {billing.hasSubscription && (
            <Group label="Manage">
              <Card>
                <Row
                  title="Seats"
                  description={`Adding seats charges the prorated amount now. Removing seats applies at renewal without a refund. ${organization.assigned} assigned and ${organization.reserved} invited must still fit.`}
                >
                  <Seats
                    value={capacity}
                    min={min}
                    disabled={disabled}
                    onChange={(n) => {
                      setCapacity(n);
                      setPreview(null);
                    }}
                  />
                  <Button
                    kind="secondary"
                    disabled={
                      disabled ||
                      capacity === billing.capacity ||
                      !validCapacity
                    }
                    onClick={() => {
                      setLoading(true);
                      setError('');
                      void window.supahelp
                        .previewBillingCapacity(
                          organization.id,
                          capacity,
                          snapshot.context,
                        )
                        .then((r) => {
                          if (r.ok) setPreview(r.value);
                          else setError(r.error);
                        })
                        .catch(() => setError('Could not preview the price.'))
                        .finally(() => setLoading(false));
                    }}
                  >
                    Review change
                  </Button>
                </Row>
                {preview && (
                  <Row
                    title={
                      preview.capacity > billing.capacity
                        ? `Pay ${money(preview.amount)} to increase capacity`
                        : `${money(preview.amount)}/month before tax from renewal`
                    }
                    description={`New capacity: ${preview.capacity} seats. Effective ${formatDateTime(preview.effectiveAt)}. ${preview.capacity > billing.capacity ? `${organization.source === 'trial' ? 'This ends your remaining free trial and starts paid access. ' : ''}Extra seats unlock after payment succeeds.` : 'New invitations will also respect this future limit.'}`}
                  >
                    <Button
                      kind="secondary"
                      disabled={disabled}
                      onClick={() => void change('capacity')}
                    >
                      Confirm seat change
                    </Button>
                    <Button kind="ghost" onClick={() => setPreview(null)}>
                      Cancel
                    </Button>
                  </Row>
                )}
                {billing.pendingCapacity !== null && (
                  <Row
                    title={`${billing.pendingCapacity} seats from ${billing.pendingAt ? formatDate(billing.pendingAt) : 'renewal'}`}
                    description="New invitations respect this limit now. To change capacity again, choose Keep current subscription to cancel this scheduled reduction first."
                  />
                )}
                {billing.status === 'trialing' &&
                  !billing.cancelAtPeriodEnd &&
                  organization.capacity > billing.capacity && (
                    <Row
                      title={`${billing.capacity} seats selected after the pilot`}
                      description="New invitations already respect your selected paid capacity so the transition will fit. Your founder grant remains intact."
                    />
                  )}
                <Row
                  title="Payment method and invoices"
                  description={`Subscription · ${billing.status}. ${billing.cancelAtPeriodEnd ? 'Renewal is canceled. Access continues through your paid period, then enters read-only grace.' : 'Opens Stripe in your browser.'}`}
                >
                  <Button
                    kind="secondary"
                    disabled={disabled}
                    onClick={() => void change('portal')}
                  >
                    Payment details & invoices
                  </Button>
                  {(billing.cancelAtPeriodEnd ||
                    billing.pendingCapacity !== null) && (
                    <Button
                      kind="ghost"
                      disabled={disabled}
                      onClick={() => void change('resume')}
                    >
                      Keep current subscription
                    </Button>
                  )}
                </Row>
                {!billing.cancelAtPeriodEnd && (
                  <Row
                    title="Cancel subscription"
                    description="Team stays active until the end of the paid period, then becomes read-only for 30 days."
                  >
                    <Button
                      kind="ghost"
                      disabled={disabled}
                      onClick={() => void change('portal')}
                    >
                      Cancel in billing portal
                    </Button>
                  </Row>
                )}
              </Card>
            </Group>
          )}
        </>
      )}
    </>
  );
}
