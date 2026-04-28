import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { generateCourseOutline } from '../services/generator.js';
import { generateText } from '../services/ai.js';
import { buildLabModifyPrompt } from '../prompts/contentModify.js';
import { buildProjectModifyPrompt } from '../prompts/contentModify.js';
import { buildCourseContext } from '../services/context.js';
import { buildTopicNotePrompt } from '../prompts/topicNotes.js';
import { workspace } from '../services/workspace.js';
import { parseJSON, safeJSONParse } from '../services/parseJSON.js';
import { setupSSERes } from '../helpers/sse.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { escapeLIKE } from '../helpers/sqlUtils.js';
import { estimateTokens, truncateTextToTokens } from '../services/tokens.js';
import { dbGet, dbAll } from '../db-types.js';
import {
  MODIFY_PER_FILE_TOKEN_CAP,
  MODIFY_MAX_TOTAL_FILE_TOKENS,
} from '../services/tokenBudgets.js';

export const contentRouter = Router();

// ====== Shared Helpers ======

// Recursively read files from a workspace tree, keyed by relative path
function collectFiles(dirPath: string, nodes: any[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const node of nodes) {
    if (node.type === 'file') {
      const content = workspace.readFile(dirPath, node.path);
      files[node.path] = content || '';
    }
    if (node.children) Object.assign(files, collectFiles(dirPath, node.children));
  }
  return files;
}

// Cap file contents to stay within token budget before sending to AI
function capFiles(files: Record<string, string>): Record<string, string> {
  const capped: Record<string, string> = {};
  let totalTokens = 0;
  for (const [path, content] of Object.entries(files)) {
    const fileTokens = estimateTokens(content);
    if (fileTokens > MODIFY_PER_FILE_TOKEN_CAP) {
      capped[path] = truncateTextToTokens(content, MODIFY_PER_FILE_TOKEN_CAP, `\n// ...(文件过大已截断)`);
    } else {
      capped[path] = content;
    }
    totalTokens += Math.min(fileTokens, MODIFY_PER_FILE_TOKEN_CAP);
    if (totalTokens > MODIFY_MAX_TOTAL_FILE_TOKENS) {
      // Skip remaining files to stay within total budget
      break;
    }
  }
  return capped;
}

// ====== Syllabus ======

// GET /api/courses/:id/syllabus
contentRouter.get('/:id/syllabus', (req: Request, res: Response) => {
  const rows = dbAll<{ [key: string]: any }>('SELECT * FROM syllabus WHERE course_id = ? ORDER BY week ASC', req.params.id);

  const syllabus = rows.map((row) => ({
    ...row,
    readings: safeJSONParse(row.readings, []),
    assignments: safeJSONParse(row.assignments, []),
  }));

  res.json(syllabus);
});

// PUT /api/courses/:id/syllabus - update syllabus status
contentRouter.put('/:id/syllabus/:rowId', (req: Request, res: Response) => {
  const db = getDb();
  const { status } = req.body;
  if (!status || !['pending', 'in-progress', 'completed'].includes(status)) {
    res.status(400).json({ error: '状态值无效，可选：pending、in-progress、completed' });
    return;
  }
  db.prepare('UPDATE syllabus SET status = ? WHERE id = ? AND course_id = ?').run(
    status, req.params.rowId, req.params.id
  );
  res.json({ success: true });
});

// ====== Notes ======

// GET /api/courses/:id/notes
contentRouter.get('/:id/notes', (req: Request, res: Response) => {
  const db = getDb();
  const row = dbGet('SELECT * FROM notes WHERE course_id = ?', req.params.id);
  res.json({ content: row?.content || '' });
});

// PUT /api/courses/:id/notes - regenerate notes via AI
contentRouter.put('/:id/notes', asyncHandler(async (req: Request, res: Response) => {
  const { content } = req.body;
  if (content === undefined) {
    res.status(400).json({ error: 'content 不能为空' });
    return;
  }
  const db = getDb();
  db.prepare(
    'INSERT INTO notes (course_id, content) VALUES (?, ?) ON CONFLICT(course_id) DO UPDATE SET content = ?'
  ).run(req.params.id, content, content);
  res.json({ success: true });
}));

