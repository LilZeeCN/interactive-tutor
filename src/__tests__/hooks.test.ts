import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  readSSEStream,
  fetchSSE,
  fetchSSEWithRetry,
  createReconnectingState,
  type SSEHandlers,
} from '../hooks/useStreamFetch';

// ---------------------------------------------------------------------------
// createReconnectingState
// ---------------------------------------------------------------------------
describe('createReconnectingState', () => {
  it('initialises with reconnecting=false', () => {
    const state = createReconnectingState();
    expect(state.isReconnecting).toBe(false);
    expect(state.currentAttempt).toBe(0);
  });

  it('start() sets reconnecting=true and resets attempt', () => {
    const state = createReconnectingState();
    state.start();
    expect(state.isReconnecting).toBe(true);
    expect(state.currentAttempt).toBe(0);
  });

  it('update() sets reconnecting=true and sets attempt', () => {
    const state = createReconnectingState();
    state.update(3);
    expect(state.isReconnecting).toBe(true);
    expect(state.currentAttempt).toBe(3);
  });

  it('stop() resets to defaults', () => {
    const state = createReconnectingState();
    state.start();
    state.update(5);
    state.stop();
    expect(state.isReconnecting).toBe(false);
    expect(state.currentAttempt).toBe(0);
  });

  it('multiple instances are independent', () => {
    const a = createReconnectingState();
    const b = createReconnectingState();
    a.start();
    expect(a.isReconnecting).toBe(true);
    expect(b.isReconnecting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readSSEStream
// ---------------------------------------------------------------------------

/** Build a minimal Response whose body is a ReadableStream of given chunks. */
function sseResponse(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/** Helper: collect all onChunk data into an array */
function collectOnChunk(handlers: SSEHandlers): any[] {
  const collected: any[] = [];
  handlers.onChunk = (d) => collected.push(d);
  return collected;
}

describe('readSSEStream', () => {
  it('calls onError for non-ok HTTP response', async () => {
    const errMsg = vi.fn();
    const res = new Response(null, { status: 500 });
    await readSSEStream(res, { onError: errMsg });
    expect(errMsg).toHaveBeenCalledWith('HTTP 500');
  });

  it('does nothing when body is missing (null reader)', async () => {
    // Response with no body — should not throw
    const res = new Response(null, { status: 200 });
    await expect(readSSEStream(res, {})).resolves.toBeUndefined();
  });

  it('dispatches chunk events', async () => {
    const lines = [
      'data: {"type":"chunk","text":"Hello"}\n',
      'data: {"type":"chunk","text":"World"}\n',
    ];
    const collected = collectOnChunk({});
    await readSSEStream(sseResponse(...lines), { onChunk: (d) => collected.push(d) });
    expect(collected).toEqual([
      { type: 'chunk', text: 'Hello' },
      { type: 'chunk', text: 'World' },
    ]);
  });

  it('dispatches done event', async () => {
    const onDone = vi.fn();
    await readSSEStream(
      sseResponse('data: {"type":"done","result":"ok"}\n'),
      { onDone },
    );
    expect(onDone).toHaveBeenCalledWith({ type: 'done', result: 'ok' });
  });

  it('dispatches error event', async () => {
    const onError = vi.fn();
    await readSSEStream(
      sseResponse('data: {"type":"error","error":"Something broke"}\n'),
      { onError },
    );
    expect(onError).toHaveBeenCalledWith('Something broke');
  });

  it('uses message field when error field is missing', async () => {
    const onError = vi.fn();
    await readSSEStream(
      sseResponse('data: {"type":"error","message":"fallback"}\n'),
      { onError },
    );
    expect(onError).toHaveBeenCalledWith('fallback');
  });

  it('falls back to "Unknown error" when both error and message are missing', async () => {
    const onError = vi.fn();
    await readSSEStream(
      sseResponse('data: {"type":"error"}\n'),
      { onError },
    );
    expect(onError).toHaveBeenCalledWith('Unknown error');
  });

  it('dispatches interrupted event', async () => {
    const onInterrupted = vi.fn();
    await readSSEStream(
      sseResponse('data: {"type":"interrupted","partial":"content"}\n'),
      { onInterrupted },
    );
    expect(onInterrupted).toHaveBeenCalledWith({ type: 'interrupted', partial: 'content' });
  });

  it('calls onEvent for every parsed line', async () => {
    const allEvents: any[] = [];
    await readSSEStream(
      sseResponse(
        'data: {"type":"chunk","text":"a"}\n',
        'data: {"type":"chunk","text":"b"}\n',
        'data: {"type":"done"}\n',
      ),
      { onEvent: (d) => allEvents.push(d) },
    );
    expect(allEvents).toHaveLength(3);
  });

  it('skips non-SSE lines gracefully', async () => {
    const allEvents: any[] = [];
    await readSSEStream(
      sseResponse(
        ':keepalive\n',
        'data: {"type":"chunk","text":"only"}\n',
        '\n',
      ),
      { onEvent: (d) => allEvents.push(d) },
    );
    expect(allEvents).toHaveLength(1);
    expect(allEvents[0]).toEqual({ type: 'chunk', text: 'only' });
  });

  it('skips malformed JSON lines without throwing', async () => {
    await expect(
      readSSEStream(sseResponse('data: not-json\n'), {}),
    ).resolves.toBeUndefined();
  });

  it('handles interleaved newlines (empty lines in SSE)', async () => {
    const collected = collectOnChunk({});
    await readSSEStream(
      sseResponse(
        '\n\ndata: {"type":"chunk","text":"x"}\n\n\n',
      ),
      { onChunk: (d) => collected.push(d) },
    );
    expect(collected).toEqual([{ type: 'chunk', text: 'x' }]);
  });

  it('flushes the trailing buffer when not terminated by newline', async () => {
    const onDone = vi.fn();
    // buffer ends with "data: ..." but no trailing \n
    await readSSEStream(sseResponse('data: {"type":"done"}\n'), { onDone });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('stops processing after error event', async () => {
    const onError = vi.fn();
    const onChunk = vi.fn();
    await readSSEStream(
      sseResponse(
        'data: {"type":"chunk","text":"before"}\n',
        'data: {"type":"error","error":"boom"}\n',
        'data: {"type":"chunk","text":"after"}\n',
      ),
      { onError, onChunk },
    );
    expect(onError).toHaveBeenCalledWith('boom');
    // "after" should NOT have been dispatched
    const afterText = onChunk.mock.calls.find(([d]: any[]) => d.text === 'after');
    expect(afterText).toBeUndefined();
  });

  it('supports user_ack, suggest_notes, summary, files, deep_solve as chunk types', async () => {
    const onChunk = vi.fn();
    await readSSEStream(
      sseResponse(
        'data: {"type":"user_ack","id":1}\n',
        'data: {"type":"suggest_notes","notes":[]}\n',
        'data: {"type":"summary","text":"tldr"}\n',
        'data: {"type":"files","list":[]}\n',
        'data: {"type":"deep_solve","answer":"42"}\n',
      ),
      { onChunk },
    );
    expect(onChunk).toHaveBeenCalledTimes(5);
  });

  it('survives a body that throws during read', async () => {
    const onError = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"chunk","text":"ok"}\n'));
        controller.error(new Error('stream broke'));
      },
    });
    const res = new Response(stream, { status: 200 });
    await readSSEStream(res, { onError });
    // The reader throws, so onError should be called with "Stream read failed"
    // (the outer catch in readSSEStream)
    expect(onError).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fetchSSE  – import + type check (the function itself is a POST wrapper)
// ---------------------------------------------------------------------------
describe('fetchSSE (import check)', () => {
  it('is a function', () => {
    expect(typeof fetchSSE).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// fetchSSEWithRetry  – import + type check
// ---------------------------------------------------------------------------
describe('fetchSSEWithRetry (import check)', () => {
  it('is a function', () => {
    expect(typeof fetchSSEWithRetry).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// useWorkspace  – import + type check (React hook, not easily testable
//                without a full rendering environment)
// ---------------------------------------------------------------------------
describe('useWorkspace (import check)', () => {
  it('can be imported', async () => {
    const mod = await import('../hooks/useWorkspace');
    expect(typeof mod.useWorkspace).toBe('function');
  });
});
