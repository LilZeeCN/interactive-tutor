import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We import the real module and mock only the global fetch
import { apiFetch, invalidateAuthToken } from '../lib/api';

beforeEach(() => {
  vi.restoreAllMocks();
  // Clear the cached auth token so each test bootstraps fresh
  invalidateAuthToken();
});

afterEach(() => {
  invalidateAuthToken();
});

describe('apiFetch', () => {
  it('returns JSON on a successful response', async () => {
    const mockData = { courses: [{ id: '1', title: 'React Basics' }] };

    // First call: /api/bootstrap → returns token
    // Second call: the actual API request
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'test-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockData), { status: 200 }),
      );

    const result = await apiFetch('/api/courses');

    expect(result).toEqual(mockData);
  });

  it('throws an error on a non-OK HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'test-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
      );

    await expect(apiFetch('/api/courses/999')).rejects.toThrow('Not found');
  });

  it('throws an error on a non-OK response without JSON error body', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'test-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response('Plain text error', { status: 500 }),
      );

    await expect(apiFetch('/api/courses')).rejects.toThrow('HTTP 500');
  });

  it('throws an error on network failure', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'test-token' }), { status: 200 }),
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(apiFetch('/api/courses')).rejects.toThrow('Failed to fetch');
  });

  it('includes Authorization header in the request', async () => {
    let capturedHeaders: Headers | null = null;

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'abc-123' }), { status: 200 }),
      )
      .mockImplementationOnce((_url, init) => {
        capturedHeaders = (init as RequestInit).headers as Headers;
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
      });

    await apiFetch('/api/topics');

    expect(capturedHeaders?.get('Authorization')).toBe('Bearer abc-123');
  });

  it('passes custom init options through to fetch', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'test-token' }), { status: 200 }),
      )
      .mockImplementationOnce((_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        return Promise.resolve(
          new Response(JSON.stringify({ method: (init as RequestInit).method, body }), { status: 200 }),
        );
      });

    const result = await apiFetch('/api/courses', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test' }),
    });

    expect(result).toEqual({ method: 'POST', body: { title: 'Test' } });
  });
});
