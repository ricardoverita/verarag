import type { ApiErrorResponse } from '@verarag/contracts';
import { cookies } from 'next/headers';

import { isApiError } from './api-error';
import { SESSION_COOKIE_NAMES } from './api-proxy';

/** Where the web app's server reaches the API. Never exposed to the browser. */
export function apiUrl(): string {
  return process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
}

/** The browser's session cookie, as a Cookie header for calls to the API. */
export async function sessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  const parts = SESSION_COOKIE_NAMES.flatMap((name) => {
    const cookie = store.get(name);
    return cookie ? [`${name}=${cookie.value}`] : [];
  });
  return parts.length > 0 ? parts.join('; ') : undefined;
}

export type ServerResult<T> =
  { ok: true; data: T } | { ok: false; status: number; error: ApiErrorResponse['error'] };

/** A GET to the API on behalf of the signed-in user, from a Server Component. */
export async function serverGet<T>(path: string): Promise<ServerResult<T>> {
  const cookie = await sessionCookie();
  const response = await fetch(new URL(path, apiUrl()), {
    cache: 'no-store',
    headers: { accept: 'application/json', ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(5_000),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    return { ok: true, data: body as T };
  }
  if (isApiError(body)) {
    return { ok: false, status: response.status, error: body.error };
  }
  throw new Error(`the API answered ${path} with HTTP ${response.status}`);
}
