// Made-up workspace, member and Playbook records for the UI preview. No
// accounts, sync, billing or masking happen anywhere.
import type { Playbook } from '../features/playbooks/types';

export type Member = {
  id: string;
  name: string;
  role: string;
  // Avatar background. `undefined` = a viewer, drawn on the sunk tint.
  tone?: string;
  access: 'Admin' | 'Member' | 'Viewer · free';
};

export const ME = 'jimmy';

export const members: Member[] = [
  {
    id: 'jimmy',
    name: 'Jimmy',
    role: 'support',
    tone: '#4A3A33',
    access: 'Admin',
  },
  {
    id: 'priya',
    name: 'Priya',
    role: 'support',
    tone: '#55606E',
    access: 'Admin',
  },
  {
    id: 'sam',
    name: 'Sam',
    role: 'developer',
    tone: '#3F4A3C',
    access: 'Member',
  },
  {
    id: 'marco',
    name: 'Marco',
    role: 'support',
    tone: '#5A4F63',
    access: 'Member',
  },
  { id: 'dana', name: 'Dana', role: 'CTO · admin', access: 'Viewer · free' },
];

// The person on this computer before accounts exist; owns every real case.
const you: Member = {
  id: 'local',
  name: 'You',
  role: 'on this computer',
  access: 'Admin',
};
export const member = (id: string) =>
  id === you.id
    ? you
    : (members.find((m) => m.id === id) ?? {
        id,
        name: 'Teammate',
        role: 'member',
        access: 'Member' as const,
      });

export const workspaces = {
  personal: {
    id: 'personal',
    mark: 'J',
    name: 'Jimmy’s workspace',
    note: 'on this computer',
  },
  org: 'Acme',
  team: [
    {
      id: 'billing',
      mark: 'B',
      name: 'Billing',
      note: '4 members · 2 viewers',
      you: 'you’re an admin',
    },
    {
      id: 'mobile',
      mark: 'M',
      name: 'Mobile app',
      note: '3 members',
      you: 'you’re a viewer',
    },
    {
      id: 'enterprise',
      mark: 'E',
      name: 'Enterprise accounts',
      note: '',
      locked: true,
      you: '',
    },
  ],
  current: 'billing',
};

export const plan = {
  name: 'Team',
  seats: 5,
  used: 4,
  price: '$149 / month',
};

export const initialPlaybooks: Playbook[] = [
  {
    id: 'pb1',
    title: 'Duplicate charge after webhook retry',
    authorId: 'priya',
    published: '12 Oct',
    uses: 6,
    what: 'When our Stripe webhook times out, Stripe retries it. The retry handler creates a new invoice each time, so an annual renewal can be charged twice. The customer sees two identical charges a few seconds apart.',
    steps: [
      {
        id: 's1',
        text: 'Open the customer in Stripe and confirm two invoices for the same subscription and period.',
        shot: { label: 'Stripe · invoice list', clean: true, blurred: false },
      },
      {
        id: 's2',
        text: 'Check New Relic for one checkout request in that window, to rule out a double-click.',
      },
      {
        id: 's3',
        text: 'Refund the second invoice’s charge and reply with the refund timeline (5–10 days).',
        shot: { label: 'Stripe · refund dialog', clean: true, blurred: false },
      },
      {
        id: 's4',
        text: 'Link the case to ENG-311 until the idempotency fix ships.',
      },
    ],
  },
  {
    id: 'pb2',
    title: 'Refund not showing for customer',
    authorId: 'marco',
    published: '3 Oct',
    uses: 9,
    what: 'Stripe shows the refund as succeeded but the customer can’t see it yet. Card refunds take 5–10 business days to appear.',
    steps: [
      {
        id: 's1',
        text: 'Find the refund in Stripe and copy its ARN if the bank needs it.',
      },
      {
        id: 's2',
        text: 'Reply with the refund date, amount and the 5–10 day timeline.',
      },
    ],
  },
  {
    id: 'pb3',
    title: 'Reset SSO for a workspace',
    authorId: 'sam',
    published: '28 Sep',
    uses: 4,
    what: 'A workspace’s SSO login loops back to the sign-in page after an IdP certificate change.',
    steps: [
      {
        id: 's1',
        text: 'Check the Okta logs for a certificate mismatch on the workspace’s app.',
      },
      {
        id: 's2',
        text: 'Ask the customer’s admin to re-upload the new certificate.',
      },
    ],
  },
  {
    id: 'pb4',
    title: 'Invite fails for over-limit seats',
    authorId: 'priya',
    published: '21 Sep',
    uses: 3,
    what: 'Invites fail silently when a workspace has used all of its paid seats.',
    steps: [{ id: 's1', text: 'Check seats used against the plan in Stripe.' }],
  },
];
