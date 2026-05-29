import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { dbGet, dbAll } from '../db-types.js';
import { generateText } from './ai.js';
import { buildSyllabusPrompt } from '../prompts/syllabus.js';

// In-memory lock to prevent concurrent generation for the same chapter
const activeGeneration = new Set<string>();
import { buildLabListPrompt, buildLabDetailPrompt } from '../prompts/labs.js';
import { buildProjectListPrompt, buildProjectDetailPrompt } from '../prompts/projects.js';
import { buildLectureOutlinePrompt, buildLectureSectionPrompt, type LectureStyle, type ContentType } from '../prompts/lectures.js';
import { getCourseMemory, injectMemorySection } from './memory.js';
import { workspace } from './workspace.js';
import { sanitizeLectureHtml } from './htmlSanitizer.js';
import { validateLectureHtml } from './htmlValidator.js';
import { extractHtmlSummary } from './htmlSummary.js';
import { validateLectureContent } from './validator.js';
import { trackTask } from '../helpers/taskTracker.js';
import { parseJSON, safeJSONParse } from './parseJSON.js';

interface CourseInput {
  id: string;
  title: string;
  description: string;
  content: string;
  requirements: string;
  createdAt: string;
}

const detailGenerationControllers = new Map<string, AbortController>();
const chapterGenerationControllers = new Map<string, AbortController>();

function detailKey(type: 'lab' | 'project', id: string): string {
  return `${type}:${id}`;
}

function chapterKey(courseId: string, chapterNum: number): string {
  return `${courseId}:ch${chapterNum}`;
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.message === 'Aborted' || err.message === 'Generation cancelled';
  }
  return false;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Generation cancelled');
}

export function startLabDetailGeneration(courseId: string, labId: string): { started: boolean; promise?: Promise<void> } {
  const key = detailKey('lab', labId);
  if (detailGenerationControllers.has(key)) return { started: false };

  const abortCtrl = new AbortController();
  detailGenerationControllers.set(key, abortCtrl);
  const promise = generateLabDetail(courseId, labId, abortCtrl.signal)
    .finally(() => {
      if (detailGenerationControllers.get(key) === abortCtrl) {
        detailGenerationControllers.delete(key);
      }
    });
  return { started: true, promise };
}

export function startProjectDetailGeneration(courseId: string, projectId: string): { started: boolean; promise?: Promise<void> } {
  const key = detailKey('project', projectId);
  if (detailGenerationControllers.has(key)) return { started: false };

  const abortCtrl = new AbortController();
  detailGenerationControllers.set(key, abortCtrl);
  const promise = generateProjectDetail(courseId, projectId, abortCtrl.signal)
    .finally(() => {
      if (detailGenerationControllers.get(key) === abortCtrl) {
        detailGenerationControllers.delete(key);
      }
    });
  return { started: true, promise };
}

export function cancelLabDetailGeneration(labId: string): boolean {
  const controller = detailGenerationControllers.get(detailKey('lab', labId));
  if (!controller) return false;
  controller.abort();
  return true;
}

export function cancelProjectDetailGeneration(projectId: string): boolean {
  const controller = detailGenerationControllers.get(detailKey('project', projectId));
  if (!controller) return false;
  controller.abort();
  return true;
}

export function startChapterContentGeneration(courseId: string, chapterNum: number): { started: boolean; promise?: Promise<void> } {
  const key = chapterKey(courseId, chapterNum);
  if (chapterGenerationControllers.has(key)) return { started: false };

  const abortCtrl = new AbortController();
  chapterGenerationControllers.set(key, abortCtrl);
  const promise = generateChapterContent(courseId, chapterNum, abortCtrl.signal)
    .finally(() => {
      if (chapterGenerationControllers.get(key) === abortCtrl) {
        chapterGenerationControllers.delete(key);
      }
    });
  return { started: true, promise };
}

export function cancelChapterContentGeneration(courseId: string, chapterNum: number): boolean {
  const controller = chapterGenerationControllers.get(chapterKey(courseId, chapterNum));
  if (!controller) return false;
  controller.abort();
  return true;
}

export function wasGenerationCancelled(err: unknown): boolean {
  return isAbortError(err);
}

