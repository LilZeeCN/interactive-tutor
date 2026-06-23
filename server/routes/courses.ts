import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import {
  cancelLabDetailGeneration,
  cancelProjectDetailGeneration,
  createAndGenerateLab,
  createAndGenerateProject,
  generateCourseContent,
  generateCourseOutline,
  startLabDetailGeneration,
  startProjectDetailGeneration,
  wasGenerationCancelled,
} from '../services/generator.js';
import { workspace } from '../services/workspace.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { dbGet, dbAll } from '../db-types.js';
import { requireFields, validateId } from '../middleware/validate.js';

export const coursesRouter = Router();

function getGenerationErrorMessage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed?.error ? parsed.message || 'AI 生成失败，请重试' : null;
  } catch {
    return null;
  }
}

// GET /api/courses - list all courses
coursesRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const courses = dbAll<{ id: string; title: string; description: string; content: string; requirements: string; lectureStyle: string; lectureFormat: string; createdAt: string }>('SELECT id, title, description, content, requirements, lecture_style as lectureStyle, lecture_format as lectureFormat, created_at as createdAt FROM courses ORDER BY created_at DESC');
  res.json(courses);
});

// GET /api/courses/:id - get single course
coursesRouter.get('/:id', validateId('id'), (req: Request, res: Response) => {
  const db = getDb();
  const course = dbGet<{ id: string; title: string; description: string; content: string; requirements: string; lectureStyle: string; lectureFormat: string; createdAt: string }>('SELECT id, title, description, content, requirements, lecture_style as lectureStyle, lecture_format as lectureFormat, created_at as createdAt FROM courses WHERE id = ?', req.params.id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }
  res.json(course);
});