// ====== Labs ======

// GET /api/courses/:id/labs
contentRouter.get('/:id/labs', (req: Request, res: Response) => {
  const labs = dbAll<{ [key: string]: any }>('SELECT * FROM labs WHERE course_id = ? ORDER BY created_at ASC', req.params.id);

  const result = labs.map((lab) => ({
    ...lab,
    starter_code: safeJSONParse(lab.starter_code, {}),
    test_cases: safeJSONParse(lab.test_cases, []),
  }));

  res.json(result);
});

// GET /api/courses/:id/labs/:labId
contentRouter.get('/:id/labs/:labId', (req: Request, res: Response) => {
  const lab = dbGet<{ [key: string]: any }>('SELECT * FROM labs WHERE id = ? AND course_id = ?', req.params.labId, req.params.id);

  if (!lab) {
    res.status(404).json({ error: '实验不存在' });
    return;
  }

  res.json({
    ...lab,
    starter_code: safeJSONParse(lab.starter_code, {}),
    test_cases: safeJSONParse(lab.test_cases, []),
  });
});

// PUT /api/courses/:id/labs/:labId - update lab status
contentRouter.put('/:id/labs/:labId', (req: Request, res: Response) => {
  const db = getDb();
  const { status } = req.body;
  if (!status || !['pending', 'in-progress', 'completed'].includes(status)) {
    res.status(400).json({ error: '状态值无效，可选：pending、in-progress、completed' });
    return;
  }
  db.prepare('UPDATE labs SET status = ? WHERE id = ? AND course_id = ?').run(
    status, req.params.labId, req.params.id
  );
  res.json({ success: true });
});

// ====== Projects ======

// GET /api/courses/:id/projects
contentRouter.get('/:id/projects', (req: Request, res: Response) => {
  const projects = dbAll<{ [key: string]: any }>('SELECT * FROM projects WHERE course_id = ? ORDER BY created_at ASC', req.params.id);

  const result = projects.map((p) => ({
    ...p,
    tags: safeJSONParse(p.tags, []),
    milestones: safeJSONParse(p.milestones, []),
    starter_code: safeJSONParse(p.starter_code, {}),
  }));

  res.json(result);
});

// GET /api/courses/:id/projects/:projectId
contentRouter.get('/:id/projects/:projectId', (req: Request, res: Response) => {
  const project = dbGet<{ [key: string]: any }>('SELECT * FROM projects WHERE id = ? AND course_id = ?', req.params.projectId, req.params.id);

  if (!project) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  res.json({
    ...project,
    tags: safeJSONParse(project.tags, []),
    milestones: safeJSONParse(project.milestones, []),
    starter_code: safeJSONParse(project.starter_code, {}),
  });
});

// PUT /api/courses/:id/projects/:projectId - update project status/progress
contentRouter.put('/:id/projects/:projectId', (req: Request, res: Response) => {
  const db = getDb();
  const { status, progress, milestones } = req.body;

  // Validate inputs before entering transaction
  if (status !== undefined && !['pending', 'in-progress', 'completed'].includes(status)) {
    res.status(400).json({ error: '状态值无效，可选：pending、in-progress、completed' });
    return;
  }
  if (progress !== undefined) {
    const p = Number(progress);
    if (!Number.isInteger(p) || p < 0 || p > 100) {
      res.status(400).json({ error: '进度必须是 0-100 之间的整数' });
      return;
    }
  }

  db.transaction(() => {
    if (status !== undefined) {
      db.prepare('UPDATE projects SET status = ? WHERE id = ? AND course_id = ?').run(
        status, req.params.projectId, req.params.id
      );
    }
    if (progress !== undefined) {
      db.prepare('UPDATE projects SET progress = ? WHERE id = ? AND course_id = ?').run(
        Number(progress), req.params.projectId, req.params.id
      );
    }
    if (milestones !== undefined) {
      db.prepare('UPDATE projects SET milestones = ? WHERE id = ? AND course_id = ?').run(
        JSON.stringify(milestones), req.params.projectId, req.params.id
      );
    }
  })();

  res.json({ success: true });
});

// ====== Generation Status ======