// ===== Phase 1: 课程创建时只生成大纲（~5秒） =====
export async function generateCourseOutline(course: CourseInput, options: { forceLectureOutline?: boolean } = {}): Promise<void> {
  const db = getDb();
  console.log(`[outline] Generating syllabus for: ${course.title}`);

  try {
    const syllabusText = await generateText(
      '你是一位资深的课程设计专家。请严格按照要求的 JSON 数组格式输出教学大纲，不要包含 markdown 代码块标记。',
      buildSyllabusPrompt(course),
      4096
    );
    const syllabus = parseJSON(syllabusText) as any[];
    if (!Array.isArray(syllabus) || syllabus.length === 0) {
      console.error(`[outline] Syllabus parse bad result: type=${typeof syllabus}, len=${Array.isArray(syllabus) ? syllabus.length : 'N/A'}, text=${syllabusText.slice(0, 300)}`);
      throw new Error('Syllabus generation returned invalid data');
    }
    {
      const insert = db.prepare(
        'INSERT INTO syllabus (id, course_id, week, topic, readings, assignments, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const insertAll = db.transaction((rows: any[]) => {
        // Clear old syllabus rows before inserting new ones (handles regeneration)
        db.prepare('DELETE FROM syllabus WHERE course_id = ?').run(course.id);
        for (const row of rows) {
          const assignments = (row.assignments || []).map((a: any) => {
            const { id, ...rest } = a;
            return rest;
          });
          insert.run(
            uuidv4(), course.id, row.week, row.topic,
            JSON.stringify(row.readings || []),
            JSON.stringify(assignments),
            row.status || 'pending'
          );
        }
      });
      insertAll(syllabus);
      console.log(`[outline] Syllabus: ${syllabus.length} weeks`);
    }
  } catch (err) {
    console.error('[outline] Syllabus generation failed:', err);
    throw err; // Re-throw so the caller's .catch() records generation_error
  }

  // Generate lecture outline (section titles only, no content)
  try {
    await generateLectureOutline(course.id, options);
    console.log(`[outline] Done. Labs/projects will be created on demand.`);
  } catch (err) {
    console.error('[outline] Lecture outline generation failed:', err);
    throw err;
  }
}

// ===== Generate lecture outline (all section titles) =====
export async function generateLectureOutline(courseId: string, options: { forceLectureOutline?: boolean } = {}): Promise<void> {
  const lockKey = `${courseId}:outline`;
  if (activeGeneration.has(lockKey)) {
    console.log(`[lectures] Skipping outline — already generating for ${courseId}`);
    return;
  }
  activeGeneration.add(lockKey);
  try {
    await _generateLectureOutline(courseId, options.forceLectureOutline === true);
  } finally {
    activeGeneration.delete(lockKey);
  }
}

async function _generateLectureOutline(courseId: string, forceLectureOutline: boolean): Promise<void> {
  const db = getDb();

  const course = dbGet<{ title: string; description: string; content: string; requirements: string; lecture_style: string }>('SELECT title, description, content, requirements, lecture_style FROM courses WHERE id = ?', courseId);
  if (!course) throw new Error('Course not found while generating lecture outline');

  const existing = dbGet<{ c: number }>('SELECT COUNT(*) as c FROM lectures WHERE course_id = ?', courseId);
  if ((existing?.c ?? 0) > 0 && !forceLectureOutline) return; // Already generated

  const syllabus = dbAll<{ week: number; topic: string }>(
    'SELECT week, topic FROM syllabus WHERE course_id = ? ORDER BY week ASC', courseId
  );

  if (syllabus.length === 0) throw new Error('Cannot generate lecture outline without syllabus');

  const outlineText = await generateText(
    '你是一位资深的课程讲师和教材编写专家。请严格按照要求的 JSON 数组格式输出讲义章节结构，不要包含 markdown 代码块标记。',
    buildLectureOutlinePrompt(course, syllabus),
    8192
  );

  const outline = parseJSON(outlineText) as any[];
  if (!Array.isArray(outline) || outline.length === 0) {
    console.error(`[lectures] Outline parse bad result: type=${typeof outline}, len=${Array.isArray(outline) ? outline.length : 'N/A'}, text=${outlineText.slice(0, 300)}`);
    throw new Error('Lecture outline generation returned invalid data');
  }

  const insert = db.prepare(
    'INSERT INTO lectures (id, course_id, chapter_num, section_num, title, status, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  db.transaction(() => {
    if (forceLectureOutline) {
      db.prepare('DELETE FROM lecture_progress WHERE course_id = ?').run(courseId);
      db.prepare('DELETE FROM review_items WHERE course_id = ?').run(courseId);
      db.prepare('DELETE FROM lectures WHERE course_id = ?').run(courseId);
    }
    for (let i = 0; i < outline.length; i++) {
      const row = outline[i];
      insert.run(
        uuidv4(),
        courseId,
        row.chapter,
        row.section_num,
        `${row.chapter_title} / ${row.section_title}`,
        'pending',
        row.sort_order || (i + 1),
        new Date().toISOString()
      );
    }
  })();

  console.log(`[lectures] Outline generated: ${outline.length} sections`);
}

