import type { ArgumentsHost } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { ApiExceptionFilter } from './api-exception.filter.js';
import { AppError } from './app-error.js';

function run(exception: unknown) {
  const logger = { error: vi.fn() };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ id: 'req-1' }), getResponse: () => res }),
  } as unknown as ArgumentsHost;

  new ApiExceptionFilter(logger as unknown as PinoLogger).catch(exception, host);

  return {
    status: res.status.mock.calls[0]?.[0] as number,
    body: res.json.mock.calls[0]?.[0] as unknown,
    logger,
  };
}

describe('ApiExceptionFilter', () => {
  it('answers application errors with their code, message and request id', () => {
    const { status, body } = run(
      new AppError('VALIDATION_FAILED', undefined, [{ path: 'email', message: 'Invalid email' }]),
    );

    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request is not valid.',
        requestId: 'req-1',
        details: [{ path: 'email', message: 'Invalid email' }],
      },
    });
  });

  it('maps framework errors to stable codes', () => {
    expect(run(new NotFoundException()).body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(run(new ThrottlerException()).status).toBe(429);
    expect(
      run(Object.assign(new Error('request entity too large'), { status: 413 })).body,
    ).toMatchObject({
      error: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });

  it('hides unexpected errors from the client and logs them', () => {
    const failure = new Error('relation "users" does not exist');

    const { status, body, logger } = run(failure);

    expect(status).toBe(500);
    expect(body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side.',
        requestId: 'req-1',
      },
    });
    expect(JSON.stringify(body)).not.toContain('relation');
    expect(logger.error).toHaveBeenCalledWith({ err: failure }, 'request failed');
  });
});
