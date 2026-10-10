import type { MemberRole, RegisterResponse } from '@verarag/contracts';

import { type IntegrationContext, newAccount, type TestAgent } from './integration.js';

export interface Person {
  client: TestAgent;
  userId: string;
  email: string;
  password: string;
  /** The organization created on registration, where the person is OWNER. */
  organizationId: string;
}

/** Registers a person through the API; their client keeps the session cookie. */
export async function signUp(
  ctx: IntegrationContext,
  overrides: Partial<Record<string, string>> = {},
): Promise<Person> {
  const account = newAccount(overrides);
  const client = ctx.client();
  const response = await client.post('/api/v1/auth/register').send(account).expect(201);
  const body = response.body as RegisterResponse;
  return {
    client,
    userId: body.user.id,
    email: account.email,
    password: account.password,
    organizationId: body.organization.id,
  };
}

/**
 * Adds an existing user to an organization directly in the database, for
 * tests that need several members without going through invitations.
 */
export async function addMember(
  ctx: IntegrationContext,
  organizationId: string,
  person: Person,
  role: MemberRole,
): Promise<string> {
  const { rows } = await ctx.db.pool.query<{ id: string }>(
    'INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3) RETURNING id',
    [organizationId, person.userId, role],
  );
  return rows[0]!.id;
}

export async function membershipId(
  ctx: IntegrationContext,
  organizationId: string,
  person: Person,
): Promise<string> {
  const { rows } = await ctx.db.pool.query<{ id: string }>(
    "SELECT id FROM memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
    [organizationId, person.userId],
  );
  return rows[0]!.id;
}
