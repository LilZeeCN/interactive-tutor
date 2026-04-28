/**
 * Generic SSE stream reader for POST-based server-sent events.
 * Eliminates the duplicated fetch+ReadableStream+TextDecoder pattern across the app.
 */

export interface SSEHandlers {
  onChunk?: (data: any) => void;
  onDone?: (data: any) => void;
  onError?: (msg: string) => void;
  /** Called when user aborts — partial content is available in data */
  onInterrupted?: (data: any) => void;
  /** Called for every parsed SSE event, regardless of type */
  onEvent?: (data: any) => void;
  /** Called when the connection drops and a retry is about to be attempted */
  onReconnecting?: (attempt: number) => void;
}

const CHUNK_TYPES = new Set([
  'chunk', 'user_ack', 'suggest_notes', 'summary', 'files', 'deep_solve',
]);

export async function readSSEStream(response: Response, handlers: SSEHandlers): Promise<void> {
  if (!response.ok) {
    handlers.onError?.(`HTTP ${response.status}`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';
  let errored = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          handlers.onEvent?.(data);
          if (CHUNK_TYPES.has(data.type)) {
            handlers.onChunk?.(data);
          } else if (data.type === 'done') {
            handlers.onDone?.(data);
          } else if (data.type === 'interrupted') {
            handlers.onInterrupted?.(data);
            errored = true;
            return;
          } else if (data.type === 'error') {
            handlers.onError?.(data.error || data.message || 'Unknown error');
            errored = true;
            return;
          }
        } catch {
          // skip malformed JSON lines
        }
      }

      if (errored) break;
    }

    // Flush remaining buffer
    if (!errored && buffer.startsWith('data: ')) {
      try {
        const data = JSON.parse(buffer.slice(6));
        handlers.onEvent?.(data);
        if (CHUNK_TYPES.has(data.type)) {
          handlers.onChunk?.(data);
        } else if (data.type === 'done') {
          handlers.onDone?.(data);
        } else if (data.type === 'interrupted') {
          handlers.onInterrupted?.(data);
        } else if (data.type === 'error') {
          handlers.onError?.(data.error || data.message || 'Unknown error');
        }
      } catch {
        // skip malformed JSON
      }
    }
  } catch {
    handlers.onError?.('Stream read failed');
  }
}

/**
 * Convenience: POST to url with body, read SSE response.
 */
export async function fetchSSE(url: string, body: any, handlers: SSEHandlers): Promise<Response> {
  const { authFetchInit } = await import('../lib/api');
  const { headers } = await authFetchInit();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  await readSSEStream(res, handlers);
  return res;
}

/**
 * Fetch SSE with automatic retry on network errors.
 * HTTP errors (4xx/5xx) are NOT retried — only connection failures.
 */
export async function fetchSSEWithRetry(
  url: string,
  body: any,
  handlers: SSEHandlers,
  options: { signal?: AbortSignal } = {},
): Promise<Response> {
  const maxRetries = 5;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (options.signal?.aborted) break;

    try {
      const { authFetchInit } = await import('../lib/api');
      const { headers } = await authFetchInit();
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });

      await readSSEStream(res, handlers);
      return res;
    } catch (err: any) {
      if (options.signal?.aborted) break;

      if (err.name === 'AbortError') {
        break; // User aborted — don't retry, don't call onError
      }

      lastError = err.message || 'Network error';
      if (attempt < maxRetries - 1) {
        handlers.onReconnecting?.(attempt + 1);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  if (lastError && !options.signal?.aborted) {
    handlers.onError?.(lastError);
  }

  return new Response(null, { status: 500 });
}

/**
 * Reconnecting indicator component state helper.
 */
export function createReconnectingState() {
  let reconnecting = false;
  let attempt = 0;

  return {
    start: () => { reconnecting = true; attempt = 0; },
    update: (a: number) => { reconnecting = true; attempt = a; },
    stop: () => { reconnecting = false; attempt = 0; },
    get isReconnecting() { return reconnecting; },
    get currentAttempt() { return attempt; },
  };
}
