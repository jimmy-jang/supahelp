import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { LinearAccess, LinearAction } from '../../contracts/linear';
export type LinearRecord = {
  access: LinearAccess;
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  redirect?: string;
  actions: LinearAction[];
};
