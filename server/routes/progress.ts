import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { dbGet, dbAll } from '../db-types.js';

export const progressRouter = Router();

// PUT /api/courses/:id/progress — upsert progress row
progressRouter.put('/:id/progress', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { chapter_num, section_num, status, time_spent_seconds_delta } = req.body;

  if (chapter_num === undefined || section_num === undefined) {
    res.status(400).json({ error: '缺少 chapter_num 或 section_num 参数' });
    return;
  }

  const course = dbGet('SELECT id FROM courses WHERE id = ?', id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }

  const now = new Date().toISOString();

  // Check if row exists
  const existing = dbGet(
    'SELECT * FROM lecture_progress WHERE course_id = ? AND chapter_num = ? AND section_num = ?'
  , id, chapter_num, section_num);

  if (existing) {
    const newStatus = status || existing.status;
    const newTimeSpent = existing.time_spent_seconds + Math.max(0, Number(time_spent_seconds_delta) || 0);
    db.prepare(
      'UPDATE lecture_progress SET status = ?, time_spent_seconds = ?, last_visited_at = ? WHERE course_id = ? AND chapter_num = ? AND section_num = ?'
    ).run(newStatus, newTimeSpent, now, id, chapter_num, section_num);
  } else {
    const newStatus = status || 'reading';
    db.prepare(
      'INSERT INTO lecture_progress (course_id, chapter_num, section_num, status, time_spent_seconds, last_visited_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, chapter_num, newStatus, Math.max(0, Number(time_spent_seconds_delta) || 0), now);
  }

  res.json({ success: true });
});

// GET /api/courses/:id/progress — return all progress rows for a course
progressRouter.get('/:id/progress', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  const rows = dbAll(
    'SELECT * FROM lecture_progress WHERE course_id = ? ORDER BY chapter_num ASC, section_num ASC'
  , id);

  res.json(rows);
});

// PUT /api/courses/:id/progress/heartbeat — increment time by 30s, set status to reading if unread
progressRouter.put('/:id/progress/heartbeat', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { chapter_num, section_num } = req.body;

  if (chapter_num === undefined || section_num === undefined) {
    res.status(400).json({ error: '缺少 chapter_num 或 section_num 参数' });
    return;
  }

  const now = new Date().toISOString();

  const existing = dbGet(
    'SELECT * FROM lecture_progress WHERE course_id = ? AND chapter_num = ? AND section_num = ?'
  , id, chapter_num, section_num);

  if (existing) {
    const newStatus = existing.status === 'unread' ? 'reading' : existing.status;
    const newTimeSpent = existing.time_spent_seconds + 30;
    db.prepare(
      'UPDATE lecture_progress SET status = ?, time_spent_seconds = ?, last_visited_at = ? WHERE course_id = ? AND chapter_num = ? AND section_num = ?'
    ).run(newStatus, newTimeSpent, now, id, chapter_num, section_num);
  } else {
    db.prepare(
      'INSERT INTO lecture_progress (course_id, chapter_num, section_num, status, time_spent_seconds, last_visited_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, chapter_num, section_num, 'reading', 30, now);
  }

  res.json({ success: true });
});
