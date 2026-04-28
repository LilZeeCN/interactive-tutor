import { Response, Request } from 'express';

const SSE_MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Set up SSE response headers and return helpers.
 * Includes a 15-second keepalive heartbeat to prevent proxy timeouts.
 * Auto-closes after SSE_MAX_DURATION_MS to prevent resource leaks.
 */
export function setupSSERes(res: Response, req: Request) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let disconnected = false;
  let ended = false;

  // Track disconnects via write errors instead of req.on('close'),
  // which fires prematurely in some Node.js/Express versions with SSE.
  res.on('close', () => { disconnected = true; });

  // Heartbeat every 15s to keep connection alive through proxies
  const heartbeat = setInterval(() => {
    if (disconnected || ended) { clearInterval(heartbeat); return; }
    try { res.write(':keepalive\n\n'); } catch { /* stream ended */ }
  }, 15_000);

  // Max duration timeout — prevent indefinite SSE connections
  const maxTimeout = setTimeout(() => {
    if (!disconnected && !ended) {
      try { res.write(`data: ${JSON.stringify({ type: 'error', error: 'Connection timed out' })}\n\n`); } catch { /* stream ended */ }
      cleanup(); // cleanup() now handles res.end()
    }
  }, SSE_MAX_DURATION_MS);

  const isDisconnected = () => disconnected || ended;
  const sendEvent = (data: any) => {
    if (disconnected || ended) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Stream already ended, ignore
    }
  };
  const cleanup = () => {
    if (ended) return; // already cleaned up — prevents double res.end()
    disconnected = true;
    ended = true;
    clearInterval(heartbeat);
    clearTimeout(maxTimeout);
    try { res.end(); } catch { /* response may already be ended */ }
  };

  return { isDisconnected, sendEvent, cleanup, res };
}
