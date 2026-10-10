import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { NestExpressApplication } from '@nestjs/platform-express';

import { clientIp } from './integration.js';

export interface UploadFile {
  name: string;
  type: string;
  content: Buffer;
}

/** The parts of a multipart/form-data body around one file, to send it in pieces. */
export function multipart(file: { name: string; type: string }, field = 'file') {
  const boundary = `----verarag-${randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${file.name}"\r\n` +
      `Content-Type: ${file.type}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { contentType: `multipart/form-data; boundary=${boundary}`, head, tail };
}

export interface RawResponse {
  status: number;
  body: unknown;
}

/** Listens on a random local port, for raw HTTP requests. */
export async function listen(app: NestExpressApplication): Promise<string> {
  const server: http.Server = app.getHttpServer();
  if (!server.listening) {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  }
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/**
 * Sends an upload with chunked encoding, so the API cannot know its size in
 * advance, writing it through `send`. Resolves with the parsed response.
 * Like a browser, it stops sending once the response has arrived: `write`
 * then rejects.
 */
export function streamUpload(
  baseUrl: string,
  path: string,
  cookie: string,
  file: { name: string; type: string },
  send: (write: (chunk: Buffer) => Promise<void>) => Promise<void>,
): { response: Promise<RawResponse>; finished: () => boolean } {
  const { contentType, head, tail } = multipart(file);
  let finished = false;
  let answered = false;
  const response = new Promise<RawResponse>((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'transfer-encoding': 'chunked',
        cookie,
        'x-forwarded-for': clientIp(),
      },
    });
    req.on('response', (res) => {
      answered = true;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        if (!finished) req.destroy();
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, body: text ? (JSON.parse(text) as unknown) : null });
      });
    });
    req.on('error', (error) => {
      if (!answered) reject(error);
    });
    const write = (chunk: Buffer) =>
      new Promise<void>((done, fail) => {
        if (answered) {
          fail(new Error('the server already answered'));
          return;
        }
        req.write(chunk, (error) => (error ? fail(error) : done()));
      });
    void (async () => {
      try {
        await write(head);
        await send(write);
        await write(tail);
        finished = true;
        req.end();
      } catch {
        // The server answered early and closed the connection.
      }
    })();
  });
  return { response, finished: () => finished };
}
