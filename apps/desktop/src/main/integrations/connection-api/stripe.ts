import { type AuthEndpoints, type CatalogRecord } from '../connection-oauth.ts';
import {
  asQuery,
  id,
  operation,
  string,
  type Operation,
} from './operations.ts';

export function configureStripe(record: CatalogRecord) {
  const v = record.values;
  const headers: Record<string, string> = {};
  let endpoints: AuthEndpoints | undefined;

  if (
    v.key &&
    (!/^rk_(test|live)_[a-zA-Z0-9]+$/.test(v.key) ||
      (v.key.startsWith('rk_live_') ? 'Live' : 'Test') !== v.environment)
  )
    throw Error('Use a restricted key for the selected Stripe environment.');
  const base = 'https://api.stripe.com/v1';
  if (!['Test', 'Live'].includes(v.environment))
    throw Error('Choose a Stripe environment.');
  if (v.key) headers.Authorization = `Bearer ${v.key}`;
  else
    endpoints = {
      authorize: 'https://marketplace.stripe.com/oauth/v2/authorize',
      token: 'https://api.stripe.com/v1/oauth/token',
      scopes: '',
      pkce: false,
    };
  const money = { type: 'integer', minimum: 1, maximum: 99999999 };
  const customer = { customer_id: string };
  const currency = { type: 'string', pattern: '^[a-z]{3}$' };
  const request = {
    _requestId: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
  };
  const change = (
    name: string,
    description: string,
    method: string,
    path: string,
    properties: Record<string, object>,
  ) =>
    operation(
      name,
      description,
      method,
      path,
      { ...properties, ...request },
      {
        inputSchema: {
          type: 'object',
          properties: { ...properties, ...request },
          required: Object.keys(properties),
          additionalProperties: false,
        },
      },
    );
  const operations: Operation[] = [
    operation(
      'find_customer',
      'Find customers by exact email',
      'GET',
      '/customers',
      { email: string },
      { query: asQuery },
    ),
    operation('get_customer', 'Read a customer', 'GET', '/customers/{id}', id),
    operation(
      'list_charges',
      'Read customer charges',
      'GET',
      '/charges',
      customer,
      {
        query: (a) => ({ customer: String(a.customer_id), limit: '50' }),
      },
    ),
    operation(
      'get_charge',
      'Read a charge and its currency',
      'GET',
      '/charges/{id}',
      id,
    ),
    operation(
      'list_invoices',
      'Read customer invoices',
      'GET',
      '/invoices',
      customer,
      {
        query: (a) => ({ customer: String(a.customer_id), limit: '50' }),
      },
    ),
    operation(
      'list_subscriptions',
      'Read customer subscriptions',
      'GET',
      '/subscriptions',
      customer,
      {
        query: (a) => ({ customer: String(a.customer_id), limit: '50' }),
      },
    ),
    operation(
      'get_subscription',
      'Read a subscription and its items',
      'GET',
      '/subscriptions/{id}',
      id,
    ),
    operation('get_price', 'Read a plan price', 'GET', '/prices/{id}', id),
    operation('list_disputes', 'Read disputes', 'GET', '/disputes'),
    change(
      'refund_charge',
      'Refund an exact amount in minor currency units to the charge’s original payment method',
      'POST',
      '/refunds',
      { charge_id: string, ...customer, amount: money, currency },
    ),
    change(
      'cancel_subscription',
      'Cancel a subscription now or at the end of the billing period; no immediate invoice or proration',
      'POST',
      '/subscriptions/{id}',
      { ...id, ...customer, at_period_end: { type: 'boolean' } },
    ),
    change(
      'change_plan',
      'Change a single subscription item’s fixed recurring price without immediate proration',
      'POST',
      '/subscriptions/{id}',
      {
        ...id,
        ...customer,
        subscription_item_id: string,
        new_price_id: string,
        new_price_amount: { ...money, minimum: 0 },
        quantity: { type: 'integer', minimum: 1 },
        currency,
      },
    ),
    change(
      'add_credit',
      'Add customer invoice-balance credit in minor currency units',
      'POST',
      '/customers/{id}/balance_transactions',
      { ...id, amount: money, currency },
    ),
  ];

  return { base, headers, operations, endpoints };
}
