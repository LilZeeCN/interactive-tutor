/**
 * Authenticated API client.
 *
 * On first call, fetches a session token from /api/bootstrap,
 * then includes it as a Bearer token on all subsequent requests.
 */

let sessionToken: string | null = null;
let bootstrapPromise: Promise<string> | null = null;

async function bootstrap(): Promise<string> {
  const res = await fetch('/api/bootstrap');
  if (!res.ok) throw new Error('Failed to bootstrap auth');
  const data = await res.json();
  sessionToken = data.token as string;
  return sessionToken;
}

export async function getAuthToken(): Promise<string> {
  if (sessionToken) return sessionToken;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = bootstrap();

  try {
    return await bootstrapPromise;
  } catch (err) {
    bootstrapPromise = null;
    console.error('[auth] Bootstrap failed:', err);
    throw new Error('Auth bootstrap failed');
  }
}

/** Call when a 401 is received to force re-bootstrap on next request */
export function invalidateAuthToken(): void {
  sessionToken = null;
  bootstrapPromise = null;
}

/**
 * Wrapper around fetch that checks response status and throws on HTTP errors.
 * Automatically includes the auth token as a Bearer header.
 */
export async function apiFetch<T = any>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch { /* ignore parse error */ }
    throw new Error(message);
  }
  return res.json();
}

/**
 * Build authenticated fetch options for SSE streams and other direct fetch calls.
 * Usage: const res = await fetch('/api/chat', { ...authFetchInit(), body: JSON.stringify({...}) })
 */
export async function authFetchInit(): Promise<{ headers: Headers }> {
  const token = await getAuthToken();
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  return { headers };
}
