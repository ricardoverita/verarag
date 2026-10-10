import { describe, expect, it } from 'vitest';

import nextConfig from '../next.config';

describe('next.config headers', () => {
  it('sandboxes everything served under /api, downloads included', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const matching = rules.filter((rule) => ['/:path*', '/api/:path*'].includes(rule.source));
    // When several rules set the same header, Next.js keeps the last one.
    const csp = matching
      .flatMap((rule) => rule.headers)
      .filter((header) => header.key === 'Content-Security-Policy')
      .at(-1);

    expect(matching.map((rule) => rule.source)).toEqual(['/:path*', '/api/:path*']);
    expect(csp?.value).toContain("default-src 'none'");
    expect(csp?.value).toContain('sandbox');
  });
});
