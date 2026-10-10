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

export const config = {
  matcher: ['/dashboard', '/settings/:path*', '/organizations/:path*'],
};
