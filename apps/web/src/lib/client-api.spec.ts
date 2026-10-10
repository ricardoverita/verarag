import { afterEach, describe, expect, it, vi } from 'vitest';

import { callApi, fieldErrors } from './client-api';

describe('callApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends JSON and returns the data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 1 }, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callApi('/api/v1/organizations', { method: 'POST', body: { name: 'A' } });

    expect(result).toEqual({ ok: true, data: { id: 1 } });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/organizations',
      expect.objectContaining({ method: 'POST', body: '{"name":"A"}', credentials: 'same-origin' }),
    );
  });

  it('returns the API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'INVALID_CREDENTIALS', message: 'Nope.' } },
            { status: 401 },
          ),
        ),
    );

    expect(await callApi('/api/v1/auth/login', { method: 'POST', body: {} })).toEqual({
      ok: false,
      status: 401,
      error: { code: 'INVALID_CREDENTIALS', message: 'Nope.' },
    });
  });

  it('handles empty responses, unexpected bodies and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await callApi('/x', { method: 'DELETE' })).toEqual({ ok: true, data: undefined });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 500 })));
    expect(await callApi('/x')).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await callApi('/x')).toMatchObject({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
  });
});

describe('fieldErrors', () => {
  it('keeps the first message per field', () => {
    expect(
      fieldErrors({
        code: 'VALIDATION_FAILED',
        message: 'Invalid.',
        details: [
          { path: 'password', message: 'Use at least 12 characters.' },
          { path: 'password', message: 'Second.' },
          { path: 'email', message: 'Invalid email address' },
        ],
      }),
    ).toEqual({ password: 'Use at least 12 characters.', email: 'Invalid email address' });
  });
});