// POST /api/courses - create course & trigger content generation
coursesRouter.post('/', requireFields('title'), (req: Request, res: Response) => {
  const db = getDb();
  const { title, description, content, requirements, lectureStyle } = req.body;

  if (!title?.trim()) {
    res.status(400).json({ error: '标题不能为空' });
    return;
  }

  // Coerce string fields to ensure type safety (non-string values → empty string)
  const safeDescription = typeof description === 'string' ? description : '';
  const safeContent = typeof content === 'string' ? content : '';
  const safeRequirements = typeof requirements === 'string' ? requirements : '';
  const validStyles = ['khanmigo', 'chatgpt-learn', 'feynman', 'socratic', 'first-principles', 'harvard-tutor'];
  const safeLectureStyle = validStyles.includes(lectureStyle) ? lectureStyle : 'khanmigo';

  const id = uuidv4();
  const createdAt = new Date().toISOString();

  db.prepare(
    'INSERT INTO courses (id, title, description, content, requirements, lecture_style, lecture_format, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title.trim(), safeDescription, safeContent, safeRequirements, safeLectureStyle, 'markdown', createdAt);

  const course = dbGet<{ id: string; title: string; description: string; content: string; requirements: string; lectureStyle: string; lectureFormat: string; createdAt: string }>('SELECT id, title, description, content, requirements, lecture_style as lectureStyle, lecture_format as lectureFormat, created_at as createdAt FROM courses WHERE id = ?', id);
  res.status(201).json(course);

  // Only generate outline (syllabus + lab/project lists) — details generated on demand
  generateCourseOutline({ id, title: title.trim(), description: safeDescription, content: safeContent, requirements: safeRequirements, createdAt }).catch((err) => {
    console.error('Outline generation failed for course', id, err);
    const msg = err instanceof Error ? err.message : String(err);
    try { db.prepare('UPDATE courses SET generation_error = ? WHERE id = ?').run(msg, id); } catch { /* ignore */ }
  });
});

// POST /api/courses/:id/generate-lab/:labId — generate single lab detail on demand
coursesRouter.post('/:id/generate-lab/:labId', asyncHandler(async (req: Request, res: Response) => {
  const { id, labId } = req.params;
  const db = getDb();
  const lab = dbGet<{ instructions?: string }>('SELECT * FROM labs WHERE id = ? AND course_id = ?', labId, id);
  if (!lab) { res.status(404).json({ error: '实验不存在' }); return; }

  const labErrorMessage = getGenerationErrorMessage(lab.instructions);

  // If already has real content, return it directly. Error markers should retry.
  if (lab.instructions && lab.instructions.length > 10 && !labErrorMessage) {
    res.json({ success: true, message: '已生成' });
    return;
  }
  if (labErrorMessage) {
    console.warn(`[courses] Retrying failed lab ${labId}. Previous error: ${labErrorMessage}`);
  }

  db.prepare("UPDATE labs SET status = 'in-progress' WHERE id = ? AND course_id = ?").run(labId, id);

  const generation = startLabDetailGeneration(id, labId);
  if (!generation.started || !generation.promise) {
    res.json({ success: true, message: '生成中...' });
    return;
  }
  res.json({ success: true, message: '生成中...' });

  generation.promise.catch((err) => {
    if (wasGenerationCancelled(err)) {
      console.warn(`Lab detail generation cancelled: ${labId}`);
      return;
    }
    console.error(`Lab detail generation failed: ${labId}`, err);
    // Mark lab with error instructions so frontend stops polling
    const db = getDb();
    const message = err instanceof Error ? err.message : String(err);
    db.prepare('UPDATE labs SET instructions = ? WHERE id = ? AND course_id = ?').run(
      JSON.stringify({ error: true, message: message || 'AI 生成失败，请重试' }),
      labId, id
    );
  });
}));

// POST /api/courses/:id/cancel-lab/:labId — cancel in-flight lab generation
coursesRouter.post('/:id/cancel-lab/:labId', asyncHandler(async (req: Request, res: Response) => {
  const { id, labId } = req.params;
  const db = getDb();
  const cancelled = cancelLabDetailGeneration(labId);
  db.prepare("UPDATE labs SET status = 'pending', instructions = '', starter_code = '', test_cases = '[]' WHERE id = ? AND course_id = ? AND status = 'in-progress'").run(labId, id);
  res.json({ success: true, cancelled });
}));

// DELETE /api/courses/:id/labs/:labId
coursesRouter.delete('/:id/labs/:labId', (req: Request, res: Response) => {
  const db = getDb();
  const { id, labId } = req.params;
  db.prepare('DELETE FROM labs WHERE id = ? AND course_id = ?').run(labId, id);
  res.json({ success: true });
});

// POST /api/courses/:id/generate-project/:projectId — generate single project detail on demand
coursesRouter.post('/:id/generate-project/:projectId', asyncHandler(async (req: Request, res: Response) => {
  const { id, projectId } = req.params;
  const db = getDb();
  const proj = dbGet<{ starter_code?: string }>('SELECT * FROM projects WHERE id = ? AND course_id = ?', projectId, id);
  if (!proj) { res.status(404).json({ error: '项目不存在' }); return; }

  const projectErrorMessage = getGenerationErrorMessage(proj.starter_code);

  // If already has real content, return it directly. Error markers should retry.
  if (proj.starter_code && typeof proj.starter_code === 'string' && proj.starter_code.length > 10 && !projectErrorMessage) {
    res.json({ success: true, message: '已生成' });
    return;
  }
  if (projectErrorMessage) {
    console.warn(`[courses] Retrying failed project ${projectId}. Previous error: ${projectErrorMessage}`);
  }

  db.prepare("UPDATE projects SET status = 'in-progress' WHERE id = ? AND course_id = ?").run(projectId, id);

  const generation = startProjectDetailGeneration(id, projectId);
  if (!generation.started || !generation.promise) {
    res.json({ success: true, message: '生成中...' });
    return;
  }
  res.json({ success: true, message: '生成中...' });

  generation.promise.catch((err) => {
    if (wasGenerationCancelled(err)) {
      console.warn(`Project detail generation cancelled: ${projectId}`);
      return;
    }
    console.error(`Project detail generation failed: ${projectId}`, err);
    // Mark project with error so frontend stops polling
    const db2 = getDb();
    const message = err instanceof Error ? err.message : String(err);
    db2.prepare('UPDATE projects SET starter_code = ? WHERE id = ? AND course_id = ?').run(
      JSON.stringify({ error: true, message: message || 'AI 生成失败，请重试' }),
      projectId, id
    );
  });
}));

// POST /api/courses/:id/cancel-project/:projectId — cancel in-flight project generation
coursesRouter.post('/:id/cancel-project/:projectId', asyncHandler(async (req: Request, res: Response) => {
  const { id, projectId } = req.params;
  const db = getDb();
  const cancelled = cancelProjectDetailGeneration(projectId);
  db.prepare("UPDATE projects SET status = 'pending', starter_code = '' WHERE id = ? AND course_id = ? AND status = 'in-progress'").run(projectId, id);
  res.json({ success: true, cancelled });
}));

// DELETE /api/courses/:id/projects/:projectId
coursesRouter.delete('/:id/projects/:projectId', (req: Request, res: Response) => {
  const db = getDb();
  const { id, projectId } = req.params;
  db.prepare('DELETE FROM projects WHERE id = ? AND course_id = ?').run(projectId, id);
  res.json({ success: true });
});

// POST /api/courses/:id/create-lab — create lab from syllabus assignment and start generation
coursesRouter.post('/:id/create-lab', asyncHandler(async (req: Request, res: Response) => {
  const { syllabusRowId, week, title, topic } = req.body;
  if (!syllabusRowId || !title) {
    res.status(400).json({ error: '缺少 syllabusRowId 或 title 参数' });
    return;
  }
  try {
    const labId = await createAndGenerateLab(req.params.id, syllabusRowId, week, title, topic);
    res.json({ success: true, labId });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '创建失败' });
  }
}));

// POST /api/courses/:id/create-project — create project from syllabus assignment and start generation
coursesRouter.post('/:id/create-project', asyncHandler(async (req: Request, res: Response) => {
  const { syllabusRowId, title, description } = req.body;
  if (!syllabusRowId || !title) {
    res.status(400).json({ error: '缺少 syllabusRowId 或 title 参数' });
    return;
  }
  try {
    const projId = await createAndGenerateProject(req.params.id, syllabusRowId, title, description || '');
    res.json({ success: true, projectId: projId });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '创建失败' });
  }
}));

// DELETE /api/courses/:id
coursesRouter.delete('/:id', validateId('id'), (req: Request, res: Response) => {
  const db = getDb();
  // FK CASCADE handles related tables — only delete the course row
  const result = db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);

  if (result.changes === 0) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }
  // Clean up workspace files on disk
  workspace.deleteWorkspace(req.params.id);
  res.json({ success: true });
});