// ===== Generate all sections' content for a specific chapter =====
export async function generateChapterContent(courseId: string, chapterNum: number, abortSignal?: AbortSignal): Promise<void> {
  const lockKey = chapterKey(courseId, chapterNum);
  if (activeGeneration.has(lockKey)) {
    console.log(`[lectures] Skipping chapter ${chapterNum} — already generating`);
    return;
  }
  activeGeneration.add(lockKey);
  try {
    await _generateChapterContent(courseId, chapterNum, abortSignal);
  } finally {
    activeGeneration.delete(lockKey);
  }
}

async function _generateChapterContent(courseId: string, chapterNum: number, abortSignal?: AbortSignal): Promise<void> {
  const db = getDb();
  throwIfAborted(abortSignal);

  interface LectureRow {
    id: string; course_id: string; chapter_num: number; section_num: string;
    title: string; content: string; status: string; sort_order: number;
  }

  const sections = dbAll<LectureRow & Record<string, unknown>>(
    'SELECT * FROM lectures WHERE course_id = ? AND chapter_num = ? ORDER BY sort_order ASC',
    courseId, chapterNum
  );

  console.log(`[lectures] generateChapterContent called: course=${courseId}, chapter=${chapterNum}, sections=${sections.length}`);

  if (sections.length === 0) return;

  const course = dbGet<{ title: string; description: string; content: string; lecture_style: string; lecture_format: string }>('SELECT title, description, content, lecture_style, lecture_format FROM courses WHERE id = ?', courseId);
  if (!course) {
    console.error(`[lectures] Course ${courseId} not found, skipping chapter ${chapterNum}`);
    return;
  }
  const syllabus = dbAll<{ week: number; topic: string }>(
    'SELECT week, topic FROM syllabus WHERE course_id = ? ORDER BY week ASC', courseId
  );

  const syllabusTopics = syllabus.map(s => `第${s.week}周：${s.topic}`).join('\n');

  const pendingSections = sections.filter(s => !(s.content && s.content.length > 50));
  if (pendingSections.length === 0) return;

  // Generate all sections in parallel (up to 3 concurrent to avoid API rate limits)
  const concurrency = Math.min(pendingSections.length, 3);
  const queue = [...pendingSections];

  async function generateNext(): Promise<void> {
    while (queue.length > 0) {
      throwIfAborted(abortSignal);
      const lecture = queue.shift()!;
      try {
        throwIfAborted(abortSignal);
        const parts = lecture.title.split(' / ');
        const chapterTitle = parts[0] || '';
        const sectionTitle = parts[1] || lecture.title;

        db.prepare('UPDATE lectures SET status = ? WHERE id = ?').run('generating', lecture.id);

        // Get previous sections for context
        const prevSections = dbAll<{ section_num: string; title: string; content: string }>(
          'SELECT section_num, title, content FROM lectures WHERE course_id = ? AND sort_order < ? ORDER BY sort_order ASC',
          courseId, lecture.sort_order as number
        );

        const previousSections = prevSections.map(s => ({
          section_num: s.section_num,
          title: s.title.split(' / ').pop() || s.title,
          summary: s.content ? s.content.slice(0, 200) + '...' : '',
        }));

        // Get course memory for personalized context
        const memory = getCourseMemory(courseId);
        const memoryContext = memory ? injectMemorySection(memory) : '';
        const personalizedNote = memoryContext
          ? '\n请根据以上学生画像和学习状态，适当调整讲解的深度、例子选择和难度节奏。如果学生在某些知识点有困难，在这些地方增加更多解释和示例。\n'
          : '';

        const contentType: ContentType = (course.lecture_format === 'html' ? 'html' : 'markdown');
        const isHtml = contentType === 'html';
        const systemPrompt = isHtml
          ? `你是一位善于教学的资深讲师。请生成完整的交互式 HTML 讲义文件。\n${memoryContext}${personalizedNote}`
          : `你是一位善于教学的资深讲师。请严格按照要求的 Markdown 结构输出讲义内容。\n${memoryContext}${personalizedNote}`;

        const content = await generateText(
          systemPrompt,
          buildLectureSectionPrompt({
            course: { title: course.title, description: course.description || '', content: course.content || '' },
            chapterTitle,
            sectionNum: lecture.section_num,
            sectionTitle,
            previousSections,
            syllabusTopics,
            style: (course.lecture_style || 'khanmigo') as LectureStyle,
            contentType,
          }),
          isHtml ? 16384 : 8192,
          abortSignal
        );

        let finalContent = content;
        let finalSummary = '';
        let finalContentType = contentType;
        let validationStatus: string;

        if (isHtml) {
          // HTML path: validate HTML structure, sanitize, extract summary
          const htmlValidation = validateLectureHtml(content);
          if (htmlValidation.valid) {
            const { html, warnings } = sanitizeLectureHtml(content);
            if (warnings.length > 0) console.log(`[lectures] Sanitizer warnings for ${lecture.section_num}: ${warnings.join('; ')}`);
            finalContent = html;
            finalSummary = extractHtmlSummary(html, 1000);
            finalContentType = 'html';
            validationStatus = 'valid';
          } else {
            // Retry once with stricter prompt
            console.log(`[lectures] HTML validation failed for ${lecture.section_num}: ${htmlValidation.errors.join(', ')}. Retrying...`);
            const retryPrompt = buildLectureSectionPrompt({
              course: { title: course.title, description: course.description || '', content: course.content || '' },
              chapterTitle,
              sectionNum: lecture.section_num as string,
              sectionTitle,
              previousSections,
              syllabusTopics,
              style: (course.lecture_style || 'khanmigo') as LectureStyle,
              contentType: 'html',
            }) + '\n\n【重要】上次生成的 HTML 有以下问题：' + htmlValidation.errors.join('；') + '\n请确保：1) 输出完整的 <!DOCTYPE html> 到 </html>；2) 有 <body> 或内容丰富的 <div>；3) 中文内容至少 300 字符。';

            try {
              const retryContent = await generateText(systemPrompt, retryPrompt, 16384, abortSignal);
              const retryValidation = validateLectureHtml(retryContent);
              if (retryValidation.valid) {
                const { html, warnings } = sanitizeLectureHtml(retryContent);
                if (warnings.length > 0) console.log(`[lectures] Sanitizer warnings (retry) for ${lecture.section_num}: ${warnings.join('; ')}`);
                finalContent = html;
                finalSummary = extractHtmlSummary(html, 1000);
                finalContentType = 'html';
                validationStatus = 'valid';
              } else {
                // HTML retry failed — fall back to Markdown
                console.warn(`[lectures] HTML retry still failed for ${lecture.section_num}, falling back to Markdown`);
                const mdContent = await generateText(
                  `你是一位善于教学的资深讲师。请严格按照要求的 Markdown 结构输出讲义内容。\n${memoryContext}${personalizedNote}`,
                  buildLectureSectionPrompt({
                    course: { title: course.title, description: course.description || '', content: course.content || '' },
                    chapterTitle,
                    sectionNum: lecture.section_num as string,
                    sectionTitle,
                    previousSections,
                    syllabusTopics,
                    style: (course.lecture_style || 'khanmigo') as LectureStyle,
                    contentType: 'markdown',
                  }),
                  8192,
                  abortSignal
                );
                finalContent = mdContent;
                finalContentType = 'markdown';
                const mdValidation = validateLectureContent(mdContent);
                validationStatus = mdValidation.valid ? 'valid' : 'invalid';
              }
            } catch (retryErr) {
              if (wasGenerationCancelled(retryErr)) throw retryErr;
              console.error(`[lectures] HTML retry threw for ${lecture.section_num}:`, retryErr);
              finalContent = content;
              finalContentType = 'markdown';
              validationStatus = 'invalid';
            }
          }
        } else {
          // Markdown path: existing validation logic
          const validation = validateLectureContent(content);
          if (validation.valid) {
            validationStatus = 'valid';
          } else {
            console.log(`[lectures] Validation failed for ${lecture.section_num}, missing: ${validation.missing.join(', ')}. Retrying...`);
            const stricterPrompt = buildLectureSectionPrompt({
              course: { title: course.title, description: course.description || '', content: course.content || '' },
              chapterTitle,
              sectionNum: lecture.section_num as string,
              sectionTitle,
              previousSections,
              syllabusTopics,
              style: (course.lecture_style || 'khanmigo') as LectureStyle,
              contentType: 'markdown',
            }) + '\n\n【重要补充要求】请确保内容中包含以下必要部分：' + validation.missing.join('、');

            const retryContent = await generateText(
              '你是一位善于教学的资深讲师。请严格按照要求的 Markdown 结构输出讲义内容。你必须确保内容中包含学习目标、核心讲解、常见误区、练习检验等完整部分。',
              stricterPrompt,
              8192,
              abortSignal
            );

            const retryValidation = validateLectureContent(retryContent);
            finalContent = retryContent;
            validationStatus = retryValidation.valid ? 'valid' : 'invalid';
            if (!retryValidation.valid) {
              console.warn(`[lectures] Validation still failed for ${lecture.section_num} after retry`);
            }
          }
        }

        db.prepare('UPDATE lectures SET content = ?, content_type = ?, content_summary = ?, status = ?, validation_status = ? WHERE id = ?')
          .run(finalContent, finalContentType, finalSummary, 'done', validationStatus, lecture.id);
        console.log(`[lectures] Generated: ${lecture.section_num} (type: ${finalContentType}, validation: ${validationStatus})`);
      } catch (err) {
        if (wasGenerationCancelled(err)) throw err;
        console.error(`[lectures] Generation failed for ${lecture.section_num}:`, err);
        db.prepare('UPDATE lectures SET status = ? WHERE id = ?').run('error', lecture.id);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => generateNext()));

  console.log(`[lectures] Chapter ${chapterNum} done`);
}

// ===== 按需创建 + 生成单个 Lab =====
export async function createAndGenerateLab(courseId: string, syllabusRowId: string, week: number, title: string, topic: string): Promise<string> {
  const db = getDb();
  const labId = 'lab-' + uuidv4().slice(0, 8);

  // Atomically create lab entry + link in syllabus
  db.transaction(() => {
    db.prepare(
      'INSERT INTO labs (id, course_id, title, topic, status, time, week, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(labId, courseId, title, topic, 'in-progress', '2小时', week, new Date().toISOString());

    const row = dbGet<{ assignments: string }>('SELECT assignments FROM syllabus WHERE id = ?', syllabusRowId);
    if (row) {
      const assignments: any[] = safeJSONParse(row.assignments, []);
      for (const a of assignments) {
        if (a.type === 'lab' && a.title === title && !a.id) {
          a.id = labId;
          break;
        }
      }
      db.prepare('UPDATE syllabus SET assignments = ? WHERE id = ?').run(JSON.stringify(assignments), syllabusRowId);
    }
  })();

  // Generate detail in background
  const generation = startLabDetailGeneration(courseId, labId);
  generation.promise?.catch(err => {
    if (wasGenerationCancelled(err)) {
      console.warn(`Lab generation cancelled: ${labId}`);
      return;
    }
    console.error(`Lab generation failed: ${labId}`, err);
    const db = getDb();
    const message = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE labs SET instructions = ? WHERE id = ? AND course_id = ?").run(
      JSON.stringify({ error: true, message: message || 'AI 生成失败，请重试' }),
      labId, courseId
    );
  });

  return labId;
}

// ===== 按需创建 + 生成单个 Project =====
export async function createAndGenerateProject(courseId: string, syllabusRowId: string, title: string, description: string): Promise<string> {
  const db = getDb();
  const projId = 'proj-' + uuidv4().slice(0, 8);

  // Atomically create project entry + link in syllabus
  db.transaction(() => {
    db.prepare(
      'INSERT INTO projects (id, course_id, title, description, status, progress, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(projId, courseId, title, description, 'in-progress', 0, '[]', new Date().toISOString());

    const row = dbGet<{ assignments: string }>('SELECT assignments FROM syllabus WHERE id = ?', syllabusRowId);
    if (row) {
      const assignments: any[] = safeJSONParse(row.assignments, []);
      for (const a of assignments) {
        if (a.type === 'project' && a.title === title && !a.id) {
          a.id = projId;
          break;
        }
      }
      db.prepare('UPDATE syllabus SET assignments = ? WHERE id = ?').run(JSON.stringify(assignments), syllabusRowId);
    }
  })();

  const generation = startProjectDetailGeneration(courseId, projId);
  generation.promise?.catch(err => {
    if (wasGenerationCancelled(err)) {
      console.warn(`Project generation cancelled: ${projId}`);
      return;
    }
    console.error(`Project generation failed: ${projId}`, err);
    const db = getDb();
    const message = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE projects SET starter_code = ? WHERE id = ? AND course_id = ?").run(
      JSON.stringify({ error: true, message: message || 'AI 生成失败，请重试' }),
      projId, courseId
    );
  });

  return projId;
}

// ===== Phase 2: 按需生成单个 Lab 详情 =====
export async function generateLabDetail(courseId: string, labId: string, abortSignal?: AbortSignal): Promise<void> {
  const db = getDb();
  throwIfAborted(abortSignal);

  const lab = dbGet<{ id: string; title: string; topic: string; instructions: string; week: number }>('SELECT * FROM labs WHERE id = ? AND course_id = ?', labId, courseId);
  if (!lab) throw new Error('Lab not found');

  // Skip if already generated, but allow retry after a previous error marker.
  if (lab.instructions && lab.instructions.length > 10) {
    const parsed = safeJSONParse(lab.instructions, null);
    if (parsed?.error) {
      console.log(`[lab-detail] Retrying failed lab: ${lab.title}`);
      db.prepare("UPDATE labs SET instructions = '', starter_code = '', test_cases = '[]' WHERE id = ? AND course_id = ?").run(labId, courseId);
    } else {
      console.log(`[lab-detail] Lab "${lab.title}" already has content, skipping`);
      return;
    }
  }

  const course = dbGet<{ title: string; description: string; content: string }>('SELECT title, description, content FROM courses WHERE id = ?', courseId);
  if (!course) throw new Error('Course not found');
  const syllabusRows = dbAll<{ week: number; topic: string }>('SELECT week, topic FROM syllabus WHERE course_id = ? ORDER BY week ASC', courseId);
  const existingLabs = dbAll<{ title: string }>('SELECT title FROM labs WHERE course_id = ? AND id != ?', courseId, labId);

  const syllabusTopics = syllabusRows.length > 0
    ? syllabusRows.map(s => `第${s.week}周：${s.topic}`).join('\n')
    : undefined;
  const previousLabs = existingLabs.length > 0
    ? existingLabs.map(l => `Lab: ${l.title}`).join(', ')
    : undefined;

  console.log(`[lab-detail] Generating detail for: ${lab.title}`);
  let detail: any = null;
  let lastError: Error | null = null;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      throwIfAborted(abortSignal);
      const detailText = await generateText(
        '你是一位资深的课程讲师和编程教育专家。请严格按照要求的 JSON 格式输出，不要包含 markdown 代码块标记。',
        buildLabDetailPrompt({
          course: { title: course.title, description: course.description || '', content: course.content || '' },
          labTitle: lab.title,
          labTopic: lab.topic || '',
          weekNumber: lab.week as number,
          totalWeeks: syllabusRows.length,
          syllabusTopics,
          previousLabs,
        }),
        16384,
        abortSignal
      );
      throwIfAborted(abortSignal);
      detail = parseJSON(detailText) as any;
      break;
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err as Error;
      console.warn(`[lab-detail] Attempt ${attempt}/${maxAttempts} failed for ${lab.title}: ${lastError.message}`);
    }
  }

  if (!detail) throw lastError!;

  throwIfAborted(abortSignal);
  db.prepare(
    'UPDATE labs SET instructions = ?, starter_code = ?, test_cases = ?, status = ? WHERE id = ? AND course_id = ?'
  ).run(
    detail?.instructions || '',
    JSON.stringify(detail?.starter_code || {}),
    JSON.stringify(detail?.test_cases || []),
    'pending',
    labId, courseId
  );

  // Write starter files to disk
  if (detail?.starter_code && Object.keys(detail.starter_code).length > 0) {
    try {
      workspace.writeFiles(workspace.getItemPath(courseId, 'labs', labId), detail.starter_code);
    } catch (err) {
      console.error(`Failed to write starter files for lab ${labId}:`, err);
    }
  }

  console.log(`[lab-detail] Done: ${lab.title}`);
}

