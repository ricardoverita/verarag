import { describe, expect, it } from 'vitest';

import { downloadHeaders } from './download-headers.js';

describe('downloadHeaders', () => {
  it('always sends documents as attachments that cannot be sniffed or run', () => {
    const headers = downloadHeaders({
      filename: 'page.html',
      mediaType: 'text/html',
      sizeBytes: 42,
    });

    expect(headers).toEqual({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': '42',
      'Content-Disposition': 'attachment; filename=page.html',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
  });

  it('escapes quotes and encodes non-ASCII names', () => {
    const headers = downloadHeaders({
      filename: 'Manual "v2" año.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 1,
    });

    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Disposition']).toBe(
      `attachment; filename="Manual \\"v2\\" a?o.pdf"; filename*=UTF-8''Manual%20%22v2%22%20a%C3%B1o.pdf`,
    );
  });

  it('cannot be used to inject headers', () => {
    const header = downloadHeaders({
      filename: 'a\r\nSet-Cookie: x=1.txt',
      mediaType: 'text/plain',
      sizeBytes: 1,
    })['Content-Disposition'];

    expect(header).not.toMatch(/[\r\n]/);
  });
});
