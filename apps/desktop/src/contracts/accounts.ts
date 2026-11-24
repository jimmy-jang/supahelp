import type {
  AccountView,
  InvitationOffer,
  InvitationView,
  MemberView,
} from '@supahelp/contracts/accounts';
import type { OnboardingAnswers } from './onboarding.ts';
export type {
  AccessState,
  AccountView,
  BillingPreview,
  BillingRequest,
  BillingView,
  InvitationOffer,
  InvitationView,
  MemberView,
  OrganizationView,
  PublicAccount,
  WorkspaceRole,
  WorkspaceView,
} from '@supahelp/contracts/accounts';
export type { OnboardingAnswers };
export type ActiveContext =
  | { kind: 'personal' }
  | { kind: 'team'; organizationId: string; workspaceId: string };
export type ContextStamp = {
  generation: number;
  accountId: string | null;
  context: ActiveContext;
};
export type Scoped<T> = T & { context: ContextStamp };
export type AccountSnapshot = {
  membersWorkspaceId?: string;
  revision: number;
  context: ContextStamp;
  status: 'signed-out' | 'signing-in' | 'ready' | 'unavailable';
  view: AccountView | null;
  members: MemberView[];
  invitations: InvitationView[];
  billingReturnId?: string;
  pendingCaseLink?: { id: string; target: string; local?: boolean };
  pendingInvitation?: {
    id: string;
    status:
      | 'sign-in-required'
      | 'ready'
      | 'wrong-account'
      | 'expired'
      | 'unavailable';
    offer?: InvitationOffer;
  };
  error?: { code: string; message: string };
};
