'use server';

import { cookies, headers } from 'next/headers';

import { isOrganizationId } from '@/lib/organizations';
import { ORGANIZATION_COOKIE } from '@/lib/session';

/**
 * Remembers the organization the user switched to. It is only a preference:
 * every request for organization data is checked against the membership by
 * the API, so a forged value shows nothing the user cannot already see.
 */
export async function selectOrganization(organizationId: string): Promise<void> {
  if (!isOrganizationId(organizationId)) return;
  const secure = (await headers()).get('x-forwarded-proto') === 'https';
  (await cookies()).set(ORGANIZATION_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  });
}
