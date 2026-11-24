// Mock data for the UI preview. No backend: everything here is made up.
// AI edits to case documents are simulated with the fixture events below.
import { STATUS } from '../features/cases/status';
import type {
  Case,
  CaseDoc,
  Change,
  Entry,
  Section,
} from '../features/cases/types';
import type { Chat, Msg } from '../features/chat/types';

const finding1: Entry = {
  id: 'f1',
  pill: 'Confirmed',
  text: 'Two invoices created 41 s apart for one renewal',
  detail: 'Stripe in_1Qa…a1, in_1Qa…a2',
  by: 'Jimmy',
};
const finding2: Entry = {
  id: 'f2',
  pill: 'Ruled out',
  text: 'Customer double-clicked checkout',
  detail: 'New Relic: 1 request in the window',
  by: 'AI for Jimmy',
};

const doc412: CaseDoc = {
  ownerId: 'jimmy',
  contributorIds: [],
  customer: { name: 'Brightway Studio', id: 'cus_Nf7a', confirmed: true },
  playbook: { id: 'pb1', state: 'suggested' },
  updated: '9:41 · AI for Jimmy',
  sync: 'Synced',
  sections: {
    summary: {
      text: 'Brightway Studio was charged $149.00 twice on its 3 March renewal. The second charge came from a Stripe webhook retry. A refund is drafted and waiting for approval.',
    },
    customer: {
      rows: [
        [
          'Account',
          'Brightway Studio · Team plan, annual · customer since 2024',
        ],
        ['Contact', 'a•••@brightway.studio'],
        [
          'Matched by',
          'Ticket email matched one Stripe customer → app user 50211',
        ],
      ],
    },
    problem: {
      rows: [
        ['Reported', '“I was charged twice for my renewal.”'],
        ['Observed', 'Two $149.00 charges 41 s apart on the same subscription'],
        ['Affected', '3 annual customers renewing since 2 Mar'],
        ['Not affected', 'Monthly plans; renewals before 2 Mar'],
      ],
    },
    reproduction: {
      rows: [
        [
          'Steps',
          '1. Annual plan renews  2. Webhook times out  3. Stripe retries',
        ],
        ['Expected', 'One invoice'],
        ['Actual', 'Two invoices, both charged'],
        ['Environment', 'Live'],
      ],
    },
    findings: { entries: [finding1, finding2] },
    actions: {
      entries: [
        {
          id: 'a1',
          pill: 'Waiting',
          text: 'Refund $149.00 on ch_3PqK8L…',
          detail: 'Needs your approval',
          by: 'Jimmy',
        },
      ],
    },
    next: {
      text: 'Jimmy approves the refund, then decides whether to bring in a developer for the retry handler.',
    },
  },
  similar: [
    {
      title: '#287 · Webhook retry duplicate',
      note: 'Fixed by refund + duplicate-charge Playbook',
      by: 'Marco · Oct',
    },
    {
      title: 'ZD #45102 · Double invoice on upgrade',
      note: 'From a helpdesk note: “Voided invoice, no refund needed”',
      by: 'Sep',
    },
  ],
  log: [
    {
      time: '9:41',
      text: 'AI for Jimmy · Findings: added “Ruled out: double-click”',
    },
    {
      time: '9:30',
      text: 'Jimmy · Created from chat “Charged twice in March”',
    },
  ],
  fresh: [],
};

const refundThread: Msg[] = [
  {
    kind: 'you',
    text: 'zendesk.com/agent/tickets/48213 can you look at this?',
  },
  {
    kind: 'steps',
    tools: ['zendesk', 'stripe', 'newrelic'],
    text: 'Checked 3 tools in 14s',
  },
  {
    kind: 'ai',
    text: 'Brightway Studio (cus_Nf7a) has two $149.00 charges 41 seconds apart on the same subscription. New Relic shows only one checkout request, so this isn’t a double-click. It looks like a webhook retry.',
  },
  { kind: 'created', text: 'Case #412 created from this chat · attached' },
  {
    kind: 'case-updated',
    caseId: 'c1',
    section: 'findings',
    what: '+1 · Ruled out: double-click',
    change: { section: 'findings', entryId: 'f2', after: finding2 },
  },
  { kind: 'ai', text: 'I’ve drafted the refund for the duplicate charge.' },
  { kind: 'refund' },
  {
    kind: 'ai',
    text: 'The second invoice comes from our own retry handling, so this probably needs a code fix. You can bring in a developer from the case header.',
  },
];

