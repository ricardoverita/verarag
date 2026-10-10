/**
 * Pure helpers for the /api/v1 proxy. The browser only ever talks to the web
 * app: requests are passed on to the API from the server, so the API does
 * not need to be reachable from the internet and there is no CORS.
 */

/** Both names the API may use, depending on whether cookies are Secure. */
export const SESSION_COOKIE_NAMES = ['__Host-verarag_session', 'verarag_session'] as const;

/**
 * Request headers passed on to the API. Everything else stays here.
 * Content-Length lets the API refuse an oversized upload before reading it.
 */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'content-type',
  'content-length',
  'x-forwarded-for',
  'traceparent',
];

/**
 * Response headers passed back to the browser, besides Set-Cookie. They
 * include the ones that make a document download an attachment that is
 * never rendered.
 */
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'content-security-policy',
  'x-content-type-options',
  'cross-origin-resource-policy',
  'retry-after',
  'x-request-id',
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The API URL for a proxied path, or undefined when a segment could walk out
 * of /api/v1 (`..`) and reach routes that are not meant for browsers, such
 * as /metrics.
 */
export function upstreamUrl(apiUrl: string, segments: string[], search: string): URL | undefined {
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return undefined;
  }
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return new URL(`/api/v1/${path}${search}`, apiUrl);
}

/**
 * Cross-site request forgery check, the same one Next.js applies to Server
 * Actions: a browser always sends Origin with POST, PATCH and DELETE, and it
 * must be the host the request was sent to.
 *
 * Only requests that carry the session cookie need it: that cookie is what
 * a forged request would borrow. Programs calling with an API key and no
 * cookie send no Origin, and cannot be forged by another site.
 */
export function isSameOrigin(method: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method)) return true;
  if (!sessionCookieHeader(headers.get('cookie'))) return true;
  const origin = headers.get('origin');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Only the session cookie, never the other cookies of the web app. */
export function sessionCookieHeader(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const names: readonly string[] = SESSION_COOKIE_NAMES;
  const kept = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => names.includes(part.slice(0, part.indexOf('='))));
  return kept.length > 0 ? kept.join('; ') : undefined;
}

export function forwardRequestHeaders(incoming: Headers): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }
  const cookie = sessionCookieHeader(incoming.get('cookie'));
  if (cookie) headers.set('cookie', cookie);
  // API keys, so programs can use the web app's public URL. Browsers never
  // attach this header on their own, so it does not open a CSRF path.
  const authorization = incoming.get('authorization');
  if (authorization && /^bearer\s/i.test(authorization)) {
    headers.set('authorization', authorization);
  }
  return headers;
}

export function forwardResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.get(name);
    if (value) headers.set(name, value);
  }
  // Sign-in and sign-out set the session cookie on the web app's origin.
  for (const cookie of upstream.getSetCookie()) {
    headers.append('set-cookie', cookie);
  }
  return headers;
}
