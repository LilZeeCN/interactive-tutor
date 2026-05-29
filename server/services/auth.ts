import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { getDb } from '../db.js';

// Derive JWT secret from ENCRYPTION_KEY (already required) for consistency across restarts
const JWT_SECRET = process.env.ENCRYPTION_KEY
  ? process.env.ENCRYPTION_KEY + '-jwt-suffix'
  : randomBytes(32).toString('hex');

const JWT_EXPIRY = '24h';
const SALT_ROUNDS = 10;

/** Check if a password has been configured */
export function isAuthConfigured(): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM auth_config WHERE id = 1').get() as { id: number } | undefined;
  return !!row;
}

/** First-time password setup */
export async function setupPassword(password: string): Promise<{ token: string }> {
  if (isAuthConfigured()) {
    throw new Error('密码已设置，请使用登录接口');
  }
  if (!password || password.length < 4) {
    throw new Error('密码长度不能少于4位');
  }
  const db = getDb();
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  db.prepare(
    'INSERT INTO auth_config (id, password_hash) VALUES (1, ?)'
  ).run(hash);
  const token = generateToken();
  return { token };
}

/** Verify password and return JWT */
export async function login(password: string): Promise<{ token: string }> {
  const db = getDb();
  const row = db.prepare('SELECT password_hash FROM auth_config WHERE id = 1').get() as { password_hash: string } | undefined;
  if (!row) {
    throw new Error('请先设置密码');
  }
  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    throw new Error('密码错误');
  }
  const token = generateToken();
  return { token };
}

/** Generate a JWT token */
export function generateToken(): string {
  return jwt.sign({ sub: 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/** Verify a JWT token, returns true if valid */
export function verifyToken(token: string): boolean {
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}
