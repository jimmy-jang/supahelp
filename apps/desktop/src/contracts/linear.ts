import type { ConnectionAccess, ConnectionAction } from './connections.ts';
export type LinearAccess = ConnectionAccess;
export type LinearAction = ConnectionAction;
export type LinearSnapshot = {
  revision: number;
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  access: LinearAccess;
  account?: string;
  message?: string;
  tools: { name: string; description?: string; readOnly: boolean }[];
  actions: LinearAction[];
};
