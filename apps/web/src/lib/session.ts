import type { MembershipSummary, MeResponse } from '@verarag/contracts';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { pickMembership } from './organizations';
import { serverGet } from './server-api';

/** Remembers which organization the user was looking at. Only a preference. */
export const ORGANIZATION_COOKIE = 'verarag_org';

/**
 * The signed-in user, or null. Asked once per request, however many
 * components need it. The API decides; the presence of a cookie means nothing.
 */
export const getSession = cache(async (): Promise<MeResponse | null> => {
  const result = await serverGet<MeResponse>('/api/v1/auth/me');
  if (result.ok) return result.data;
  if (result.status === 401) return null;
  throw new Error(`could not load the session: ${result.error.code}`);
});

/** For pages that need a signed-in user: anyone else goes to the sign-in page. */
export async function requireSession(): Promise<MeResponse> {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  return session;
}

/**
 * The organization the user is working in: the one they picked last if they
 * still belong to it, otherwise the first one. The API checks membership on
 * every request anyway; this only chooses what to show.
 */
export async function currentMembership(session: MeResponse): Promise<MembershipSummary | null> {
  const preferred = (await cookies()).get(ORGANIZATION_COOKIE)?.value;
  return pickMembership(session.memberships, preferred);
}