// GET /api/courses/:id/generation-status
contentRouter.get('/:id/generation-status', (req: Request, res: Response) => {
  const course = dbGet('SELECT * FROM courses WHERE id = ?', req.params.id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }

  const syllabus = dbGet<{ count: number }>('SELECT COUNT(*) as count FROM syllabus WHERE course_id = ?', req.params.id);

  // Course is "done" once syllabus is generated; labs/projects/notes are created on demand
  res.json({
    done: syllabus.count > 0,
  });
});

// POST /api/courses/:id/regenerate - trigger content regeneration
contentRouter.post('/:id/regenerate', asyncHandler(async (req: Request, res: Response) => {
  const db = getDb();
  const course = dbGet<{ id: string; title: string; description: string; content: string; requirements: string; createdAt: string }>('SELECT * FROM courses WHERE id = ?', req.params.id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }

  res.json({ success: true, message: '内容重新生成已启动' });

  // Fire and forget
  generateCourseOutline(course).catch((err) => {
    console.error('Regeneration failed for course', course.id, err);
  });
}));

// ====== AI Modify Labs/Projects ======

// POST /api/courses/:id/labs/:labId/ai-modify — AI modify lab files
contentRouter.post('/:id/labs/:labId/ai-modify', asyncHandler(async (req: Request, res: Response) => {
  const { id: courseId, labId } = req.params;
  const { instruction } = req.body;

  if (!instruction?.trim()) {
    res.status(400).json({ error: 'instruction 不能为空' });
    return;
  }

  const db = getDb();
  const lab = dbGet('SELECT * FROM labs WHERE id = ? AND course_id = ?', labId, courseId);
  if (!lab) {
    res.status(404).json({ error: '实验不存在' });
    return;
  }

  // Read current files from disk, fallback to DB
  const dirPath = workspace.getItemPath(courseId, 'labs', labId);
  const tree = await workspace.listTreeAsync(dirPath);
  let currentFiles: Record<string, string> =
    tree.length > 0 ? collectFiles(dirPath, tree) : safeJSONParse(lab.starter_code, {});

  // Cap file contents to stay within token budget
  const cappedFiles = capFiles(currentFiles);

  // Prepare lab metadata for context
  const labInstructions = typeof lab.instructions === 'string' && lab.instructions.length > 10
    ? lab.instructions
    : undefined;
  const testCasesArr = safeJSONParse(lab.test_cases, []);
  const testCasesText = Array.isArray(testCasesArr) && testCasesArr.length > 0
    ? testCasesArr.map((tc: any, i: number) => `${i + 1}. ${tc.name}: ${tc.description || ''}`).join('\n')
    : undefined;

  const { system: modifySystem, user: modifyUser } = buildLabModifyPrompt({
    labTitle: lab.title,
    labTopic: lab.topic,
    currentFiles: cappedFiles,
    instruction,
    labInstructions,
    testCases: testCasesText,
    courseInfo: buildCourseContext(courseId).info,
  });

  // Stream AI response, then write files
  const sse = setupSSERes(res, req);
  const abortCtrl = new AbortController();
  // Poll disconnect status during long AI calls
  const disconnectPoll = setInterval(() => {
    if (sse.isDisconnected() && !abortCtrl.signal.aborted) abortCtrl.abort();
  }, 3000);

  try {
    const fullText = await generateText(modifySystem, modifyUser, 8192, abortCtrl.signal);
    if (sse.isDisconnected()) { clearInterval(disconnectPoll); sse.cleanup(); return; }

    const result = parseJSON(fullText);

    if (result.files) {
      // Merge: only overwrite files that the AI explicitly modified
      const mergedFiles = { ...currentFiles, ...result.files };
      // Atomically write files + update DB
      db.transaction(() => {
        workspace.writeFiles(dirPath, result.files);
        db.prepare('UPDATE labs SET starter_code = ? WHERE id = ?').run(JSON.stringify(mergedFiles), labId);
      })();

      sse.sendEvent({ type: 'summary', summary: result.summary || '修改完成' });
      sse.sendEvent({ type: 'done' });
    } else {
      sse.sendEvent({ type: 'error', error: 'AI response format error' });
    }
  } catch (err: any) {
    if (!sse.isDisconnected()) {
      sse.sendEvent({ type: 'error', error: err?.message || 'AI 修改失败' });
    }
  }
  clearInterval(disconnectPoll);
  sse.cleanup();
}));

