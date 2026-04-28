/**
 * Type-safe helpers for better-sqlite3 queries.
 * Replaces `as any` / `as any[]` usage across the codebase.
 *
 * Usage:
 *   import { dbGet, dbAll } from './db-types.js';
 *   const course = dbGet<{ id: string; title: string }>('SELECT id, title FROM courses WHERE id = ?', id);
 *   const labs = dbAll<{ id: string; status: string }>('SELECT id, status FROM labs WHERE course_id = ?', courseId);
 */

import { getDb } from './db.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/** Execute a prepared statement and return a single typed row, or undefined. */
export function dbGet<T = AnyRecord>(
  sql: string,
  ...params: unknown[]
): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

/** Execute a prepared statement and return an array of typed rows. */
export function dbAll<T = AnyRecord>(
  sql: string,
  ...params: unknown[]
): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

/** Get a raw prepared statement for run/exec operations. */
export function dbRun(sql: string) {
  return getDb().prepare(sql);
}
