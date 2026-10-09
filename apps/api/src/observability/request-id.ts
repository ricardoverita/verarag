import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

/**
 * Reuses the incoming request id when it looks safe, so a request can be
 * followed from the web app through the API and into the worker logs.
 * Anything else is replaced with a new UUID.
 */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return value !== undefined && SAFE_REQUEST_ID.test(value) ? value : randomUUID();
}
