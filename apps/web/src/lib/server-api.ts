import type { ApiErrorResponse } from '@verarag/contracts';
import { cookies, headers } from 'next/headers';

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

/**
 * A request to the API on behalf of the browser that is being served: with
 * its session cookie, and its address so per-client rate limits still apply.
 */
export async function serverRequest<T>(
  path: string,
  { method = 'GET', body }: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<ServerResult<T>> {
  const cookie = await sessionCookie();
  const forwardedFor = (await headers()).get('x-forwarded-for');
  const response = await fetch(new URL(path, apiUrl()), {
    method,
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  const json: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    return { ok: true, data: json as T };
  }
  if (isApiError(json)) {
    return { ok: false, status: response.status, error: json.error };
  }
  throw new Error(`the API answered ${method} ${path} with HTTP ${response.status}`);
}

export function serverGet<T>(path: string): Promise<ServerResult<T>> {
  return serverRequest<T>(path);
}