type Base = Omit<Case, 'messages' | 'doc' | 'attached' | 'questionsForYou'> & {
  owner: string;
  questionsForYou?: number;
};

const base: Base[] = [
  {
    id: 'c1',
    number: 412,
    ticket: 'ZD #48213',
    title: 'Charged twice in March',
    customer: 'Brightway Studio',
    status: 'appr',
    time: '9:41',
    owner: 'jimmy',
  },
  {
    id: 'c2',
    number: 411,
    ticket: 'ZD #47952',
    title: 'Refund didn’t confirm',
    customer: 'Lumen Dental',
    status: 'unk',
    time: 'Nov 3',
    owner: 'jimmy',
  },
  {
    id: 'c3',
    number: 409,
    ticket: 'ZD #48190',
    title: 'Can’t invite teammates',
    customer: 'Nordlake',
    status: 'inv',
    time: '9:12',
    owner: 'sam',
    questionsForYou: 1,
  },
  {
    id: 'c4',
    number: 408,
    ticket: 'ZD #48211',
    title: 'Checkout slow for EU users',
    customer: 'Halden Foods',
    status: 'run',
    time: '8:47',
    owner: 'jimmy',
  },
  {
    id: 'c5',
    number: 405,
    ticket: 'LIN-2214',
    title: 'Export missing rows',
    customer: 'Kito Labs',
    status: 'weng',
    time: 'Nov 5',
    owner: 'marco',
  },
  {
    id: 'c6',
    number: 403,
    ticket: 'ZD #48077',
    title: 'SSO login loops',
    customer: 'Arden Health',
    status: 'wcust',
    time: 'Nov 4',
    owner: 'priya',
  },
  {
    id: 'c7',
    number: 401,
    ticket: 'ZD #47990',
    title: 'Wrong invoice address',
    customer: 'Peak & Co',
    status: 'done',
    time: 'Nov 3',
    owner: 'priya',
  },
  {
    id: 'c8',
    number: 398,
    ticket: 'ZD #47931',
    title: 'Seats not updating after upgrade',
    customer: 'Orbit Labs',
    status: 'done',
    time: 'Nov 2',
    owner: 'jimmy',
  },
];

// A short document for the cases that only exist to fill the sidebar.
function briefDoc(c: Base): CaseDoc {
  const questions: Section | undefined = c.questionsForYou
    ? {
        entries: [
          {
            id: 'q1',
            pill: 'For Jimmy',
            text: 'Which plan was the customer on when the invite failed?',
            by: 'Sam',
          },
        ],
      }
    : undefined;
  return {
    ownerId: c.owner,
    contributorIds: c.questionsForYou ? ['jimmy'] : [],
    customer: { name: c.customer, confirmed: true },
    updated: c.time,
    sync: 'Synced',
    sections: {
      summary: {
        text: `${c.customer} reported “${c.title}”. Status: ${STATUS[c.status].label.toLowerCase()}.`,
      },
      ...(questions && { questions }),
      next: { text: 'Preview case. Open it to see the document layout.' },
    },
    similar: [],
    log: [{ time: c.time, text: 'Created from a chat' }],
    fresh: [],
  };
}

function brief(c: Base): Msg[] {
  return [
    { kind: 'you', text: `${c.ticket} ${c.title}` },
    {
      kind: 'steps',
      tools: ['zendesk', 'stripe'],
      text: 'Checked 2 tools in 9s',
    },
    {
      kind: 'ai',
      text: `${c.customer} reported: “${c.title}”. Status: ${STATUS[c.status].label.toLowerCase()}.`,
    },
  ];
}

export const initialCases: Case[] = base.map((b) => {
  const { owner: _, questionsForYou = 0, ...c } = b;
  return {
    ...c,
    questionsForYou,
    attached: { caseId: c.id, playbookIds: [] },
    doc: c.id === 'c1' ? doc412 : briefDoc(b),
    messages: c.id === 'c1' ? refundThread : brief(b),
  };
});