// ===== Phase 2: 按需生成单个 Project 详情 =====
export async function generateProjectDetail(courseId: string, projectId: string, abortSignal?: AbortSignal): Promise<void> {
  const db = getDb();
  throwIfAborted(abortSignal);

  const proj = dbGet<{ id: string; title: string; description: string; starter_code: string }>('SELECT * FROM projects WHERE id = ? AND course_id = ?', projectId, courseId);
  if (!proj) throw new Error('Project not found');

  // Skip if already generated (but allow retry if it was an error marker)
  if (proj.starter_code && typeof proj.starter_code === 'string' && proj.starter_code.length > 10) {
    try {
      const parsed = JSON.parse(proj.starter_code);
      if (parsed.error) {
        // Previous generation failed — clear and retry
        const db3 = getDb();
        db3.prepare('UPDATE projects SET starter_code = NULL WHERE id = ?').run(projectId);
      } else {
        console.log(`[proj-detail] Project "${proj.title}" already has content, skipping`);
        return;
      }
    } catch {
      console.log(`[proj-detail] Project "${proj.title}" already has content, skipping`);
      return;
    }
  }

  const course = dbGet<{ title: string; description: string; content: string }>('SELECT title, description, content FROM courses WHERE id = ?', courseId);
  const syllabusRows = dbAll<{ week: number; topic: string }>('SELECT week, topic FROM syllabus WHERE course_id = ? ORDER BY week ASC', courseId);
  const completedLabs = dbAll<{ title: string }>("SELECT title FROM labs WHERE course_id = ? AND status = 'completed'", courseId);

  const syllabusTopics = syllabusRows.length > 0
    ? syllabusRows.map(s => `第${s.week}周：${s.topic}`).join('\n')
    : undefined;
  const completedLabsStr = completedLabs.length > 0
    ? completedLabs.map(l => `Lab: ${l.title}`).join(', ')
    : undefined;

  console.log(`[proj-detail] Generating detail for: ${proj.title}`);
  let detail: any = null;
  let lastError: Error | null = null;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      throwIfAborted(abortSignal);
      const detailText = await generateText(
        '你是一位资深的课程讲师和编程教育专家。请严格按照要求的 JSON 格式输出，不要包含 markdown 代码块标记。',
        buildProjectDetailPrompt({
          course: { title: course.title, description: course.description || '', content: course.content || '' },
          projectTitle: proj.title,
          projectDesc: proj.description as string || '',
          syllabusTopics,
          completedLabs: completedLabsStr,
        }),
        16384,
        abortSignal
      );
      throwIfAborted(abortSignal);
      detail = parseJSON(detailText) as any;
      break;
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err as Error;
      console.warn(`[proj-detail] Attempt ${attempt}/${maxAttempts} failed for ${proj.title}: ${lastError.message}`);
    }
  }

  if (!detail) throw lastError!;

  throwIfAborted(abortSignal);
  db.prepare(
    'UPDATE projects SET description = ?, milestones = ?, starter_code = ?, status = ? WHERE id = ? AND course_id = ?'
  ).run(
    detail?.description || proj.description || '',
    JSON.stringify(detail?.milestones || []),
    JSON.stringify(detail?.starter_code || {}),
    'pending',
    projectId, courseId
  );

  // Write starter files to disk
  if (detail?.starter_code && Object.keys(detail.starter_code).length > 0) {
    try {
      workspace.writeFiles(workspace.getItemPath(courseId, 'projects', projectId), detail.starter_code);
    } catch (err) {
      console.error(`Failed to write starter files for project ${projectId}:`, err);
    }
  }

  console.log(`[proj-detail] Done: ${proj.title}`);
}

