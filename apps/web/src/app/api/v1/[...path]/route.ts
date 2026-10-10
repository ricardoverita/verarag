import type { ApiErrorResponse } from '@verarag/contracts';
import type { NextRequest } from 'next/server';

import {
  forwardRequestHeaders,
  forwardResponseHeaders,
  isSameOrigin,
  upstreamUrl,
} from '@/lib/api-proxy';
import { apiUrl } from '@/lib/server-api';

/** Matches the API's own body limit, with some room. */
const MAX_BODY_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;

/**
 * Passes browser requests to the API. The session cookie the API sets comes
 * back through here, so it belongs to the web app's origin and the browser
 * never talks to the API directly.
 */
async function proxy(
  request: NextRequest,
  { params }: RouteContext<'/api/v1/[...path]'>,
): Promise<Response> {
  if (!isSameOrigin(request.method, request.headers)) {
    return error(403, 'FORBIDDEN_ORIGIN', 'This request was sent from a site that is not allowed.');
  }
  const { path } = await params;
  const url = upstreamUrl(apiUrl(), path, request.nextUrl.search);
  if (!url) {
    return error(404, 'NOT_FOUND', 'The requested resource does not exist.');
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      return error(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
    }
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return error(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
    }
  }

  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers: forwardRequestHeaders(request.headers),
      body,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: forwardResponseHeaders(upstream.headers),
    });
  } catch {
    return error(
      502,
      'SERVICE_UNAVAILABLE',
      'VeraRAG is not available right now. Try again later.',
    );
  }
}

function error(status: number, code: ApiErrorResponse['error']['code'], message: string) {
  const body: ApiErrorResponse = { error: { code, message } };
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export { proxy as DELETE, proxy as GET, proxy as PATCH, proxy as POST };
