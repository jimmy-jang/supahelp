import type { ConnectionAccess, ConnectionAction } from './connections.ts';
export const ZENDESK_REDIRECT_URI =
  'http://127.0.0.1:49153/oauth/zendesk/callback';
export type ZendeskSetup = {
  site: string;
  access: ConnectionAccess;
};
export type ZendeskSnapshot = {
  revision: number;
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  access: ConnectionAccess;
  site?: string;
  clientId?: string;
  account?: string;
  role?: string;
  scopes: string[];
  message?: string;
  tools: { name: string; description?: string; readOnly: boolean }[];
  actions: ConnectionAction[];
};
