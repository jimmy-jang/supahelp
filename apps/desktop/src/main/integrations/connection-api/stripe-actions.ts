import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CatalogRecord } from '../connection-oauth.ts';

export type StripeRequest = (
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  headers?: Record<string, string>,
) => Promise<unknown>;

export async function stripeChange(
  request: StripeRequest,
  record: CatalogRecord,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  if (
    typeof args._requestId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(args._requestId)
  )
    throw Error('Missing durable Stripe request identity.');
  const live = record.values.environment === 'Live';
  const check = async (path: string) => {
    const value = (await request('GET', path, undefined, signal)) as Record<
      string,
      unknown
    >;
    if (
      value.id !== decodeURIComponent(path.split('/').at(-1)!) ||
      value.deleted ||
      value.livemode !== live ||
      (args.customer_id &&
        value.customer &&
        value.customer !== args.customer_id) ||
      (args.currency && value.currency && value.currency !== args.currency)
    )
      throw Error('Stripe target, customer, currency or environment changed.');
    return value;
  };
  const headers = { 'Idempotency-Key': args._requestId };
  let result: unknown;
  if (name === 'refund_charge') {
    const charge = await check(
      `/charges/${encodeURIComponent(String(args.charge_id))}`,
    );
    if (
      charge.customer !== args.customer_id ||
      charge.currency !== args.currency ||
      charge.paid !== true ||
      !Number.isSafeInteger(charge.amount) ||
      !Number.isSafeInteger(charge.amount_refunded) ||
      Number(args.amount) >
        Number(charge.amount) - Number(charge.amount_refunded)
    )
      throw Error(
        'The requested customer or refundable amount does not match.',
      );
    result = await request(
      'POST',
      '/refunds',
      { charge: args.charge_id, amount: args.amount },
      signal,
      headers,
    );
  } else if (name === 'add_credit') {
    await check(`/customers/${encodeURIComponent(String(args.id))}`);
    result = await request(
      'POST',
      `/customers/${encodeURIComponent(String(args.id))}/balance_transactions`,
      { amount: -Number(args.amount), currency: args.currency },
      signal,
      headers,
    );
  } else {
    const subscription = await check(
      `/subscriptions/${encodeURIComponent(String(args.id))}`,
    );
    if (subscription.customer !== args.customer_id || subscription.schedule)
      throw Error(
        'Review this customer’s subscription and any attached schedule first.',
      );
    const path = `/subscriptions/${encodeURIComponent(String(args.id))}`;
    if (name === 'cancel_subscription')
      result = await request(
        args.at_period_end ? 'POST' : 'DELETE',
        path,
        args.at_period_end
          ? { cancel_at_period_end: true }
          : { invoice_now: false, prorate: false },
        signal,
        headers,
      );
    else {
      const items = subscription.items as
        | { data?: { id: string; quantity?: number }[] }
        | undefined;
      // shortcut: single-item fixed recurring prices only; add usage and multi-item billing when needed.
      if (
        items?.data?.length !== 1 ||
        items.data[0].id !== args.subscription_item_id ||
        items.data[0].quantity !== args.quantity
      )
        throw Error(
          'Review this subscription’s items and quantity before changing its plan.',
        );
      const price = await check(
        `/prices/${encodeURIComponent(String(args.new_price_id))}`,
      );
      if (
        price.active !== true ||
        !price.recurring ||
        (price.recurring as { usage_type?: string }).usage_type === 'metered' ||
        price.transform_quantity ||
        price.unit_amount !== args.new_price_amount ||
        price.currency !== args.currency
      )
        throw Error(
          'The selected price changed or has unsupported usage pricing.',
        );
      result = await request(
        'POST',
        path,
        {
          'items[0][id]': args.subscription_item_id,
          'items[0][price]': args.new_price_id,
          'items[0][quantity]': args.quantity,
          proration_behavior: 'none',
        },
        signal,
        headers,
      );
    }
  }
  return CallToolResultSchema.parse({
    content: [{ type: 'text', text: JSON.stringify(result) }],
  });
}

export async function verifyStripe(
  request: StripeRequest,
  name: string,
  result: { content: { type: string; text?: string }[] },
  args: Record<string, unknown>,
  signal: AbortSignal,
) {
  const part = result.content.find((part) => part.type === 'text');
  const value = JSON.parse(part?.text ?? '{}') as Record<string, unknown>;
  if (typeof value.id !== 'string') return;
  if (name === 'refund_charge') {
    const refund = (await request(
      'GET',
      `/refunds/${encodeURIComponent(value.id)}`,
      undefined,
      signal,
    )) as Record<string, unknown>;
    if (
      refund.id === value.id &&
      refund.charge === args.charge_id &&
      refund.amount === args.amount &&
      refund.currency === args.currency &&
      refund.status === 'succeeded'
    )
      return `Read back successful refund ${refund.id} and checked the charge, amount and currency.`;
  }
  if (name === 'add_credit') {
    const credit = (await request(
      'GET',
      `/customers/${encodeURIComponent(String(args.id))}/balance_transactions/${encodeURIComponent(value.id)}`,
      undefined,
      signal,
    )) as Record<string, unknown>;
    if (
      credit.id === value.id &&
      credit.amount === -Number(args.amount) &&
      credit.currency === args.currency
    )
      return `Read back customer credit ${credit.id} and checked its amount and currency.`;
  }
  if (['cancel_subscription', 'change_plan'].includes(name)) {
    const subscription = (await request(
      'GET',
      `/subscriptions/${encodeURIComponent(String(args.id))}`,
      undefined,
      signal,
    )) as Record<string, unknown>;
    if (
      subscription.id !== args.id ||
      subscription.customer !== args.customer_id
    )
      return;
    if (
      name === 'cancel_subscription' &&
      (args.at_period_end
        ? subscription.cancel_at_period_end === true
        : subscription.status === 'canceled')
    )
      return `Read back subscription ${subscription.id} and checked the requested cancellation.`;
    const items = subscription.items as
      | { data?: { id: string; price?: { id?: string } }[] }
      | undefined;
    if (
      name === 'change_plan' &&
      items?.data?.some(
        (item) =>
          item.id === args.subscription_item_id &&
          item.price?.id === args.new_price_id,
      )
    )
      return `Read back subscription ${subscription.id} and checked the selected item’s price.`;
  }
}
