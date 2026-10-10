import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { config as proxyConfig } from '@/proxy';

/**
 * The proxy against a real HTTP server standing in for the API. These tests
 * show that bodies stream through it in both directions: the API sees the
 * first bytes of an upload while the browser is still sending, and the
 * browser gets the first bytes of a download while the API is still sending.
 */
describe('/api/v1 proxy', () => {
  let server: http.Server;
  let uploaded = 0;
  let uploadHeaders: http.IncomingHttpHeaders = {};
  let releaseDownload: () => void = () => {};
  let routes: typeof import('./route');

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method === 'POST') {
        uploadHeaders = req.headers;
        req.on('data', (chunk: Buffer) => {
          uploaded += chunk.length;
        });
        req.on('end', () => {
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ received: uploaded }));
        });
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': 'attachment; filename=page.html',
        'content-security-policy': "default-src 'none'; sandbox",
        'x-content-type-options': 'nosniff',
        server: 'internal',
      });
      res.write('first part ');
      releaseDownload = () => res.end('second part');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.API_INTERNAL_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    routes = await import('./route');
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 5_000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it('streams an upload to the API while it is still arriving', async () => {
    let browser!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        browser = controller;
      },
    });
    const request = new NextRequest('http://localhost:3000/api/v1/organizations/o/documents', {
      method: 'POST',
      body,
      duplex: 'half',
      headers: {
        'content-type': 'multipart/form-data; boundary=x',
        cookie: 'verarag_session=abc; other=1',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    });
    const response = routes.POST(request, {
      params: Promise.resolve({ path: ['organizations', 'o', 'documents'] }),
    });

    const first = new Uint8Array(256 * 1024).fill(97);
    browser.enqueue(first);
    // The API has bytes while the browser has not finished sending.
    await until(() => uploaded >= first.length);
    browser.enqueue(first);
    browser.close();

    const result = await response;
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({ received: first.length * 2 });
    expect(uploadHeaders.cookie).toBe('verarag_session=abc');
    expect(uploadHeaders.origin).toBeUndefined();
  });

  it('streams a download to the browser while the API is still sending, with its safety headers', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/v1/organizations/o/documents/d/content',
    );

    const response = await routes.GET(request, {
      params: Promise.resolve({ path: ['organizations', 'o', 'documents', 'd', 'content'] }),
    });
    const reader = response.body!.getReader();
    const first = await reader.read();

    expect(new TextDecoder().decode(first.value)).toBe('first part ');
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-disposition': 'attachment; filename=page.html',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    expect(response.headers.get('server')).toBeNull();
    releaseDownload();
    let rest = '';
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      rest += new TextDecoder().decode(chunk.value);
    }
    expect(rest).toBe('second part');
  });

  it('refuses a cross-site upload that carries the session cookie', async () => {
    const request = new NextRequest('http://localhost:3000/api/v1/organizations/o/documents', {
      method: 'POST',
      body: 'x',
      headers: {
        cookie: 'verarag_session=abc',
        origin: 'https://evil.example',
        host: 'localhost:3000',
      },
    });

    const response = await routes.POST(request, {
      params: Promise.resolve({ path: ['organizations', 'o', 'documents'] }),
    });

    expect(response.status).toBe(403);
  });

  it('keeps /api out of proxy.ts, which would buffer request bodies', () => {
    expect(proxyConfig.matcher.some((path) => path.startsWith('/api'))).toBe(false);
  });
});
