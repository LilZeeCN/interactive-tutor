import { Router, Request, Response } from 'express';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { isAuthConfigured, setupPassword, login } from '../services/auth.js';

export const authRouter = Router();

/**
 * GET /api/auth/status
 * Public endpoint — returns whether a password has been configured.
 */
authRouter.get('/status', (_req: Request, res: Response) => {
  res.json({ configured: isAuthConfigured() });
});

/**
 * POST /api/auth/setup
 * Public endpoint — first-time password setup.
 * Body: { password: string }
 * Returns: { token: string }
 */
authRouter.post('/setup', asyncHandler(async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: '请输入密码' });
    return;
  }
  try {
    const result = await setupPassword(password);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || '设置失败' });
  }
}));

/**
 * POST /api/auth/login
 * Public endpoint — authenticate with existing password.
 * Body: { password: string }
 * Returns: { token: string }
 */
authRouter.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password || typeof password !== 'string') {
    res.status(400).json({ error: '请输入密码' });
    return;
  }
  try {
    const result = await login(password);
    res.json(result);
  } catch (err: any) {
    res.status(401).json({ error: err.message || '登录失败' });
  }
}));
