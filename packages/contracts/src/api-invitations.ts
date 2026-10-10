/**
 * HTTP payloads for invitations. Invitation tokens travel in request bodies,
 * never in API paths or query strings, so they do not end up in access logs.
 */
import type { MemberRole } from './api-identity.js';

export type InvitationStatus = 'pending' | 'expired' | 'accepted' | 'revoked';

/** An invitation as seen by the owners and admins of its organization. */
export interface InvitationView {
  id: string;
  email: string;
  role: MemberRole;
  status: InvitationStatus;
  invitedBy: { id: string; displayName: string };
  createdAt: string;
  expiresAt: string;
}

export interface CreateInvitationRequest {
  email: string;
  role: MemberRole;
}

/** The link is returned only here, once. Only its hash is stored. */
export interface CreatedInvitationResponse {
  invitation: InvitationView;
  inviteUrl: string;
}

export interface InvitationsResponse {
  invitations: InvitationView[];
}

export interface InvitationTokenRequest {
  token: string;
}

/** What the person holding an invitation link may see before accepting it. */
export interface InvitationPreview {
  organization: { name: string };
  email: string;
  role: MemberRole;
  invitedBy: { displayName: string };
  expiresAt: string;
}

/** Accepts an invitation by creating an account for the invited email. */
export interface RegisterWithInvitationRequest {
  token: string;
  displayName: string;
  password: string;
}
