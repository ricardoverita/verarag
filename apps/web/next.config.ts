import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Only the directives that do not need per-request nonces. A script-src
  // policy needs a nonce on every response, which would turn the prerendered
  // shells into fully dynamic pages; it is pending, see SECURITY.md.
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // The monorepo root, so the standalone build includes workspace dependencies.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: securityHeaders },
      // Invitation links carry their token in the path: never send it on as a
      // Referer, and keep the pages out of search engines.
      {
        source: '/invitations/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
      // The /api/v1 proxy only answers JSON and document downloads, which must
      // never run anything. These headers replace whatever a route handler
      // sets, including the API's own download policy, so the strictest one
      // is set here: a page from /api can load nothing and is sandboxed.
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; sandbox; frame-ancestors 'none'",
          },
        ],
      },
    ]);
  },
};

export default nextConfig;
