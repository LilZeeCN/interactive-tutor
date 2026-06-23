import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { workspace } from '../services/workspace.js';
import { dbGet, dbAll } from '../db-types.js';

export const exportRouter = Router();

// GET /api/courses/:id/export/lectures — export lectures as markdown
exportRouter.get('/:id/export/lectures', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const chapterParam = req.query.chapter;

  const course = dbGet('SELECT * FROM courses WHERE id = ?', id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }

  let lectures: Record<string, any>[];
  if (chapterParam && chapterParam !== 'all') {
    const chapter = parseInt(chapterParam as string, 10);
    if (isNaN(chapter) || chapter < 1) {
      res.status(400).json({ error: '章节号无效' });
      return;
    }
    lectures = dbAll(
      'SELECT * FROM lectures WHERE course_id = ? AND chapter_num = ? ORDER BY sort_order ASC'
    , id, chapter);
  } else {
    lectures = dbAll(
      'SELECT * FROM lectures WHERE course_id = ? ORDER BY sort_order ASC'
    , id);
  }

  // Build markdown
  let markdown = `# ${course.title}\n\n`;
  if (course.description) {
    markdown += `${course.description}\n\n`;
  }

  let currentChapter = 0;
  for (const lecture of lectures) {
    if (lecture.chapter_num !== currentChapter) {
      currentChapter = lecture.chapter_num;
      const parts = lecture.title.split(' / ');
      markdown += `\n---\n\n# 第${currentChapter}章 ${parts[0] || ''}\n\n`;
    }

    const parts = lecture.title.split(' / ');
    const sectionTitle = parts[1] || lecture.title;
    markdown += `## ${lecture.section_num}. ${sectionTitle}\n\n`;

    if (lecture.content) {
      markdown += `${lecture.content}\n\n`;
    }
  }

  const filename = encodeURIComponent(`${course.title}-讲义.md`);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(markdown);
});

// GET /api/courses/:id/export/notes — export course notes as markdown
exportRouter.get('/:id/export/notes', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  const course = dbGet('SELECT * FROM courses WHERE id = ?', id);
  if (!course) {
    res.status(404).json({ error: '课程不存在' });
    return;
  }

  // Get topic notes
  const topicNotes = dbAll(
    'SELECT * FROM topic_notes WHERE course_id = ? ORDER BY week ASC'
  , id);

  let markdown = `# ${course.title} - 学习笔记\n\n`;

  if (topicNotes.length > 0) {
    markdown += `---\n\n## 各周笔记\n\n`;
    for (const tn of topicNotes) {
      markdown += `### 第${tn.week}周：${tn.topic}\n\n`;
      if (tn.content) {
        markdown += `${tn.content}\n\n`;
      }
      if (tn.exercises) {
        markdown += `**练习：**\n${tn.exercises}\n\n`;
      }
    }
  }

  const filename = encodeURIComponent(`${course.title}-笔记.md`);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(markdown);
});

// GET /api/courses/:id/export/labs/:labId — export lab files as ZIP
exportRouter.get('/:id/export/labs/:labId', asyncHandler(async (req: Request, res: Response) => {
  const db = getDb();
  const { id, labId } = req.params;

  const lab = dbGet('SELECT * FROM labs WHERE id = ? AND course_id = ?', labId, id);
  if (!lab) {
    res.status(404).json({ error: '实验不存在' });
    return;
  }

  const dirPath = workspace.getItemPath(id, 'labs', labId);
  const tree = await workspace.listTreeAsync(dirPath);

  if (tree.length === 0) {
    res.status(404).json({ error: '该实验没有文件' });
    return;
  }

  // Dynamically import archiver
  const archiver = await import('archiver');

  const filename = encodeURIComponent(`${lab.title}.zip`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);

  const zip = archiver.create('zip', { zlib: { level: 9 } });
  zip.pipe(res);

  // Recursively add files to the zip
  function addFilesToZip(nodes: any[], basePath: string) {
    for (const node of nodes) {
      if (node.type === 'file') {
        const content = workspace.readFile(basePath, node.path);
        if (content !== null) {
          zip.append(content, { name: node.path });
        }
      }
      if (node.children) {
        addFilesToZip(node.children, basePath);
      }
    }
  }

  addFilesToZip(tree, dirPath);

  zip.on('error', (err) => {
    console.error('[export] ZIP archiver error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: '导出失败' });
    }
  });

  zip.finalize();
}));
