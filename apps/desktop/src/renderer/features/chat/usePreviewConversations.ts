import { useState } from 'react';
import {
  createdDoc,
  initialCases,
  initialChats,
  playbookDraftStep,
  refundVerified,
  resolution,
  samFinding,
  samQuestions,
  type FixtureEdit,
} from '../../fixtures/conversations';
import { initialPlaybooks, member } from '../../fixtures/team';
import {
  applyChange,
  looksLikeTicket,
  sectionTitle,
  undoChange,
} from '../cases/caseDoc';
import { sortCases } from '../cases/sortCases';
import type { Attached, Case, Target } from '../cases/types';
import type { Playbook, Shot } from '../playbooks/types';
import type { Chat, Msg } from './types';

// UI preview only: every reply and every AI edit is canned, nothing leaves the
// app, and approvals here never authorize a real operation.
const looksLikeResolve = (t: string) =>
  /\b(resolve|close|is live|shipped)\b/i.test(t);
const canned: Msg = {
  kind: 'ai',
  text: 'This is a UI preview, so there is no real answer here yet.',
};

function reply(text: string): Msg[] {
  if (!looksLikeTicket(text)) return [canned];
  return [
    {
      kind: 'steps',
      tools: ['zendesk', 'stripe'],
      text: 'Checked 2 tools in 6s',
    },
    {
      kind: 'ai',
      text: 'Found the ticket and the matching Stripe customer. The customer is asking about a charge on their latest invoice.',
    },
    { kind: 'suggest' },
  ];
}

const now = () =>
  new Date()
    .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    .replace(/\s?[AP]M$/i, '');

