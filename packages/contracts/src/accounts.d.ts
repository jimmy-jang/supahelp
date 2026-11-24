import type { OnboardingAnswers } from './onboarding.js';
export type { OnboardingAnswers } from './onboarding.js';
export type WorkspaceRole = 'admin' | 'member' | 'viewer';

export type AccessState =
  | 'setup'
  | 'active'
  | 'read-only'
  | 'locked'
  | 'revoked';

export type PublicAccount = { id: string; name: string; email: string };

export type OrganizationView = {
  id: string;
  name: string;
  icon?: string | null;
  ownerId: string;
  access: AccessState;
  capacity: number;
  assigned: number;
  reserved: number;
  source: 'none' | 'pilot' | 'trial' | 'paid';
  expiresAt: string | null;
};

export type BillingView = {
  enabled: boolean;
  trialAvailable: boolean;
  status: string;
  capacity: number;
  pendingCapacity: number | null;
  pendingAt: string | null;
  cancelAtPeriodEnd: boolean;
  hasSubscription: boolean;
  reviewRequired: boolean;
  pendingAction: boolean;
};

export type BillingRequest = {
  organizationId: string;
  requestId: string;
  action: 'trial' | 'checkout' | 'portal' | 'capacity' | 'resume' | 'retry';
  capacity?: number;
  previewId?: string;
};

export type BillingPreview = {
  id: string;
  capacity: number;
  amount: number;
  currency: 'usd';
  effectiveAt: string;
  expiresAt: string;
};

export type WorkspaceView = {
  id: string;
  organizationId: string;
  name: string;
  role: WorkspaceRole;
};

export type MemberView = {
  account: PublicAccount;
  role: WorkspaceRole;
  seated: boolean;
};

export type InvitationView = {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'declined';
  delivery: 'queued' | 'sent' | 'failed' | 'uncertain';
};

export type InvitationOffer = {
  organizationName: string;
  workspaceName: string;
  inviterName: string;
  role: WorkspaceRole;
  expiresAt: string;
};

/** A pending invitation addressed to the signed-in account's verified email. */
export type PendingInvitation = InvitationOffer & { id: string; token: string };

export type AccountView = {
  account: PublicAccount;
  organizations: OrganizationView[];
  workspaces: WorkspaceView[];
  // null: not answered yet. Absent: an account service without onboarding.
  onboarding?: OnboardingAnswers | null;
  onboardingCompleted?: boolean;
};
