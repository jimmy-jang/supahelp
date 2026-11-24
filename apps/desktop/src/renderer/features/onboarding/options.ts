import type { OnboardingAnswers } from '../../../contracts/onboarding';
import { connectionCatalog } from '../../fixtures/connections';

type Option<T extends string> = { id: T; label: string; hint?: string };

export const ROLE_OPTIONS: Option<OnboardingAnswers['role']>[] = [
  { id: 'support', label: 'Support specialist', hint: 'I answer tickets' },
  {
    id: 'lead',
    label: 'Support lead or manager',
    hint: 'I run a support team',
  },
  {
    id: 'developer',
    label: 'Developer',
    hint: 'I handle escalations and code fixes',
  },
  { id: 'founder', label: 'Founder', hint: 'I run support myself' },
  {
    id: 'success',
    label: 'Customer success',
    hint: 'I manage customer accounts',
  },
  { id: 'other', label: 'Other' },
];
export const MODE_OPTIONS: Option<OnboardingAnswers['mode']>[] = [
  {
    id: 'solo',
    label: 'Just me',
    hint: 'A personal workspace on this computer. No team setup.',
  },
  {
    id: 'team',
    label: 'With my team',
    hint: 'Create a shared workspace and invite colleagues.',
  },
  {
    id: 'invited',
    label: 'I was invited',
    hint: 'Join a workspace someone already set up.',
  },
];
export const SIZE_OPTIONS: Option<
  NonNullable<OnboardingAnswers['teamSize']>
>[] = [
  { id: '1', label: 'Just me' },
  { id: '2-5', label: '2–5' },
  { id: '6-20', label: '6–20' },
  { id: '21-50', label: '21–50' },
  { id: '51+', label: '51+' },
];
export const PAIN_OPTIONS: Option<OnboardingAnswers['pains'][number]>[] = [
  {
    id: 'context',
    label: 'Gathering context across tools',
    hint: 'Ticket, payments, logs and code in different tabs',
  },
  {
    id: 'bounce',
    label: 'Escalations bouncing to engineering',
    hint: 'Developers ask for details you already looked up',
  },
  {
    id: 'before',
    label: 'Finding how we fixed it before',
    hint: 'Similar tickets are hard to find',
  },
  {
    id: 'fix',
    label: 'Doing the fix',
    hint: 'Refunds, credits and account changes',
  },
  { id: 'sla', label: 'Missing SLAs', hint: 'Tickets wait too long' },
];
export const SOURCE_OPTIONS: Option<
  NonNullable<OnboardingAnswers['source']>
>[] = [
  { id: 'search', label: 'Google or search' },
  { id: 'ai', label: 'ChatGPT, Claude or another AI' },
  { id: 'x', label: 'X' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'hacker-news', label: 'Hacker News' },
  { id: 'video', label: 'YouTube or podcast' },
  { id: 'friend', label: 'Friend or colleague' },
  { id: 'blog', label: 'Blog or newsletter' },
  { id: 'other', label: 'Other' },
];
// The first suggested question, from the first thing that slows them down.
export const FIRST_QUESTION: Record<
  OnboardingAnswers['pains'][number],
  string
> = {
  context: 'Look up everything about the customer on ticket #…',
  bounce: 'Write an escalation for ticket #… with what we know',
  before: 'Have we seen a ticket like #… before?',
  fix: 'Refund the duplicate charge on ticket #…',
  sla: 'Which of my open tickets need an answer first?',
};

const helpdeskLabels: Record<string, string> = {
  'hubspot-service': 'HubSpot',
  jsm: 'Jira (JSM)',
  'salesforce-service': 'Salesforce',
  other: 'Other',
  none: 'No helpdesk',
};
export const toolName = (id: string) =>
  connectionCatalog.find((tool) => tool.id === id)?.name ??
  (id === 'chargebee' ? 'Chargebee' : id);
export const helpdeskName = (id: string) => helpdeskLabels[id] ?? toolName(id);

export const TOOL_GROUPS: { title: string; ids: OnboardingAnswers['tools'] }[] =
  [
    { title: 'Billing', ids: ['stripe', 'chargebee'] },
    { title: 'Errors and logs', ids: ['newrelic', 'sentry', 'datadog'] },
    { title: 'Issue tracking', ids: ['linear', 'jira', 'github-issues'] },
    { title: 'Docs', ids: ['notion', 'confluence', 'google-drive'] },
    {
      title: 'Customer records and team chat',
      ids: ['hubspot', 'salesforce', 'attio', 'slack', 'teams'],
    },
  ];

// Picked tools in connection order: the helpdesk first, then the rest as picked.
export function pickedTools(answers: OnboardingAnswers) {
  const helpdesk = ['other', 'none'].includes(answers.helpdesk)
    ? []
    : [answers.helpdesk];
  return [...helpdesk, ...answers.tools];
}