// ===== Backward compatible: regenerate all (for existing courses) =====
export async function generateCourseContent(course: CourseInput): Promise<void> {
  await generateCourseOutline(course);

  // Then generate all lab + project details
  const db = getDb();
  const labs = dbAll<{ id: string }>('SELECT id FROM labs WHERE course_id = ?', course.id);
  const projects = dbAll<{ id: string }>('SELECT id FROM projects WHERE course_id = ?', course.id);

  for (const lab of labs) {
    try { await generateLabDetail(course.id, lab.id); } catch (err) {
      console.error(`  Failed lab detail ${lab.id}:`, err);
    }
  }
  for (const proj of projects) {
    try { await generateProjectDetail(course.id, proj.id); } catch (err) {
      console.error(`  Failed project detail ${proj.id}:`, err);
    }
  }

  // Link assignments atomically
  try {
    const allLabs = dbAll<{ id: string; week: number }>('SELECT id, week FROM labs WHERE course_id = ?', course.id);
    const allProjects = dbAll<{ id: string }>('SELECT id FROM projects WHERE course_id = ?', course.id);
    const syllabusRows = dbAll<{ id: string; week: number; assignments: string }>('SELECT id, week, assignments FROM syllabus WHERE course_id = ?', course.id);
    if (syllabusRows.length === 0) return;

    const linkAssignments = db.transaction(() => {
      let projectIdx = 0;
      const updateStmt = db.prepare('UPDATE syllabus SET assignments = ? WHERE id = ?');
      for (const row of syllabusRows) {
        const assignments: any[] = safeJSONParse(row.assignments, []);
        let changed = false;
        for (const a of assignments) {
          if (a.type === 'lab') {
            const match = allLabs.find((l: any) => l.week === row.week);
            if (match) { a.id = match.id; changed = true; }
          } else if (a.type === 'project') {
            if (projectIdx < allProjects.length) {
              a.id = allProjects[projectIdx].id;
              projectIdx++;
              changed = true;
            }
          }
        }
        if (changed) updateStmt.run(JSON.stringify(assignments), row.id);
      }
    });
    linkAssignments();
    console.log('  Assignments linked');
  } catch (err) {
    console.error('  Assignment linking failed:', err);
  }
}

