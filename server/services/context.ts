import { dbGet, dbAll } from '../db-types.js';
import { workspace } from './workspace.js';
import { safeJSONParse } from './parseJSON.js';

function flattenFileTree(nodes: { type: string; path: string; children?: any[] }[]): string[] {
  const files: string[] = [];
  for (const n of nodes) {
    if (n.type === 'file') files.push(n.path);
    if (n.children) files.push(...flattenFileTree(n.children));
  }
  return files;
}

export function buildCourseContext(courseId: string): { info: string; progress: string } {
  // Always query fresh — course progress (completed labs/projects/weeks) changes
  // between requests, and a module-level cache would serve stale data to prompts.
  return _buildCourseContext(courseId);
}

/** Internal implementation — do not call directly, use buildCourseContext() */
function _buildCourseContext(courseId: string): { info: string; progress: string } {
  const course = dbGet<{ id: string; title: string; description: string; content: string; requirements: string }>('SELECT * FROM courses WHERE id = ?', courseId);
  if (!course) return { info: '', progress: '' };

  const syllabus = dbAll<{ week: number; topic: string; status: string }>('SELECT week, topic, status FROM syllabus WHERE course_id = ? ORDER BY week ASC', courseId);
  const totalWeeks = syllabus.length;
  const completedWeeks = syllabus.filter(s => s.status === 'completed').length;

  const counts = dbGet<{ lab_count: number; completed_labs: number; project_count: number; completed_projects: number }>(
    `SELECT
       (SELECT COUNT(*) FROM labs WHERE course_id = ?) as lab_count,
       (SELECT COUNT(*) FROM labs WHERE course_id = ? AND status = 'completed') as completed_labs,
       (SELECT COUNT(*) FROM projects WHERE course_id = ?) as project_count,
       (SELECT COUNT(*) FROM projects WHERE course_id = ? AND status = 'completed') as completed_projects`
  , courseId, courseId, courseId, courseId);
  const labCount = counts?.lab_count ?? 0;
  const completedLabs = counts?.completed_labs ?? 0;
  const projectCount = counts?.project_count ?? 0;
  const completedProjects = counts?.completed_projects ?? 0;

  const info = `课程名称：${course.title}
课程描述：${course.description || '无'}
学习内容：${course.content || '无'}
学习要求：${course.requirements || '无'}
总周数：${totalWeeks}`;

  const progress = `学习进度：
- 大纲进度：${completedWeeks}/${totalWeeks} 周已完成
- 实验：${completedLabs}/${labCount} 个已完成
- 项目：${completedProjects}/${projectCount} 个已完成`;

  return { info, progress };
}

export async function buildLabContext(courseId: string, labId: string): Promise<string> {
  const lab = dbGet<{ title: string; topic: string; test_cases: string }>('SELECT * FROM labs WHERE id = ? AND course_id = ?', labId, courseId);
  if (!lab) return '';

  const course = dbGet<{ title: string }>('SELECT title FROM courses WHERE id = ?', courseId);
  const { progress } = buildCourseContext(courseId);

  // Get file list from disk
  let fileSection = '';
  const dirPath = workspace.getItemPath(courseId, 'labs', labId);
  try {
    const tree = await workspace.listTreeAsync(dirPath);
    const files = flattenFileTree(tree);
    if (files.length > 0) {
      fileSection = `\n实验文件：\n${files.map(f => `- ${f}`).join('\n')}`;
    }
  } catch { /* workspace may not exist yet */ }

  const testCases = safeJSONParse(lab.test_cases, []);
  const testSection = testCases.length > 0
    ? `\n测试用例：\n${testCases.map((t: any) => `- ${t.name}: ${t.description}`).join('\n')}`
    : '';

  return `课程：${course?.title || '未知'}
实验：${lab.title}（主题：${lab.topic}）
${progress}
${fileSection}${testSection}`;
}

export async function buildProjectContext(courseId: string, projectId: string): Promise<string> {
  const project = dbGet<{ title: string; description: string; progress: number; milestones: string }>('SELECT * FROM projects WHERE id = ? AND course_id = ?', projectId, courseId);
  if (!project) return '';

  const course = dbGet<{ title: string }>('SELECT title FROM courses WHERE id = ?', courseId);
  const { progress } = buildCourseContext(courseId);

  let fileSection = '';
  const dirPath = workspace.getItemPath(courseId, 'projects', projectId);
  try {
    const tree = await workspace.listTreeAsync(dirPath);
    const files = flattenFileTree(tree);
    if (files.length > 0) {
      fileSection = `\n项目文件：\n${files.map(f => `- ${f}`).join('\n')}`;
    }
  } catch { /* ignore */ }

  const milestones = safeJSONParse(project.milestones, []);
  const milestoneSection = milestones.length > 0
    ? `\n里程碑：\n${milestones.map((m: any) => `- [${m.status}] ${m.title}: ${m.description}`).join('\n')}`
    : '';

  return `课程：${course?.title || '未知'}
项目：${project.title}
项目描述：${project.description || '无'}
当前进度：${project.progress ?? 0}%
${progress}
${fileSection}${milestoneSection}`;
}
