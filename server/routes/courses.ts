import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { generateCourseContent, generateCourseOutline, generateLabDetail, generateProjectDetail, createAndGenerateLab, createAndGenerateProject } from '../services/generator.js';
import { workspace } from '../services/workspace.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { dbGet, dbAll } from '../db-types.js';

export const coursesRouter = Router();

// In-memory set to prevent concurrent generation of the same lab/project
const generatingItems = new Set<string>();

// GET /api/courses - list all courses
coursesRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const courses = dbAll<{ id: string; title: string; description: string; content: string; requirements: string; lectureStyle: string; lectureFormat: string; createdAt: string }>('SELECT id, title, description, content, requirements, lecture_style as lectureStyle, lecture_format as lectureFormat, created_at as createdAt FROM courses ORDER BY created_at DESC');
  res.json(courses);
});

// GET /api/courses/:id - get single course
coursesRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const course = dbGet<{ id: string; title: string; description: string; content: string; requirements: string; lectureStyle: string; lectureFormat: string; createdAt: string }>('SELECT id, title, description, content, requirements, lecture_style as lectureStyle, lecture_format as lectureFormat, created_at as createdAt FROM courses WHERE id = ?', req.params.id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }
  res.json(course);
});

// POST /api/courses - create course & trigger content generation
coursesRouter.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { title, description, content, requirements, lectureStyle, lectureFormat } = req.body;

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
  const validFormats = ['markdown', 'html'];
  const safeLectureFormat = validFormats.includes(lectureFormat) ? lectureFormat : 'markdown';

  const id = uuidv4();
  const createdAt = new Date().toISOString();

  db.prepare(
    'INSERT INTO courses (id, title, description, content, requirements, lecture_style, lecture_format, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title.trim(), safeDescription, safeContent, safeRequirements, safeLectureStyle, safeLectureFormat, createdAt);

  const course = dbGet<{ id: string; title: string; description: string; content: string; requirements: string; lectureStyle: string; lectureFormat: string; createdAt: string }>('SELECT id, title, description, content, requirements, lecture_style as lectureStyle, lecture_format as lectureFormat, created_at as createdAt FROM courses WHERE id = ?', id);
  res.status(201).json(course);

  // Only generate outline (syllabus + lab/project lists) — details generated on demand
  generateCourseOutline({ id, title, description: safeDescription, content: safeContent, requirements: safeRequirements, createdAt }).catch((err) => {
    console.error('Outline generation failed for course', id, err);
  });
});

// POST /api/courses/:id/generate-lab/:labId — generate single lab detail on demand
coursesRouter.post('/:id/generate-lab/:labId', asyncHandler(async (req: Request, res: Response) => {
  const { id, labId } = req.params;
  const db = getDb();
  const lab = dbGet('SELECT * FROM labs WHERE id = ? AND course_id = ?', labId, id);
  if (!lab) { res.status(404).json({ error: '实验不存在' }); return; }

  // If already has content, return it directly
  if (lab.instructions && lab.instructions.length > 10) {
    res.json({ success: true, message: '已生成' });
    return;
  }

  // Prevent concurrent generation of the same lab
  const genKey = `lab:${labId}`;
  if (generatingItems.has(genKey)) {
    res.json({ success: true, message: '生成中...' });
    return;
  }
  generatingItems.add(genKey);
  res.json({ success: true, message: '生成中...' });

  generateLabDetail(id, labId).catch((err) => {
    console.error(`Lab detail generation failed: ${labId}`, err);
    // Mark lab with error instructions so frontend stops polling
    const db = getDb();
    db.prepare('UPDATE labs SET instructions = ? WHERE id = ? AND course_id = ?').run(
      JSON.stringify({ error: true, message: 'AI 生成失败，请重试' }),
      labId, id
    );
  }).finally(() => {
    generatingItems.delete(genKey);
  });
}));

// POST /api/courses/:id/generate-project/:projectId — generate single project detail on demand
coursesRouter.post('/:id/generate-project/:projectId', asyncHandler(async (req: Request, res: Response) => {
  const { id, projectId } = req.params;
  const db = getDb();
  const proj = dbGet('SELECT * FROM projects WHERE id = ? AND course_id = ?', projectId, id);
  if (!proj) { res.status(404).json({ error: '项目不存在' }); return; }

  // If already has content, return it directly
  if (proj.starter_code && typeof proj.starter_code === 'string' && proj.starter_code.length > 10) {
    res.json({ success: true, message: '已生成' });
    return;
  }

  // Prevent concurrent generation of the same project
  const genKey = `proj:${projectId}`;
  if (generatingItems.has(genKey)) {
    res.json({ success: true, message: '生成中...' });
    return;
  }
  generatingItems.add(genKey);
  res.json({ success: true, message: '生成中...' });

  generateProjectDetail(id, projectId).catch((err) => {
    console.error(`Project detail generation failed: ${projectId}`, err);
    // Mark project with error so frontend stops polling
    const db2 = getDb();
    db2.prepare('UPDATE projects SET starter_code = ? WHERE id = ? AND course_id = ?').run(
      JSON.stringify({ error: true, message: 'AI 生成失败，请重试' }),
      projectId, id
    );
  }).finally(() => {
    generatingItems.delete(genKey);
  });
}));

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
coursesRouter.delete('/:id', (req: Request, res: Response) => {
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
