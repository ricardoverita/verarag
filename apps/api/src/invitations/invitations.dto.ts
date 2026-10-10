import type {
  CreatedInvitationResponse,
  InvitationPreview,
  InvitationsResponse,
  InvitationView,
} from '@verarag/contracts';
import { z } from 'zod';

import { displayNameSchema, emailSchema, passwordSchema } from '../auth/auth.dto.js';
import { roleSchema } from '../organizations/organization.views.js';
import { invitationStatus } from './invitation-rules.js';
import type { InvitationRecord, InvitationWithOrganization } from './invitations.repository.js';

/**
 * Only bounded: a malformed token is simply not found, like any other
 * unknown one, so the response says nothing about what a valid one looks like.
 */
const tokenSchema = z.string().min(1).max(256);

export const createInvitationRequest = z.object({ email: emailSchema, role: roleSchema });
export type CreateInvitationRequest = z.infer<typeof createInvitationRequest>;

export const invitationTokenRequest = z.object({ token: tokenSchema });
export type InvitationTokenRequest = z.infer<typeof invitationTokenRequest>;

export const registerWithInvitationRequest = z.object({
  token: tokenSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});
export type RegisterWithInvitationRequest = z.infer<typeof registerWithInvitationRequest>;

export const invitationIdParam = z.uuid();

export const invitationView = z.object({
  id: z.uuid(),
  email: z.string(),
  role: roleSchema,
  status: z.enum(['pending', 'expired', 'accepted', 'revoked']),
  invitedBy: z.object({ id: z.uuid(), displayName: z.string() }),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
}) satisfies z.ZodType<InvitationView>;

export const createdInvitationResponse = z.object({
  invitation: invitationView,
  inviteUrl: z.url(),
}) satisfies z.ZodType<CreatedInvitationResponse>;

export const invitationsResponse = z.object({
  invitations: z.array(invitationView),
}) satisfies z.ZodType<InvitationsResponse>;

export const invitationPreview = z.object({
  organization: z.object({ name: z.string() }),
  email: z.string(),
  role: roleSchema,
  invitedBy: z.object({ displayName: z.string() }),
  expiresAt: z.iso.datetime(),
}) satisfies z.ZodType<InvitationPreview>;

export function toInvitationView(invitation: InvitationRecord, now = new Date()): InvitationView {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitationStatus(invitation, now),
    invitedBy: invitation.invitedBy,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

/** Deliberately small: the token holder is not a member yet. */
export function toInvitationPreview(invitation: InvitationWithOrganization): InvitationPreview {
  return {
    organization: { name: invitation.organization.name },
    email: invitation.email,
    role: invitation.role,
    invitedBy: { displayName: invitation.invitedBy.displayName },
    expiresAt: invitation.expiresAt.toISOString(),
  };
}
