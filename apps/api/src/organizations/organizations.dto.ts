import type {
  MemberView,
  MembersResponse,
  MembershipSummary,
  OrganizationDetail,
} from '@verarag/contracts';
import { z } from 'zod';

import type { MemberRecord, UserMembership } from './memberships.repository.js';
import {
  organizationNameSchema,
  organizationView,
  roleSchema,
  toOrganizationView,
} from './organization.views.js';

export const createOrganizationRequest = z.object({ name: organizationNameSchema });
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequest>;

export const updateOrganizationRequest = z.object({ name: organizationNameSchema });
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequest>;

export const updateMemberRequest = z.object({ role: roleSchema });
export type UpdateMemberRequest = z.infer<typeof updateMemberRequest>;

export const membershipIdParam = z.uuid();

export const membershipSummary = z.object({
  organization: organizationView,
  role: roleSchema,
  joinedAt: z.iso.datetime(),
}) satisfies z.ZodType<MembershipSummary>;

export const organizationsResponse = z.object({ organizations: z.array(membershipSummary) });

export const organizationDetail = z.object({
  organization: organizationView,
  role: roleSchema,
  memberCount: z.number().int(),
}) satisfies z.ZodType<OrganizationDetail>;

export const memberView = z.object({
  id: z.uuid(),
  user: z.object({ id: z.uuid(), email: z.string(), displayName: z.string() }),
  role: roleSchema,
  joinedAt: z.iso.datetime(),
}) satisfies z.ZodType<MemberView>;

export const membersResponse = z.object({
  members: z.array(memberView),
}) satisfies z.ZodType<MembersResponse>;

export function toMembershipSummary(membership: UserMembership): MembershipSummary {
  return {
    organization: toOrganizationView(membership.organization),
    role: membership.role,
    joinedAt: membership.joinedAt.toISOString(),
  };
}

export function toMemberView(member: MemberRecord): MemberView {
  return {
    id: member.id,
    user: member.user,
    role: member.role,
    joinedAt: member.createdAt.toISOString(),
  };
}
