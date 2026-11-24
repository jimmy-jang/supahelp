import type { ConnectionAccess, ConnectionAction } from './connections.ts';

export type ConnectionField = {
  key: string;
  label: string;
  secret?: boolean;
  multiline?: boolean;
  optional?: boolean;
  value?: string;
  choices?: string[];
};
export type ConnectionDefinition = {
  id: string;
  name: string;
  fields: ConnectionField[];
  instructions: string;
  documentation: string;
  readOnly?: boolean;
  requiresSupahelpAccount?: boolean;
};
// One REST operation as the Your REST API connection stores it (and as an OpenAPI import yields it).
export type ApiOperationDraft = {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  // Argument names sent as query parameters; the rest go in the JSON body. Omitted: GET sends all arguments as query.
  query?: string[];
};
export type ApiSpecRequest = {
  endpoint: string;
  header?: string;
  key?: string;
  // An explicit spec address, or the spec text itself (from a chosen file). Neither: look at the usual addresses.
  url?: string;
  text?: string;
};
export type ApiSpecPreview = {
  title?: string;
  source: string;
  operations: ApiOperationDraft[];
  skipped: string[];
};
export type CatalogSetup = {
  id: string;
  access: ConnectionAccess;
  values: Record<string, string>;
};
export type CatalogConnection = ConnectionDefinition & {
  // Set on one of the user's own servers/APIs: the template it was added from.
  instanceOf?: string;
  revision: number;
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  access: ConnectionAccess;
  account?: string;
  message?: string;
  manualReturn?: boolean;
  verificationCode?: string;
  // This build cannot sign in to it (no account service or public client ID).
  unavailable?: boolean;
  tools: {
    name: string;
    description?: string;
    readOnly: boolean;
    inputSchema: Record<string, unknown>;
    fingerprint: string;
  }[];
  actions: ConnectionAction[];
};
export type CatalogSnapshot = {
  revision: number;
  connections: CatalogConnection[];
  pendingReview?: readonly string[];
};