// POST /api/courses/:id/projects/:projId/ai-modify — AI modify project files
contentRouter.post('/:id/projects/:projId/ai-modify', asyncHandler(async (req: Request, res: Response) => {
  const { id: courseId, projId } = req.params;
  const { instruction } = req.body;

  if (!instruction?.trim()) {
    res.status(400).json({ error: 'instruction 不能为空' });
    return;
  }

  const db = getDb();
  const proj = dbGet('SELECT * FROM projects WHERE id = ? AND course_id = ?', projId, courseId);
  if (!proj) {
    res.status(404).json({ error: '项目不存在' });
    return;
  }

  // Read current files from disk, fallback to DB
  const dirPath = workspace.getItemPath(courseId, 'projects', projId);
  const tree = await workspace.listTreeAsync(dirPath);
  let currentFiles: Record<string, string> =
    tree.length > 0 ? collectFiles(dirPath, tree) : safeJSONParse(proj.starter_code, {});

  // Cap file contents to stay within token budget
  const cappedFiles = capFiles(currentFiles);

  // Prepare project metadata for context
  const milestonesArr = safeJSONParse(proj.milestones, []);
  const milestonesText = Array.isArray(milestonesArr) && milestonesArr.length > 0
    ? milestonesArr.map((m: any, i: number) => `${i + 1}. ${m.title}: ${m.acceptance || m.description || ''}`).join('\n')
    : undefined;

  const { system: modifySystem, user: modifyUser } = buildProjectModifyPrompt({
    projectTitle: proj.title,
    projectDesc: proj.description,
    currentFiles: cappedFiles,
    instruction,
    milestones: milestonesText,
    courseInfo: buildCourseContext(courseId).info,
  });

  const sse = setupSSERes(res, req);

  const abortCtrl = new AbortController();
  const disconnectPoll = setInterval(() => {
    if (sse.isDisconnected() && !abortCtrl.signal.aborted) abortCtrl.abort();
  }, 3000);

  try {
    const fullText = await generateText(modifySystem, modifyUser, 8192, abortCtrl.signal);
    if (sse.isDisconnected()) { clearInterval(disconnectPoll); sse.cleanup(); return; }

    const result = parseJSON(fullText);

    if (result.files) {
      // Merge: only overwrite files that the AI explicitly modified
      const mergedFiles = { ...currentFiles, ...result.files };
      db.transaction(() => {
        workspace.writeFiles(dirPath, result.files);
        db.prepare('UPDATE projects SET starter_code = ? WHERE id = ?').run(JSON.stringify(mergedFiles), projId);
      })();
      sse.sendEvent({ type: 'summary', summary: result.summary || '修改完成' });
      sse.sendEvent({ type: 'done' });
    } else {
      sse.sendEvent({ type: 'error', error: 'AI response format error' });
    }
  } catch (err: any) {
    if (!sse.isDisconnected()) {
      sse.sendEvent({ type: 'error', error: err?.message || 'AI 修���失败' });
    }
  }
  clearInterval(disconnectPoll);
  sse.cleanup();
}));

// ====== Topic Notes ======

// GET /api/courses/:id/topic-notes — list all topic notes
contentRouter.get('/:id/topic-notes', (req: Request, res: Response) => {
  const notes = dbAll('SELECT * FROM topic_notes WHERE course_id = ? ORDER BY week ASC', req.params.id);
  res.json(notes);
});

// GET /api/courses/:id/topic-notes/:topicId — single topic note
contentRouter.get('/:id/topic-notes/:topicId', (req: Request, res: Response) => {
  const note = dbGet<{ [key: string]: any }>('SELECT * FROM topic_notes WHERE topic_id = ? AND course_id = ?', req.params.topicId, req.params.id);

  if (!note) {
    res.status(404).json({ error: '笔记不存在' });
    return;
  }

  res.json(note);
});

