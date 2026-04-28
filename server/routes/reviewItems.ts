import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { sm2, generateReviewItems } from '../services/spacedRepetition.js';
import { dbGet, dbAll } from '../db-types.js';

export const reviewItemsRouter = Router();

// GET /api/courses/:id/review — get review items for a course
reviewItemsRouter.get('/:id/review', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const dueOnly = req.query.due_only !== 'false'; // default true

  const course = dbGet('SELECT id FROM courses WHERE id = ?', id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }

  let items: any[];
  if (dueOnly) {
    const now = new Date().toISOString();
    items = dbAll(
      'SELECT * FROM review_items WHERE course_id = ? AND next_review_at <= ? ORDER BY next_review_at ASC'
    , id, now);
  } else {
    items = dbAll(
      'SELECT * FROM review_items WHERE course_id = ? ORDER BY next_review_at ASC'
    , id);
  }

  const dueCountRow = dbGet<{ count: number }>(
    'SELECT COUNT(*) as count FROM review_items WHERE course_id = ? AND next_review_at <= ?'
  , id, new Date().toISOString());

  res.json({ items, dueCount: dueCountRow?.count || 0 });
});

// POST /api/courses/:id/review/generate — trigger review item generation in background
reviewItemsRouter.post('/:id/review/generate', asyncHandler(async (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { chapter_num } = req.body;

  if (chapter_num === undefined) {
    res.status(400).json({ error: '缺少 chapter_num 参数' });
    return;
  }

  const course = dbGet('SELECT id FROM courses WHERE id = ?', id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }

  // Respond immediately, generate in background
  res.json({ message: `正在生成第${chapter_num}章的复习题目...`, chapter_num });

  generateReviewItems(id, chapter_num).catch((err) => {
    console.error(`[review-items] Generation failed for chapter ${chapter_num}:`, err);
  });
}));

// PUT /api/courses/:id/review/:itemId — update review item with quality rating (SM-2)
reviewItemsRouter.put('/:id/review/:itemId', (req: Request, res: Response) => {
  const db = getDb();
  const { id, itemId } = req.params;
  const { quality } = req.body;

  if (quality === undefined || typeof quality !== 'number' || quality < 0 || quality > 5) {
    res.status(400).json({ error: '评分必须是 0-5 之间的数字' });
    return;
  }

  const item = dbGet('SELECT * FROM review_items WHERE id = ? AND course_id = ?', itemId, id);
  if (!item) {
    res.status(404).json({ error: '复习项不存在' });
    return;
  }

  const result = sm2(
    {
      ease_factor: item.ease_factor as number,
      interval_days: item.interval_days as number,
      review_count: item.review_count as number,
    },
    quality
  );

  db.prepare(
    'UPDATE review_items SET ease_factor = ?, interval_days = ?, next_review_at = ?, review_count = ? WHERE id = ?'
  ).run(result.ease_factor, result.interval_days, result.next_review_at, result.review_count, itemId);

  res.json({
    success: true,
    item: {
      ...item,
      ...result,
    },
  });
});