export function usePreviewConversations() {
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [cases, setCases] = useState<Case[]>(() =>
    sortCases(initialCases.map((c) => ({ ...c, example: true }))),
  );
  const [playbooks, setPlaybooks] = useState<Playbook[]>(initialPlaybooks);

  // A thread is a preview chat or a case's own chat; ids never collide.
  const updateThread = (id: string, fn: (m: Msg[]) => Msg[]) => {
    setChats((cs) =>
      cs.map((c) => (c.id === id ? { ...c, messages: fn(c.messages) } : c)),
    );
    setCases((cs) =>
      cs.map((c) => (c.id === id ? { ...c, messages: fn(c.messages) } : c)),
    );
  };
  const push = (id: string, ...msgs: Msg[]) =>
    updateThread(id, (m) => [...m, ...msgs]);
  const setAttached = (id: string, fn: (a: Attached) => Attached) => {
    setChats((cs) =>
      cs.map((c) => (c.id === id ? { ...c, attached: fn(c.attached) } : c)),
    );
    setCases((cs) =>
      cs.map((c) => (c.id === id ? { ...c, attached: fn(c.attached) } : c)),
    );
  };
  const updateCase = (id: string, fn: (c: Case) => Case, sort = false) =>
    setCases((cs) => {
      const next = cs.map((c) => (c.id === id ? fn(c) : c));
      return sort ? sortCases(next) : next;
    });
  // Where "Case updated" lines for a case go: the chat it was created from, or its own.
  const threadOf = (c: Case) => c.chatId ?? c.id;

  // Simulated AI edit: apply the entries, mark them as just changed, log them
  // and post a "Case updated" line for each.
  const edit = (caseId: string, by: string, edits: FixtureEdit[]) => {
    const kase = cases.find((c) => c.id === caseId);
    if (!kase) return;
    updateCase(caseId, (c) => ({
      ...c,
      doc: {
        ...edits.reduce((d, e) => applyChange(d, e.change), c.doc),
        updated: `just now · ${by}`,
        fresh: edits.map((e) => e.change.entryId ?? e.change.section),
        log: [
          ...edits.map((e) => ({
            time: now(),
            text: `${by} · ${sectionTitle(e.change.section)}: ${e.what}`,
          })),
          ...c.doc.log,
        ],
      },
    }));
    push(
      threadOf(kase),
      ...edits.map(
        (e): Msg => ({
          kind: 'case-updated',
          caseId,
          section: e.change.section,
          what: e.what,
          change: e.change,
        }),
      ),
    );
  };

  const addToChat = (id: string, text: string) =>
    push(id, { kind: 'you', text }, ...reply(text));

  const resolve = (c: Case) => {
    push(threadOf(c), {
      kind: 'ai',
      text: 'I filled in **Resolution** from what we did and marked the case Resolved.',
    });
    edit(c.id, 'AI for Jimmy', [
      {
        what: 'added · what fixed it, root cause, customer told',
        change: {
          section: 'resolution',
          before: c.doc.sections.resolution,
          after: resolution,
        },
      },
    ]);
    updateCase(
      c.id,
      (x) => ({
        ...x,
        status: 'done',
        time: now(),
        doc: x.doc.playbook
          ? { ...x.doc, playbook: { ...x.doc.playbook, state: 'used' } }
          : x.doc,
      }),
      true,
    );
    push(threadOf(c), { kind: 'resolve', caseId: c.id });
  };

  const addToCase = (id: string, text: string) => {
    const c = cases.find((x) => x.id === id);
    push(id, { kind: 'you', text });
    if (c && c.status !== 'done' && looksLikeResolve(text)) resolve(c);
    else push(id, canned);
  };

  // Create case: the chat stays in Chats; the case document is written from
  // fixture data, attached to the chat and put at the top of Cases.
  const createCase = (chat: Chat) => {
    const ticket = chat.messages
      .map((m) => ('text' in m ? m.text : ''))
      .join(' ')
      .match(/tickets\/(\d+)|#(\d{3,})/);
    const num = ticket ? `ZD #${ticket[1] ?? ticket[2]}` : 'ZD #—';
    const id = `c${Date.now()}`;
    const number = Math.max(...cases.map((c) => c.number)) + 1;
    const { doc, edits } = createdDoc(num);
    setCases((cs) => [
      {
        id,
        example: true,
        number,
        ticket: num,
        title: chat.title,
        customer: doc.customer.name,
        status: 'inv',
        time: now(),
        messages: [],
        chatId: chat.id,
        doc,
        attached: { caseId: id, playbookIds: [] },
        questionsForYou: 0,
      },
      ...cs,
    ]);
    updateThread(chat.id, (ms) =>
      ms.flatMap((m): Msg[] =>
        m.kind === 'suggest'
          ? [
              {
                kind: 'created',
                text: `Case #${number} created from this chat · attached`,
              },
              ...edits.map(
                (e): Msg => ({
                  kind: 'case-updated',
                  caseId: id,
                  section: e.change.section,
                  what: e.what,
                  change: e.change,
                }),
              ),
            ]
          : [m],
      ),
    );
    setAttached(chat.id, (a) => ({ ...a, caseId: id }));
    return id;
  };

  const keepChat = (c: Chat) =>
    updateThread(c.id, (ms) => ms.filter((m) => m.kind !== 'suggest'));

  const approve = (id: string) => {
    const c = cases.find((x) => x.id === id);
    if (!c) return;
    updateCase(id, (x) => ({ ...x, approved: true, status: 'inv' }), true);
    edit(id, 'Supahelp', [
      {
        what: 'Refund verified in Stripe',
        change: {
          section: 'actions',
          entryId: 'a1',
          before: c.doc.sections.actions?.entries?.find((e) => e.id === 'a1'),
          after: refundVerified,
        },
      },
    ]);
  };

  // Undo reverts that one entry, or says why it can't.
  const undo = (threadId: string, index: number) => {
    const all = [...chats, ...cases];
    const msg = all.find((t) => t.id === threadId)?.messages[index];
    if (msg?.kind !== 'case-updated' || msg.note) return;
    const c = cases.find((x) => x.id === msg.caseId);
    if (!c) return;
    const result = undoChange(c.doc, msg.change);
    if ('doc' in result)
      updateCase(c.id, (x) => ({
        ...x,
        doc: {
          ...result.doc,
          fresh: [],
          log: [
            {
              time: now(),
              text: `Jimmy · ${sectionTitle(msg.section)}: undid “${msg.what}”`,
            },
            ...x.doc.log,
          ],
        },
      }));
    updateThread(threadId, (ms) =>
      ms.map((m, i) =>
        i === index && m.kind === 'case-updated'
          ? { ...m, note: 'doc' in result ? 'Undone' : result.error }
          : m,
      ),
    );
  };

  const attach = (threadId: string, target: Target) =>
    setAttached(threadId, (a) =>
      'caseId' in target
        ? { ...a, caseId: target.caseId }
        : a.playbookIds.includes(target.playbookId)
          ? a
          : { ...a, playbookIds: [...a.playbookIds, target.playbookId] },
    );
  const detach = (threadId: string, target: Target) =>
    setAttached(threadId, (a) =>
      'caseId' in target
        ? { ...a, caseId: undefined }
        : {
            ...a,
            playbookIds: a.playbookIds.filter((p) => p !== target.playbookId),
          },
    );

  const note = (c: Case, text: string) => {
    push(threadOf(c), { kind: 'created', text });
    updateCase(c.id, (x) => ({
      ...x,
      doc: {
        ...x.doc,
        updated: `just now · Jimmy`,
        log: [{ time: now(), text: `Jimmy · ${text}` }, ...x.doc.log],
      },
    }));
  };

  // Bring in: they become a contributor (and would be notified). On Case #412,
  // Sam's work from his own chat then syncs into the shared case.
  const bringIn = (caseId: string, memberId: string) => {
    const c = cases.find((x) => x.id === caseId);
    if (!c || c.doc.contributorIds.includes(memberId)) return;
    updateCase(caseId, (x) => ({
      ...x,
      doc: { ...x.doc, contributorIds: [...x.doc.contributorIds, memberId] },
    }));
    note(c, `Brought in ${member(memberId).name}`);
    if (memberId !== 'sam' || c.id !== 'c1') return;
    setTimeout(() => {
      updateCase(caseId, (x) => ({
        ...x,
        questionsForYou: 1,
        doc: { ...x.doc, issue: 'Linear ENG-311' },
      }));
      edit(caseId, 'AI for Sam', [
        {
          what: '+1 · Confirmed: retry handler isn’t idempotent',
          change: { section: 'findings', entryId: 'f3', after: samFinding },
        },
        {
          what: '+2 · Answered “Is the retry window configurable?” · 1 for you',
          change: {
            section: 'questions',
            before: c.doc.sections.questions,
            after: samQuestions,
          },
        },
      ]);
    }, 1500);
  };

  const handOff = (caseId: string, memberId: string) => {
    const c = cases.find((x) => x.id === caseId);
    if (!c || c.doc.ownerId === memberId) return;
    updateCase(caseId, (x) => ({
      ...x,
      doc: {
        ...x.doc,
        ownerId: memberId,
        contributorIds: [
          ...x.doc.contributorIds.filter((m) => m !== memberId),
          x.doc.ownerId,
        ],
      },
    }));
    note(c, `Handed off to ${member(memberId).name}`);
  };

  // Resolve card choice. Returns the Playbook to open, if any.
  const resolveChoice = (
    threadId: string,
    index: number,
    choice: 'update' | 'create' | 'later',
  ) => {
    const msg = [...chats, ...cases].find((t) => t.id === threadId)?.messages[
      index
    ];
    if (msg?.kind !== 'resolve') return;
    const c = cases.find((x) => x.id === msg.caseId);
    updateThread(threadId, (ms) =>
      ms.map((m, i) =>
        i === index && m.kind === 'resolve'
          ? {
              ...m,
              choice: {
                update: 'Updating the Playbook',
                create: 'Creating a new Playbook',
                later: 'Not now',
              }[choice],
            }
          : m,
      ),
    );
    if (!c || choice === 'later') return;
    const from = `Draft from Case #${c.number}`;
    let id = c.doc.playbook?.id ?? 'pb1';
    if (choice === 'update')
      setPlaybooks((ps) =>
        ps.map((p) =>
          p.id === id && !p.draftFrom
            ? {
                ...p,
                draftFrom: from,
                steps: [
                  ...p.steps.slice(0, 2),
                  { ...playbookDraftStep, draft: `New from Case #${c.number}` },
                  ...p.steps.slice(2),
                ],
              }
            : p,
        ),
      );
    else {
      id = `pb${Date.now()}`;
      setPlaybooks((ps) => [
        {
          id,
          title: c.title,
          authorId: 'jimmy',
          published: 'not yet',
          uses: 0,
          draftFrom: from,
          what: c.doc.sections.summary?.text ?? '',
          steps: (c.doc.sections.findings?.entries ?? [])
            .filter((e) => e.pill === 'Confirmed')
            .map((e, i) => ({
              id: `d${i}`,
              text: `Check: ${e.text}.`,
              draft: 'AI draft',
            })),
        },
        ...ps,
      ]);
    }
    push(threadId, { kind: 'playbook-ready', playbookId: id });
    attach(threadId, { playbookId: id });
    return id;
  };

  const updatePlaybook = (id: string, fn: (p: Playbook) => Playbook) =>
    setPlaybooks((ps) => ps.map((p) => (p.id === id ? fn(p) : p)));
  const publish = (id: string) =>
    updatePlaybook(id, (p) => ({
      ...p,
      draftFrom: undefined,
      published: 'just now',
      steps: p.steps.map((s) => ({ ...s, draft: undefined })),
    }));
  const discardDraft = (id: string) =>
    updatePlaybook(id, (p) => ({
      ...p,
      draftFrom: undefined,
      steps: p.steps.filter((s) => !s.draft),
    }));
  const addScreenshot = (id: string) =>
    updatePlaybook(id, (p) => ({
      ...p,
      draftFrom: p.draftFrom ?? 'Draft',
      steps: [
        ...p.steps,
        {
          id: `s${Date.now()}`,
          text: 'New screenshot. Describe what it shows.',
          draft: 'Added by you',
          shot: { label: 'Screenshot', clean: false, blurred: false },
        },
      ],
    }));
  const toggleShot = (
    id: string,
    stepId: string,
    key: keyof Omit<Shot, 'label'>,
  ) =>
    updatePlaybook(id, (p) => ({
      ...p,
      steps: p.steps.map((s) =>
        s.id === stepId && s.shot
          ? { ...s, shot: { ...s.shot, [key]: !s.shot[key] } }
          : s,
      ),
    }));

  return {
    chats,
    cases,
    playbooks,
    addToChat,
    addToCase,
    createCase,
    keepChat,
    approve,
    undo,
    attach,
    detach,
    bringIn,
    handOff,
    resolveChoice,
    publish,
    discardDraft,
    addScreenshot,
    toggleShot,
  };
}
