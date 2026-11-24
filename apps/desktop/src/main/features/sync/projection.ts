import type { CaseRecord } from '../../../contracts/cases';
import type {
  SyncDocument,
  SyncLease,
  SyncOperation,
} from '../../../contracts/sync';

export function projectDocuments(
  docs: SyncDocument[],
  queue: SyncOperation[],
  lease: SyncLease,
  // When each op was queued; must be stable so repeated reads compare equal.
  queuedAt: (op: SyncOperation) => string,
): SyncDocument[] {
  for (const op of queue) {
    let doc = docs.find((d) => d.id === op.documentId);
    if (op.type === 'create-case' && !doc) {
      const at = queuedAt(op);
      doc = {
        id: op.documentId,
        kind: 'case',
        generation: 1,
        version: 0,
        record: {
          id: op.documentId,
          workspaceId: lease.workspaceId,
          number: 0,
          title: op.title!,
          ownerId: lease.accountId,
          ticket: '',
          status: 'inv',
          customer: { name: '', confirmed: false },
          chatIds: [],
          createdAt: at,
          updatedAt: at,
          entries: [],
          changes: [],
        },
      };
      docs.push(doc);
    }
    if (!doc) continue;
    if (op.type === 'delete' || op.type === 'flag') {
      docs = docs.filter((d) => d !== doc);
      continue;
    }
    if (doc.kind === 'case') {
      const c = doc.record as CaseRecord;
      if (op.type === 'title') c.title = op.title!;
      if (op.type === 'entry') {
        c.entries = c.entries.filter((e) => e.id !== op.entryId);
        if (op.value)
          c.entries.push({
            ...op.value,
            id: op.entryId!,
            position: c.entries.length,
            version: op.base + 1,
            authorId: lease.accountId,
            updatedAt: queuedAt(op),
          });
      }
    }
  }
  return docs;
}
