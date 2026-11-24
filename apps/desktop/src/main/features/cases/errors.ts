import { CHANGED_SINCE } from './service.ts';

const messages: Record<string, string> = {
  'sync-image-limit':
    'Team screenshots must be at most 2 MB after review. Resize the image and try again.',
  'sync-locked':
    'Team content is locked. Reconnect to authorize this computer.',
  'sync-read-only':
    'This workspace is read-only. Pending changes have not been uploaded.',
  'sync-deleted': 'This shared document was deleted or is unavailable.',
  'sync-unavailable-operation':
    'This operation is unavailable for team documents.',
  'resolve-owner':
    'Only the case owner can resolve or reopen this shared case.',
  'resolve-sync': 'Sync this case before continuing with its resolution.',
  'team-status':
    'Changing status is not available in team workspaces yet. Note who you are waiting on in the case instead.',
  'case-resolved': 'Reopen the case before changing its status.',
  'remove-actions':
    'Settle pending, running or uncertain actions before removing this case.',
  'remove-running': 'Stop the attached chat reply before removing this item.',
  'invalid-title': 'Use a title between 1 and 120 characters on one line.',
  'case-edit-busy':
    'A case edit is still being checked. Cancel it or wait for it to finish.',
  'case-edit-canceled': 'The edit was canceled. Nothing was saved.',
  'note-existing':
    'This resolution already has a Zendesk note or an uncertain outcome. Check its receipt before continuing.',
  'chat-has-case':
    'This chat already has a case. Start a new chat to attach another.',
  'unknown-playbook': 'This Playbook is unavailable in the current workspace.',
  'playbook-export-failed':
    'The Playbook could not be exported. Choose a writable folder and try again.',
  'no-draft': 'No saved draft is available.',
  'existing-draft': 'Finish or discard the existing Playbook draft first.',
  'invalid-screenshot':
    'Choose a PNG screenshot up to 10 MB and 4096 pixels per side. Confirm it contains no customer data.',
  'document-draft-failed':
    'The model could not draft this document. Nothing was saved. Check Models in Settings and your provider connection, then try again.',
  'document-draft-timeout':
    'The model took longer than 5 minutes to draft this document. Nothing was saved. Try again.',
  'document-draft-invalid':
    'The model returned a draft Supahelp could not read. Nothing was saved. Try again.',
  'document-draft-images':
    'The updated draft dropped screenshots from the published Playbook. Nothing was saved. Try again.',
  'document-draft-too-large':
    'This case and chat are too long to draft from. Nothing was saved. Shorten the case notes, then try again.',
  'document-draft-canceled': 'The draft was canceled. Nothing was saved.',
  'resolve-actions':
    'Check pending, running or uncertain actions before resolving this case.',
  'note-unavailable':
    'Connect Zendesk with write access and continue this resolved case in a chat with a linked ticket.',
  'case-changed': CHANGED_SINCE,
  'already-undone': 'Already undone.',
  'case-context': 'The account or workspace changed. Try again.',
  'case-masking-required':
    'Cases are waiting for masking. Check Models in Settings, then reopen this workspace.',
  'case-masking-failed':
    'Masking changed the screenshot references. Nothing was saved. Check the image links, then try again.',
  'case-recovery':
    'The case upgrade could not finish. Your records are preserved. Check Models and secure storage, then reopen Supahelp.',
  'unknown-case': 'This case is not available in the current workspace.',
  'customer-personal-only':
    'Use your personal workspace to access saved customers.',
  'search-preparing': 'Saved-work search is preparing. Try again shortly.',
  'search-unavailable':
    'Saved-work search is unavailable. Try again in this workspace.',
  'invalid-reference-search':
    'Use a customer or ticket search term of 1 to 120 characters.',
  'unknown-chat':
    'This chat is no longer open, so a case can’t be created from it.',
  'unknown-entry': 'This entry is no longer available. Read the case again.',
  'unknown-change': 'This change is no longer available.',
  'case-assignment-denied':
    'Only the case owner can assign an eligible workspace member. Personal cases can only select You.',
  'case-assignment-unconfirmed':
    'Assignment is waiting to sync or needs review. Check the current case before retrying.',
  'remove-admin-only':
    'Only workspace admins can remove shared cases and playbooks. Ask an admin to remove it.',
  'reserved-field':
    'This field cannot be changed through case notes. Use assignment tools for people; customer confirmation and verified action results are protected.',
  'invalid-entry': 'Use a valid case section, entry and current version.',
  'case-unchanged': 'The safely stored entry already has this value.',
  'case-turn-ended': 'This chat turn ended. No further case edits are allowed.',
  'case-limit':
    'This turn reached its case edit limit. Continue in the next message.',
};
export function publicCaseError(error: unknown) {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;
  if (code && Object.hasOwn(messages, code)) return messages[code];
  return error instanceof Error && Object.hasOwn(messages, error.message)
    ? messages[error.message]
    : 'The case operation could not finish. Your saved records are preserved.';
}
