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
import { authRouter } from './routes/auth.js';
import { TerminalManager } from './terminal/manager.js';
import { workspace } from './services/workspace.js';
import { asyncHandler } from './helpers/asyncHandler.js';
import { authMiddleware } from './middleware/auth.js';
import { isAuthConfigured, verifyToken } from './services/auth.js';
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

export async function createApp() {
  // Initialize database
  getDb();

  // Verify API key integrity
  const db = getDb();
  console.log(`[startup] ENCRYPTION_KEY present: ${!!process.env.ENCRYPTION_KEY}, length: ${process.env.ENCRYPTION_KEY?.length || 0}`);
  const apiKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'api_key'").get() as { value: string } | undefined;
  if (apiKeyRow?.value) {
    const crypto = await import('crypto');
    const { verifyStoredKey } = await import('./services/crypto.js');
    const valid = verifyStoredKey(apiKeyRow.value);
    const currentFingerprint = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY!).digest('hex').slice(0, 16);
    const storedFingerprint = (db.prepare("SELECT value FROM settings WHERE key = 'encryption_fingerprint'").get() as { value: string } | undefined)?.value;
    if (!valid) {
      const reason = storedFingerprint && storedFingerprint !== currentFingerprint
        ? `ENCRYPTION_KEY changed (was ${storedFingerprint}, now ${currentFingerprint})`
        : 'unknown — encryption key mismatch';
      console.warn(`[startup] API Key decryption failed — ${reason}. Clearing corrupted key.`);
      db.prepare("DELETE FROM settings WHERE key = 'api_key'").run();
      db.prepare("UPDATE courses SET generation_error = 'API Key 失效，请重新在设置中保存' WHERE id IN (SELECT c.id FROM courses c WHERE NOT EXISTS (SELECT 1 FROM syllabus s WHERE s.course_id = c.id))").run();
    } else {
      console.log(`[startup] API Key verified OK (fingerprint: ${currentFingerprint})`);
    }
  } else {
    console.log('[startup] No API Key configured — run in Settings first');
  }

  // Check if API key exists before running recovery
  const hasApiKey = () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'api_key'").get() as { value: string } | undefined;
    return !!row?.value;
  };

  if (hasApiKey()) {
    recoverPendingGenerations().catch(err => console.error('[recovery] Startup recovery failed:', err));
  }

  // Periodically check for stalled generation tasks (every 5 minutes)
  setInterval(() => {
    if (hasApiKey()) {
      recoverPendingGenerations().catch(err => console.error('[recovery] Periodic recovery failed:', err));
    }
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

  // ── Request logging middleware ──
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // Bootstrap endpoint — returns auth status (public, no auth needed)
  app.get('/api/bootstrap', (_req, res) => {
    res.json({ configured: isAuthConfigured() });
  });

  // Auth middleware — applied AFTER bootstrap endpoint only
  app.use(authMiddleware);

  // Terminal token generation (requires auth)
  const terminalToken = randomBytes(32).toString('hex');
  app.get('/api/terminal-token', (_req, res) => {
    res.json({ token: terminalToken });
  });

  // Routes — non-rate-limited data routers first, then AI-limited ones
  const aiLimiter = rateLimit(30, 60_000);
  app.use('/api/courses', coursesRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/courses', contentRouter);
  app.use('/api/courses', lecturesRouter);
  app.use('/api/courses', progressRouter);
  app.use('/api/courses', versionsRouter);
  app.use('/api/courses', exportRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/workspace', workspaceRouter);
  app.get('/api/environment/detect', asyncHandler(async (_req, res) => {
    const { detectAllRuntimes } = await import('./services/environment.js');
    const runtimes = await detectAllRuntimes();
    res.json(runtimes);
  }));
  // AI/heavy endpoints — rate limited (30 req/min per IP)
  app.use('/api/chat', aiLimiter, chatRouter);
  app.use('/api/review', aiLimiter, reviewRouter);
  app.use('/api/courses', aiLimiter, environmentRouter);
  app.use('/api/courses', aiLimiter, reviewItemsRouter);

  // ── Global error handler (must be after all routes) ──
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const correlationId = randomBytes(4).toString('hex');
    console.error(`[${correlationId}] Unhandled error on ${req.method} ${req.path}:`, err);
    if (!res.headersSent) {
      const body: Record<string, string> = {
        error: '服务器内部错误',
        correlationId,
        timestamp: new Date().toISOString(),
      };
      if (process.env.NODE_ENV !== 'production') {
        body.message = err.message;
      }
      res.status(500).json(body);
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
    // Also validate JWT token
    const authToken = url.searchParams.get('auth');
    if (!authToken || !verifyToken(authToken)) {
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
  const { server, terminalManager } = await createApp();

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
