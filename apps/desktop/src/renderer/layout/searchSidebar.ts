import type { Case } from '../features/cases/types';
import type { Chat } from '../features/chat/types';
import type { Playbook } from '../features/playbooks/types';

export type SearchSource = {
  chats: Pick<Chat, 'id' | 'title'>[];
  cases: Pick<Case, 'id' | 'title' | 'number' | 'customer' | 'ticket'>[];
  playbooks: Pick<Playbook, 'id' | 'title' | 'what'>[];
};

export function searchSidebar(source: SearchSource, query: string) {
  const q = query.trim().toLowerCase();
  return [
    ...source.chats.map((c) => ({
      ...c,
      kind: 'Chat' as const,
      text: c.title,
    })),
    ...source.cases.map((c) => ({
      id: c.id,
      title: c.title,
      kind: 'Case' as const,
      text: `${c.title} #${c.number} ${c.customer} ${c.ticket}`,
    })),
    ...source.playbooks.map((p) => ({
      id: p.id,
      title: p.title,
      kind: 'Playbook' as const,
      text: `${p.title} ${p.what}`,
    })),
  ].filter((result) => result.text.toLowerCase().includes(q));
}
