import type { MemberRole, OrganizationView } from '@verarag/contracts';
import { z } from 'zod';

import type { OrganizationRecord } from './organizations.repository.js';
import { ROLES } from './roles.js';

export const roleSchema = z.enum(ROLES) satisfies z.ZodType<MemberRole>;

export const organizationView = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<OrganizationView>;

export const organizationNameSchema = z.string().trim().min(1).max(100);

export function toOrganizationView(record: OrganizationRecord): OrganizationView {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    createdAt: record.createdAt.toISOString(),
  };
}
