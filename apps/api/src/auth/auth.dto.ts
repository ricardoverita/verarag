import type { MeResponse, RegisterResponse, UserView } from '@verarag/contracts';
import { z } from 'zod';

import {
  organizationNameSchema,
  organizationView,
  roleSchema,
} from '../organizations/organization.views.js';
import type { UserRecord } from './users.repository.js';

/**
 * Emails are compared trimmed, NFC-normalized and lowercased everywhere, so
 * "Ana@Example.com " and "ana@example.com" are the same account.
 */
export const emailSchema = z
  .string()
  .trim()
  .normalize('NFC')
  .toLowerCase()
  .pipe(z.email().max(254));

/**
 * At least 12 characters and no composition rules, following NIST SP 800-63B.
 * The upper bound keeps hashing cost predictable.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Use at most 128 characters.');

export const displayNameSchema = z.string().trim().min(1).max(100);

export const registerRequest = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  organizationName: organizationNameSchema,
});

export type RegisterRequest = z.infer<typeof registerRequest>;

export const userView = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<UserView>;

export const registerResponse = z.object({
  user: userView,
  organization: organizationView,
  role: roleSchema,
}) satisfies z.ZodType<RegisterResponse>;

export const loginRequest = z.object({
  email: emailSchema,
  // Only bounded: rules about length apply when a password is chosen, not when it is typed.
  password: z.string().min(1).max(128),
});

export type LoginRequest = z.infer<typeof loginRequest>;

export const meResponse = z.object({
  user: userView,
  memberships: z.array(
    z.object({
      organization: organizationView,
      role: roleSchema,
      joinedAt: z.iso.datetime(),
    }),
  ),
  session: z.object({ expiresAt: z.iso.datetime() }),
}) satisfies z.ZodType<MeResponse>;

export function toUserView(
  user: Pick<UserRecord, 'id' | 'email' | 'displayName' | 'createdAt'>,
): UserView {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}