// POST /api/courses/:id/topic-notes/:topicId/generate — AI generate note
contentRouter.post('/:id/topic-notes/:topicId/generate', asyncHandler(async (req: Request, res: Response) => {
  const db = getDb();
  const courseId = req.params.id;
  const topicId = req.params.topicId;

  const course = dbGet('SELECT * FROM courses WHERE id = ?', courseId);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }

  const topic = dbGet('SELECT * FROM syllabus WHERE id = ? AND course_id = ?', topicId, courseId);
  if (!topic) {
    res.status(404).json({ error: '话题不存在' });
    return;
  }

  // Get related labs for this topic
  const labs = dbAll('SELECT * FROM labs WHERE course_id = ?', courseId);
  const relatedLab = labs.find((l: Record<string, unknown>) => (l.topic as string)?.includes(topic.topic));

  // Get chat history scoped to the matching topic (not global)
  const matchingTopic = dbGet<{ [key: string]: any }>(
    'SELECT id FROM topics WHERE course_id = ? AND title LIKE ?',
    courseId, `%${escapeLIKE(topic.topic)}%`
  );

  let chatHistory: any[] = [];
  if (matchingTopic) {
    chatHistory = dbAll(
      `SELECT role, content FROM messages WHERE topic_id = ? ORDER BY timestamp DESC LIMIT 30`,
      matchingTopic.id
    ).reverse();
  }

  const sse = setupSSERes(res, req);

  const abortCtrl = new AbortController();
  const disconnectPoll = setInterval(() => {
    if (sse.isDisconnected() && !abortCtrl.signal.aborted) abortCtrl.abort();
  }, 3000);

  try {
    const prompt = buildTopicNotePrompt({
      courseTitle: course.title,
      weekTopic: `${topic.week}`,
      topicName: topic.topic,
      labTitle: relatedLab?.title,
      chatHistory,
      courseContent: course.content || '',
      courseDescription: course.description || '',
      courseRequirements: course.requirements || '',
    });

    const fullText = await generateText(prompt.system, prompt.user, 8192, abortCtrl.signal);
    const result = parseJSON(fullText);

    const now = new Date().toISOString();
    const existing = dbGet('SELECT id FROM topic_notes WHERE topic_id = ? AND course_id = ?', topicId, courseId);

    if (existing) {
      db.prepare(
        'UPDATE topic_notes SET content = ?, exercises = ?, status = ?, updated_at = ? WHERE topic_id = ? AND course_id = ?'
      ).run(result.content || '', result.exercises || '', 'generated', now, topicId, courseId);
    } else {
      db.prepare(
        'INSERT INTO topic_notes (id, topic_id, course_id, week, topic, content, exercises, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), topicId, courseId, topic.week, topic.topic, result.content || '', result.exercises || '', 'generated', now, now);
    }

    sse.sendEvent({ type: 'done', content: result.content, exercises: result.exercises });
  } catch (err: any) {
    if (!sse.isDisconnected()) {
      sse.sendEvent({ type: 'error', error: err?.message || '生成失败' });
    }
  }
  clearInterval(disconnectPoll);
  sse.cleanup();
}));

// PUT /api/courses/:id/topic-notes/:topicId — manual update
contentRouter.put('/:id/topic-notes/:topicId', (req: Request, res: Response) => {
  const db = getDb();
  const { content, exercises } = req.body;
  const now = new Date().toISOString();
  const existing = dbGet('SELECT id FROM topic_notes WHERE topic_id = ? AND course_id = ?', req.params.topicId, req.params.id);

  if (existing) {
    db.prepare(
      'UPDATE topic_notes SET content = COALESCE(?, content), exercises = COALESCE(?, exercises), status = ?, updated_at = ? WHERE topic_id = ? AND course_id = ?'
    ).run(content ?? null, exercises ?? null, 'edited', now, req.params.topicId, req.params.id);
  } else {
    const topic = dbGet('SELECT * FROM syllabus WHERE id = ? AND course_id = ?', req.params.topicId, req.params.id);
    if (!topic) {
      res.status(404).json({ error: '话题不存在' });
      return;
    }
    db.prepare(
      'INSERT INTO topic_notes (id, topic_id, course_id, week, topic, content, exercises, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), req.params.topicId, req.params.id, topic.week, topic.topic, content || '', exercises || '', 'edited', now, now);
  }
  res.json({ success: true });
});
