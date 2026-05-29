import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import {
  cancelChapterContentGeneration,
  generateLectureOutline,
  startChapterContentGeneration,
  wasGenerationCancelled,
} from '../services/generator.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { dbGet, dbAll } from '../db-types.js';

export const lecturesRouter = Router();

// GET /api/courses/:id/lectures — list all lecture sections (grouped by chapter)
lecturesRouter.get('/:id/lectures', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  const rows = dbAll(
    'SELECT * FROM lectures WHERE course_id = ? ORDER BY sort_order ASC'
  , id);

  res.json(rows);
});

// POST /api/courses/:id/lectures/generate-outline — generate lecture outline from syllabus
lecturesRouter.post('/:id/lectures/generate-outline', asyncHandler(async (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  const course = dbGet('SELECT id FROM courses WHERE id = ?', id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }

  const existing = dbGet<{ c: number }>('SELECT COUNT(*) as c FROM lectures WHERE course_id = ?', id);
  if ((existing?.c ?? 0) > 0) {
    res.json({ message: '大纲已存在' });
    return;
  }

  // Respond immediately, generate in background
  res.json({ message: '正在生成讲义大纲...' });

  generateLectureOutline(id).then(() => {
    console.log(`[lectures] Outline generation done for course ${id}`);
  }).catch((err) => {
    console.error(`[lectures] Outline generation failed:`, err);
  });
}));

// POST /api/courses/:id/lectures/generate-chapter/:chapterNum — generate all sections in a chapter
lecturesRouter.post('/:id/lectures/generate-chapter/:chapterNum', asyncHandler(async (req: Request, res: Response) => {
  const db = getDb();
  const { id, chapterNum } = req.params;
  const chapter = parseInt(chapterNum, 10);

  if (isNaN(chapter) || chapter < 1) {
    res.status(400).json({ error: '章节号无效' });
    return;
  }

  const course = dbGet('SELECT id FROM courses WHERE id = ?', id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }

  // Check if chapter has sections in the outline
  const sections = dbAll(
    'SELECT id, status FROM lectures WHERE course_id = ? AND chapter_num = ? ORDER BY sort_order ASC'
  , id, chapter);

  if (sections.length === 0) {
    res.status(400).json({ error: '该章节不存在，请先生成讲义大纲' });
    return;
  }

  // Check if all sections already have content
  const pendingSections = sections.filter(s => s.status !== 'done');
  if (pendingSections.length === 0) {
    res.json({ message: '该章节已全部生成', chapter: chapter });
    return;
  }

  db.prepare(
    "UPDATE lectures SET status = 'generating' WHERE course_id = ? AND chapter_num = ? AND status != 'done'"
  ).run(id, chapter);

  // Respond immediately, generate in background
  res.json({ message: `正在生成第${chapter}章内容...`, chapter: chapter, sectionsCount: pendingSections.length });

  const generation = startChapterContentGeneration(id, chapter);
  if (!generation.started || !generation.promise) return;

  generation.promise.catch((err) => {
    if (wasGenerationCancelled(err)) {
      console.warn(`[lectures] Chapter ${chapter} generation cancelled`);
      return;
    }
    console.error(`[lectures] Chapter ${chapter} generation failed:`, err);
  });
}));

// POST /api/courses/:id/lectures/cancel-chapter/:chapterNum — reset generating sections back to pending
lecturesRouter.post('/:id/lectures/cancel-chapter/:chapterNum', (req: Request, res: Response) => {
  const db = getDb();
  const { id, chapterNum } = req.params;
  const chapter = parseInt(chapterNum, 10);

  if (isNaN(chapter) || chapter < 1) {
    res.status(400).json({ error: '章节号无效' });
    return;
  }

  const cancelled = cancelChapterContentGeneration(id, chapter);
  const result = db.prepare(
    "UPDATE lectures SET status = 'pending', content = NULL WHERE course_id = ? AND chapter_num = ? AND status = 'generating'"
  ).run(id, chapter);

  res.json({ success: true, cancelled, resetCount: result.changes });
});

// GET /api/courses/:id/lectures/:lectureId — get single section with content
lecturesRouter.get('/:id/lectures/:lectureId', (req: Request, res: Response) => {
  const db = getDb();
  const { id, lectureId } = req.params;

  const lecture = dbGet('SELECT * FROM lectures WHERE id = ? AND course_id = ?', lectureId, id);
  if (!lecture) {
    res.status(404).json({ error: '讲义小节不存在' });
    return;
  }

  res.json(lecture);
});
