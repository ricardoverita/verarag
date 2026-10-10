import { type NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE_NAMES } from './lib/api-proxy';

/**
 * A quick redirect to the sign-in page when there is no session cookie at
 * all. It only looks at whether the cookie exists; the pages ask the API
 * whether it is valid.
 */
export function proxy(request: NextRequest) {
  if (SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name))) {
    return NextResponse.next();
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

/**
 * Never add /api here: Next.js buffers the body of every request that goes
 * through proxy.ts (up to 10 MB, then it truncates), which would break the
 * streaming of document uploads through /api/v1.
 */
export const config = {
  matcher: ['/dashboard', '/settings/:path*', '/organizations/:path*', '/collections/:path*'],
};
