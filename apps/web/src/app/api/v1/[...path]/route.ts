import type { ApiErrorResponse } from '@verarag/contracts';
import type { NextRequest } from 'next/server';

import {
  forwardRequestHeaders,
  forwardResponseHeaders,
  isSameOrigin,
  upstreamUrl,
} from '@/lib/api-proxy';
import { apiUrl } from '@/lib/server-api';

/** How long the API may take to start answering. Uploads get longer: the answer comes after the file. */
const TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 15 * 60_000;

/**
 * Passes browser requests to the API. The session cookie the API sets comes
 * back through here, so it belongs to the web app's origin and the browser
 * never talks to the API directly.
 *
 * Bodies stream in both directions and are never read whole: an upload goes
 * from the browser to the API as it arrives, and a download from the API to
 * the browser. The API enforces its own size limits. This works because
 * Next.js passes the incoming request stream to route handlers untouched,
 * and only buffers bodies for paths that proxy.ts matches, which must never
 * include /api.
 */
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  if (!isSameOrigin(request.method, request.headers)) {
    return error(403, 'FORBIDDEN_ORIGIN', 'This request was sent from a site that is not allowed.');
  }
  const { path } = await params;
  const url = upstreamUrl(apiUrl(), path, request.nextUrl.search);
  if (!url) {
    return error(404, 'NOT_FOUND', 'The requested resource does not exist.');
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  // The timeout only covers waiting for the answer; once it starts, a long
  // download keeps going. A browser that leaves cancels the call to the API.
  const abort = new AbortController();
  const cancel = () => abort.abort();
  request.signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, hasBody ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS);

  try {
    // `duplex: 'half'` lets Node's fetch send a body that is still arriving;
    // TypeScript's RequestInit does not list it yet.
    const init: RequestInit & { duplex: 'half' } = {
      method: request.method,
      headers: forwardRequestHeaders(request.headers),
      body: hasBody ? request.body : undefined,
      duplex: 'half',
      cache: 'no-store',
      redirect: 'manual',
      signal: abort.signal,
    };
    const upstream = await fetch(url, init);
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
  } finally {
    clearTimeout(timer);
  }
}

function error(status: number, code: ApiErrorResponse['error']['code'], message: string) {
  const body: ApiErrorResponse = { error: { code, message } };
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export { proxy as DELETE, proxy as GET, proxy as PATCH, proxy as POST };
