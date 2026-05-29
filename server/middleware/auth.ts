import { Request, Response, NextFunction } from 'express';
import { verifyToken, isAuthConfigured } from '../services/auth.js';

/**
 * JWT-based auth middleware for single-user local app.
 *
 * Flow:
 * 1. Client calls GET /api/auth/status (public) to check if password is set.
 * 2. Client calls POST /api/auth/setup or /api/auth/login (public) to get a JWT.
 * 3. Client sends Authorization: Bearer <jwt> on all subsequent API requests.
 * 4. This middleware validates the JWT on every protected request.
 */

/** Path prefixes that do NOT require authentication */
const PUBLIC_PREFIXES = [
  '/api/auth/',
  '/api/bootstrap',
];

export function getSessionToken(): string {
  // Kept for backward compatibility (WebSocket terminal auth)
  // Returns empty string — callers should use verifyToken() instead
  return '';
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow public paths (check prefix matching for /api/auth/*)
  if (PUBLIC_PREFIXES.some(p => req.path.startsWith(p)) || req.path === '/api/bootstrap') {
    next();
    return;
  }

  // Allow non-API paths (Vite HMR, static assets)
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }

  // If auth is not configured yet, allow all API requests (setup phase)
  if (!isAuthConfigured()) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '请先登录' });
    return;
  }

  const token = authHeader.slice(7);
  if (!verifyToken(token)) {
    res.status(401).json({ error: '登录已过期，请重新登录' });
    return;
  }

  next();
}
