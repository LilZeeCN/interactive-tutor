import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { dbGet, dbAll } from '../db-types.js';

export const versionsRouter = Router();

// GET /api/courses/:id/lectures/:lectureId/versions — return all versions for a lecture
versionsRouter.get('/:id/lectures/:lectureId/versions', (req: Request, res: Response) => {
  const db = getDb();
  const { id, lectureId } = req.params;

  const lecture = dbGet('SELECT id FROM lectures WHERE id = ? AND course_id = ?', lectureId, id);
  if (!lecture) {
    res.status(404).json({ error: '讲义不存在' });
    return;
  }

  const versions = dbAll(
    'SELECT * FROM lecture_versions WHERE lecture_id = ? ORDER BY created_at DESC'
  , lectureId);

  res.json(versions);
});

// POST /api/courses/:id/lectures/:lectureId/versions/save — save current content as a version
versionsRouter.post('/:id/lectures/:lectureId/versions/save', (req: Request, res: Response) => {
  const db = getDb();
  const { id, lectureId } = req.params;

  const lecture = dbGet('SELECT content FROM lectures WHERE id = ? AND course_id = ?', lectureId, id);
  if (!lecture) {
    res.status(404).json({ error: '讲义不存在' });
    return;
  }

  if (!lecture.content || lecture.content.length === 0) {
    res.status(400).json({ error: '没有可保存的内容' });
    return;
  }

  // Check for duplicate
  const latest = dbGet(
    'SELECT content FROM lecture_versions WHERE lecture_id = ? ORDER BY created_at DESC LIMIT 1'
  , lectureId);

  if (latest && latest.content === lecture.content) {
    res.json({ message: '内容与最新版本相同', skipped: true });
    return;
  }

  const snapshotId = crypto.randomUUID();
  db.prepare(
    'INSERT INTO lecture_versions (id, lecture_id, content, created_at) VALUES (?, ?, ?, ?)'
  ).run(snapshotId, lectureId, lecture.content, new Date().toISOString());

  res.json({ id: snapshotId, message: '版本已保存' });
});

// POST /api/courses/:id/lectures/:lectureId/versions/:versionId/restore — restore a version
versionsRouter.post('/:id/lectures/:lectureId/versions/:versionId/restore', (req: Request, res: Response) => {
  const db = getDb();
  const { id, lectureId, versionId } = req.params;

  const lecture = dbGet('SELECT * FROM lectures WHERE id = ? AND course_id = ?', lectureId, id);
  if (!lecture) {
    res.status(404).json({ error: '讲义不存在' });
    return;
  }

  const version = dbGet('SELECT * FROM lecture_versions WHERE id = ? AND lecture_id = ?', versionId, lectureId);
  if (!version) {
    res.status(404).json({ error: '版本不存在' });
    return;
  }

  const now = new Date().toISOString();

  db.transaction(() => {
    // Snapshot current content as a new version before restoring
    if (lecture.content && lecture.content.length > 0) {
      const snapshotId = crypto.randomUUID();
      db.prepare(
        'INSERT INTO lecture_versions (id, lecture_id, content, created_at) VALUES (?, ?, ?, ?)'
      ).run(snapshotId, lectureId, lecture.content, now);
    }

    // Restore the target version's content
    db.prepare('UPDATE lectures SET content = ?, status = ? WHERE id = ?').run(version.content, 'done', lectureId);
  })();

  res.json({ success: true, restoredAt: now });
});
