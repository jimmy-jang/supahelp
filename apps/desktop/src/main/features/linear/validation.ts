import type { LinearAccess } from '../../../contracts/linear';

export function linearAccess(value: unknown): LinearAccess {
  if (value !== 'read' && value !== 'write') throw Error('Invalid access.');
  return value;
}
