import type {
  AccountSnapshot,
  ContextStamp,
} from '../../../contracts/accounts.ts';

export function newerAccount(current: AccountSnapshot, next: AccountSnapshot) {
  return (
    next.context.generation > current.context.generation ||
    (next.context.generation === current.context.generation &&
      next.revision > current.revision)
  );
}

export function sameContext(
  current: ContextStamp,
  next: ContextStamp | undefined,
) {
  return (
    !!next &&
    current.generation === next.generation &&
    current.accountId === next.accountId &&
    current.context.kind === next.context.kind &&
    (current.context.kind === 'personal' ||
      (next.context.kind === 'team' &&
        current.context.organizationId === next.context.organizationId &&
        current.context.workspaceId === next.context.workspaceId))
  );
}

// Main rejects calls stamped before a sign-in/switch finished. The fresh
// snapshot is already on its way, so this is not a failure to show.
export const isContextChanged = (message: string | undefined) =>
  !!message?.startsWith('The account or workspace changed');
