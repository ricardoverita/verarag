import { describe, expect, it } from 'vitest';

import {
  forwardRequestHeaders,
  forwardResponseHeaders,
  isSameOrigin,
  sessionCookieHeader,
  upstreamUrl,
} from './api-proxy';

describe('upstreamUrl', () => {
  it('maps the path under /api/v1 of the API', () => {
    expect(upstreamUrl('http://api:3001', ['organizations', 'abc', 'members'], '?x=1')?.href).toBe(
      'http://api:3001/api/v1/organizations/abc/members?x=1',
    );
  });

  it('encodes each segment', () => {
    expect(upstreamUrl('http://api:3001', ['a b', 'c/d'], '')?.pathname).toBe(
      '/api/v1/a%20b/c%2Fd',
    );
  });

  it('refuses segments that would leave /api/v1', () => {
    expect(upstreamUrl('http://api:3001', ['..', '..', 'metrics'], '')).toBeUndefined();
    expect(upstreamUrl('http://api:3001', ['auth', '.'], '')).toBeUndefined();
    expect(upstreamUrl('http://api:3001', ['auth', ''], '')).toBeUndefined();
  });
});

describe('isSameOrigin', () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it('lets safe methods through', () => {
    expect(isSameOrigin('GET', headers({}))).toBe(true);
  });

  it('requires an Origin that matches the host when the session cookie is sent', () => {
    const cookie = 'verarag_session=abc';
    expect(
      isSameOrigin(
        'POST',
        headers({ origin: 'http://localhost:3000', host: 'localhost:3000', cookie }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        'POST',
        headers({ origin: 'https://evil.example', host: 'localhost:3000', cookie }),
      ),
    ).toBe(false);
    expect(isSameOrigin('DELETE', headers({ host: 'localhost:3000', cookie }))).toBe(false);
    expect(isSameOrigin('PATCH', headers({ origin: 'null', host: 'localhost:3000', cookie }))).toBe(
      false,
    );
  });

  it('does not ask for an Origin when no session cookie is sent', () => {
    expect(
      isSameOrigin('POST', headers({ host: 'localhost:3000', authorization: 'Bearer vrg_x' })),
    ).toBe(true);
    expect(
      isSameOrigin('POST', headers({ origin: 'https://evil.example', host: 'localhost:3000' })),
    ).toBe(true);
  });

  it('uses the forwarded host behind a reverse proxy', () => {
    expect(
      isSameOrigin(
        'POST',
        headers({
          origin: 'https://verarag.example',
          host: 'web:3000',
          'x-forwarded-host': 'verarag.example',
          cookie: '__Host-verarag_session=abc',
        }),
      ),
    ).toBe(true);
  });
});

describe('sessionCookieHeader', () => {
  it('keeps only the session cookie', () => {
    expect(sessionCookieHeader('theme=dark; verarag_session=abc; verarag_org=x')).toBe(
      'verarag_session=abc',
    );
    expect(sessionCookieHeader('__Host-verarag_session=abc')).toBe('__Host-verarag_session=abc');
    expect(sessionCookieHeader('theme=dark')).toBeUndefined();
    expect(sessionCookieHeader(null)).toBeUndefined();
  });
});

describe('forwardRequestHeaders', () => {
  it('passes on a short list of headers and the session cookie only', () => {
    const forwarded = forwardRequestHeaders(
      new Headers({
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: 'verarag_session=abc; other=1',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'x-forwarded-for': '203.0.113.7',
      }),
    );

    expect(Object.fromEntries(forwarded)).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      cookie: 'verarag_session=abc',
      'x-forwarded-for': '203.0.113.7',
    });
  });

  it('passes on bearer API keys but no other credentials', () => {
    expect(
      forwardRequestHeaders(new Headers({ authorization: 'Bearer vrg_key' })).get('authorization'),
    ).toBe('Bearer vrg_key');
    expect(
      forwardRequestHeaders(new Headers({ authorization: 'Basic dXNlcjpwYXNz' })).get(
        'authorization',
      ),
    ).toBeNull();
  });
});

describe('forwardResponseHeaders', () => {
  it('passes back every Set-Cookie and never lets the response be cached', () => {
    const upstream = new Headers({ 'content-type': 'application/json', server: 'internal' });
    upstream.append('set-cookie', 'verarag_session=abc; Path=/; HttpOnly');
    upstream.append('set-cookie', 'other=1; Path=/');

    const headers = forwardResponseHeaders(upstream);

    expect(headers.getSetCookie()).toEqual([
      'verarag_session=abc; Path=/; HttpOnly',
      'other=1; Path=/',
    ]);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('server')).toBeNull();
  });
});
