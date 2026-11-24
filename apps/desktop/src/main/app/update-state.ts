import type { UpdateState } from '../../contracts/updates.ts';

export type UpdateEvent =
  | 'supported'
  | 'checking'
  | 'available'
  | 'none'
  | 'downloaded'
  | 'error';

// Squirrel events -> UI state. A downloaded update is never downgraded by a later
// check or error: restarting still installs it.
export function nextUpdateState(
  state: UpdateState,
  event: UpdateEvent,
  now = Date.now(),
): UpdateState {
  if (state.status === 'unsupported' && event !== 'supported') return state;
  if (state.status === 'ready') return state;
  switch (event) {
    case 'supported':
      return { ...state, status: 'idle' };
    case 'checking':
      return { ...state, status: 'checking' };
    case 'available':
      return { ...state, status: 'downloading' };
    case 'none':
      return { ...state, status: 'current', checkedAt: now };
    case 'downloaded':
      return { ...state, status: 'ready', checkedAt: now };
    case 'error':
      return { ...state, status: 'error', checkedAt: now };
  }
}

// Hourly and manual checks must not interrupt a check, download or finished update.
export const canCheck = (state: UpdateState) =>
  !['unsupported', 'checking', 'downloading', 'ready'].includes(state.status);
