import type { ApiErrorResponse } from '@verarag/contracts';

import { isApiError } from './api-error';

export type ApiError = ApiErrorResponse['error'];

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

const UNREACHABLE: ApiError = {
  code: 'SERVICE_UNAVAILABLE',
  message: 'Could not reach VeraRAG. Check your connection and try again.',
};

const UNEXPECTED: ApiError = {
  code: 'INTERNAL_ERROR',
  message: 'Something went wrong. Try again.',
};

/**
 * Calls the API from the browser through the web app's /api/v1 proxy. The
 * session cookie goes along on its own; nothing here can read it.
 */
export async function callApi<T = undefined>(
  path: string,
  { method = 'GET', body }: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, error: UNREACHABLE };
  }

  if (response.status === 204) {
    return { ok: true, data: undefined as T };
  }
  const json: unknown = await response.json().catch(() => undefined);
  if (response.ok) {
    return { ok: true, data: json as T };
  }
  return { ok: false, status: response.status, error: isApiError(json) ? json.error : UNEXPECTED };
}

/** Validation messages keyed by field, for showing them next to each input. */
export function fieldErrors(error: ApiError | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const detail of error?.details ?? []) {
    errors[detail.path] ??= detail.message;
  }
  return errors;
}