export const initialChats: Chat[] = [
  'Checkout page slow today?',
  'Refund rules for annual plans',
  'Why did the Stripe webhook fail?',
  'Customers still on legacy plan',
].map((title, i) => ({
  id: `h${i}`,
  title,
  attached: { playbookIds: [] },
  messages: [
    { kind: 'you', text: title },
    {
      kind: 'ai',
      text: 'This is a UI preview, so there is no real answer here yet.',
    },
  ],
}));

// ---- Simulated AI edits (fixture events) ----

export type FixtureEdit = { what: string; change: Change };

// Create case: the document the AI writes from the chat.
export function createdDoc(ticket: string): {
  doc: CaseDoc;
  edits: FixtureEdit[];
} {
  const guess: Entry = {
    id: 'f1',
    pill: 'Guess',
    text: 'The charge is a proration from last week’s seat change',
    by: 'AI for Jimmy',
  };
  const summary: Section = {
    text: 'Brightway Studio is asking about a $38.20 charge on its latest invoice. The charge is checked against Stripe; no action is drafted yet.',
  };
  return {
    doc: {
      ownerId: 'jimmy',
      contributorIds: [],
      customer: { name: 'Brightway Studio', id: 'cus_Nf7a', confirmed: true },
      updated: 'just now · AI for Jimmy',
      sync: 'Synced',
      sections: {
        summary,
        customer: {
          rows: [
            ['Account', 'Brightway Studio · Team plan, annual'],
            ['Matched by', 'Ticket email matched one Stripe customer'],
          ],
        },
        problem: {
          rows: [
            ['Reported', '“What is this extra charge on my invoice?”'],
            ['Observed', 'One $38.20 line item on the latest invoice'],
          ],
        },
        findings: { entries: [guess] },
        next: { text: 'Jimmy checks the seat change in Stripe.' },
      },
      similar: [],
      log: [
        {
          time: 'now',
          text: 'AI for Jimmy · Findings: added “Guess: proration”',
        },
        { time: 'now', text: 'AI for Jimmy · Summary: added from this chat' },
        { time: 'now', text: `Jimmy · Created from chat · ${ticket}` },
      ],
      fresh: ['summary', 'f1'],
    },
    edits: [
      {
        what: 'added from this chat',
        change: { section: 'summary', after: summary },
      },
      {
        what: '+1 · Guess: proration from a seat change',
        change: { section: 'findings', entryId: 'f1', after: guess },
      },
    ],
  };
}

// Bring in Sam on Case #412: his findings land in the shared case.
export const samFinding: Entry = {
  id: 'f3',
  pill: 'Confirmed',
  text: 'Retry handler isn’t idempotent: it creates a new invoice on each retry',
  detail: 'web-app/src/billing/webhook.ts:88 @ 4f2c1a',
  by: 'AI for Sam',
};
export const samQuestions: Section = {
  entries: [
    {
      id: 'q1',
      pill: 'Answered',
      text: 'Is the retry window configurable? Can we stop the retry creating a second invoice?',
      detail:
        'Sam: Stripe retries for up to 3 days and we can’t change that. Fix: idempotency key on invoice creation (ENG-311).',
      by: 'AI for Sam',
    },
    {
      id: 'q2',
      pill: 'For Jimmy',
      text: 'What’s the request ID of the failed webhook?',
      by: 'Sam',
    },
  ],
};

export const refundVerified: Entry = {
  id: 'a1',
  pill: 'Verified',
  text: 'Refund $149.00 on ch_3PqK8L…',
  detail: 'Stripe shows re_3PqL9a… pending · checked by Supahelp',
  by: 'Jimmy',
};

export const resolution: Section = {
  rows: [
    [
      'What fixed it',
      'Refunded the duplicate invoice; idempotency key added in ENG-311',
    ],
    [
      'Root cause',
      'Webhook retry created a second invoice (no idempotency key)',
    ],
    ['Customer told', 'Refund of $149.00, 5–10 days to appear; fix shipped'],
    ['Playbook', 'Duplicate charge after webhook retry · used'],
  ],
};

export const playbookDraftStep = {
  id: 'd1',
  text: 'Pause the subscription’s next renewal before refunding, so the retry can’t charge again.',
  draft: 'New from Case #412',
};