// ===== Server startup recovery: resume interrupted generation tasks =====
export async function recoverPendingGenerations(): Promise<void> {
  const db = getDb();
  let recovered = 0;

  // Step 1: Courses with no syllabus (outline generation never completed)
  const noSyllabus = dbAll<{ id: string; title: string; description: string; content: string; requirements: string; created_at: string }>(
    `SELECT id, title, description, content, requirements, created_at FROM courses
     WHERE id NOT IN (SELECT DISTINCT course_id FROM syllabus)`
  );
  for (const c of noSyllabus) {
    console.log(`[recovery] "${c.title}" — no syllabus, generating outline`);
    trackTask(
      generateCourseOutline({ ...c, createdAt: c.created_at }).catch(err => console.error(`[recovery] Outline failed for "${c.title}":`, err)),
      `recovery-outline-${c.id}`
    );
    recovered++;
  }

  // Step 2: Courses with syllabus but no lecture outline — generate outline only
  const noLectures = dbAll<{ id: string }>(
    `SELECT c.id FROM courses c
     WHERE c.id IN (SELECT DISTINCT course_id FROM syllabus)
     AND c.id NOT IN (SELECT DISTINCT course_id FROM lectures)`
  );
  const noSyllabusIds = new Set(noSyllabus.map(c => c.id));
  const noLecturesFiltered = noLectures.filter(c => !noSyllabusIds.has(c.id));
  for (const c of noLecturesFiltered) {
    console.log(`[recovery] ${c.id} — has syllabus but no lectures, generating outline`);
    trackTask(
      generateLectureOutline(c.id)
        .catch(err => console.error(`[recovery] Lecture outline failed for ${c.id}:`, err)),
      `recovery-lectures-${c.id}`
    );
    recovered++;
  }

  if (recovered > 0) {
    console.log(`[recovery] Started recovery for ${recovered} course(s)`);
  }
}
