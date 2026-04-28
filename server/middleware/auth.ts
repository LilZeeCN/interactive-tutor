import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

/**
 * Simple bearer-token auth for a single-user local app.
 *
 * Flow:
 * 1. Server generates a random session token on startup.
 * 2. Client fetches GET /api/bootstrap (unauthenticated) to obtain the token.
 * 3. Client sends Authorization: Bearer <token> on all subsequent requests.
 * 4. This middleware rejects any request without a valid token.
 *
 * This prevents casual network scanning from accessing the API.
 * For a local tool bound to 127.0.0.1 this is sufficient.
 */

const SESSION_TOKEN = randomBytes(32).toString('hex');

/** Paths that do NOT require authentication */
const PUBLIC_PATHS = new Set([
  '/api/bootstrap',     // token distribution
]);

export function getSessionToken(): string {
  return SESSION_TOKEN;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow public paths
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }

  // Allow non-API paths (Vite HMR, static assets)
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== SESSION_TOKEN) {
    res.status(403).json({ error: 'Invalid token' });
    return;
  }

  next();
}
