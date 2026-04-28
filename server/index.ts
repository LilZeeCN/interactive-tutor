import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './db.js';
import { coursesRouter } from './routes/courses.js';
import { chatRouter } from './routes/chat.js';
import { contentRouter } from './routes/content.js';
import { settingsRouter } from './routes/settings.js';
import { reviewRouter } from './routes/review.js';
import { workspaceRouter } from './routes/workspace.js';
import { environmentRouter } from './routes/environment.js';
import { lecturesRouter } from './routes/lectures.js';
import { progressRouter } from './routes/progress.js';
import { versionsRouter } from './routes/versions.js';
import { exportRouter } from './routes/export.js';
import { reviewItemsRouter } from './routes/reviewItems.js';
import { TerminalManager } from './terminal/manager.js';
import { workspace } from './services/workspace.js';
import { asyncHandler } from './helpers/asyncHandler.js';
import { authMiddleware, getSessionToken } from './middleware/auth.js';
import { drainTasks } from './helpers/taskTracker.js';
import { recoverPendingGenerations } from './services/generator.js';

// Simple in-memory rate limiter with periodic cleanup
const rateLimits = new Map<string, { count: number; resetAt: number }>();
// Prune expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(key);
  }
}, 5 * 60_000);

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = rateLimits.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (entry.count >= maxRequests) {
      res.status(429).json({ error: '请求过于频繁，请稍后再试' });
      return;
    }
    entry.count++;
    next();
  };
}

const PORT = parseInt(process.env.PORT || '3001', 10);

export function createApp() {
  // Initialize database
  getDb();

  // Recover interrupted generation tasks from previous sessions
  recoverPendingGenerations().catch(err => console.error('[recovery] Startup recovery failed:', err));

  // Periodically check for stalled generation tasks (every 5 minutes)
  setInterval(() => {
    recoverPendingGenerations().catch(err => console.error('[recovery] Periodic recovery failed:', err));
  }, 5 * 60_000);

  const app = express();
  const server = createServer(app);

  // Middleware
  app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // unsafe-eval needed for Vite HMR in dev
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' ws: wss: http://localhost:*",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "worker-src 'self' blob:",
    ].join('; '));
    next();
  });

  // Bootstrap endpoint — serves the session auth token to the client (no auth needed)
  app.get('/api/bootstrap', (_req, res) => {
    res.json({ token: getSessionToken() });
  });

  // Auth middleware — applied AFTER bootstrap endpoint only
  app.use(authMiddleware);

  // Terminal token generation (requires auth)
  const terminalToken = randomBytes(32).toString('hex');
  app.get('/api/terminal-token', (_req, res) => {
    res.json({ token: terminalToken });
  });

  // Routes — AI generation endpoints get rate limiting (30 req/min), data reads are unrestricted
  const aiLimiter = rateLimit(30, 60_000);
  app.use('/api/courses', coursesRouter);
  app.use('/api/chat', aiLimiter, chatRouter);
  app.use('/api/courses', contentRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/review', aiLimiter, reviewRouter);
  app.use('/api/workspace', workspaceRouter);
  app.get('/api/environment/detect', asyncHandler(async (_req, res) => {
    const { detectAllRuntimes } = await import('./services/environment.js');
    const runtimes = await detectAllRuntimes();
    res.json(runtimes);
  }));
  app.use('/api/courses', aiLimiter, environmentRouter);
  app.use('/api/courses', lecturesRouter);
  app.use('/api/courses', progressRouter);
  app.use('/api/courses', versionsRouter);
  app.use('/api/courses', exportRouter);
  app.use('/api/courses', aiLimiter, reviewItemsRouter);

  // Global error handler (must be after all routes)
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: '服务器内部错误' });
    }
  });

  // WebSocket for terminal
  const wss = new WebSocketServer({ server, path: '/ws/terminal' });
  const terminalManager = new TerminalManager();

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const token = url.searchParams.get('token');
    if (token !== terminalToken) {
      ws.close(4001, 'Invalid terminal token');
      return;
    }
    // Also validate auth session token
    const authToken = url.searchParams.get('auth');
    if (authToken !== getSessionToken()) {
      ws.close(4003, '请先登录');
      return;
    }

    const sessionId = url.searchParams.get('sessionId') || 'default';
    const cwdParam = url.searchParams.get('cwd') || '';
    let cwd: string | undefined;
    if (cwdParam) {
      cwd = workspace.resolveCwd(cwdParam);
      console.log(`[terminal] cwdParam="${cwdParam}" → resolved="${cwd}"`);
    }

    try {
      terminalManager.create(sessionId, ws, cwd);
    } catch (err: any) {
      console.error('Terminal session creation failed:', err.message);
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'input') {
          terminalManager.write(sessionId, msg.data);
        } else if (msg.type === 'resize') {
          const cols = Math.max(10, Math.min(500, Math.round(Number(msg.cols) || 80)));
          const rows = Math.max(5, Math.min(100, Math.round(Number(msg.rows) || 24)));
          terminalManager.resize(sessionId, cols, rows);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      terminalManager.destroy(sessionId);
    });
  });

  return { app, server, terminalManager };
}

// Auto-start when run directly (not imported)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server, terminalManager } = createApp();

  server.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown — wait for background tasks before exiting
  const shutdown = async () => {
    console.log('\n[shutdown] Gracefully shutting down...');
    terminalManager.destroyAll();
    server.close(); // stop accepting new connections
    await drainTasks(10_000); // wait up to 10s for background tasks
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
