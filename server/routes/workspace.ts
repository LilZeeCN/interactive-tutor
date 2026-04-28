import { Router, Request, Response } from 'express';
import { workspace } from '../services/workspace.js';
import { getDb } from '../db.js';
import { safeJSONParse } from '../services/parseJSON.js';
import { dbGet, dbAll } from '../db-types.js';

export const workspaceRouter = Router();

// GET /api/workspace/:courseId/:type/:itemId/tree — list file tree
workspaceRouter.get('/:courseId/:type/:itemId/tree', (req: Request, res: Response) => {
  try {
    const { courseId, type, itemId } = req.params;
    if (type !== 'labs' && type !== 'projects') {
      res.status(400).json({ error: 'type 必须是 labs 或 projects' });
      return;
    }
    const dirPath = workspace.getItemPath(courseId, type as 'labs' | 'projects', itemId);
    const tree = workspace.listTree(dirPath);
    res.json(tree);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '获取文件列表失败' });
  }
});

// GET /api/workspace/:courseId/:type/:itemId/file/* — read file
workspaceRouter.get('/:courseId/:type/:itemId/file/*', (req: Request, res: Response) => {
  try {
    const { courseId, type, itemId } = req.params;
    if (type !== 'labs' && type !== 'projects') {
      res.status(400).json({ error: 'type 必须是 labs 或 projects' });
      return;
    }
    const filePath = req.params[0]; // wildcard capture
    const dirPath = workspace.getItemPath(courseId, type as 'labs' | 'projects', itemId);
    const content = workspace.readFile(dirPath, filePath);
    if (content === null) {
      res.status(404).json({ error: '文件不存在' });
      return;
    }
    res.json({ content });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '读取文件失败' });
  }
});

// PUT /api/workspace/:courseId/:type/:itemId/file/* — write/update file
workspaceRouter.put('/:courseId/:type/:itemId/file/*', (req: Request, res: Response) => {
  try {
    const { courseId, type, itemId } = req.params;
    if (type !== 'labs' && type !== 'projects') {
      res.status(400).json({ error: 'type 必须是 labs 或 projects' });
      return;
    }
    const filePath = req.params[0];
    const { content } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content 必须是字符串' });
      return;
    }
    const dirPath = workspace.getItemPath(courseId, type as 'labs' | 'projects', itemId);
    const success = workspace.writeFile(dirPath, filePath, content);
    if (!success) {
      res.status(500).json({ error: '写入文件失败' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '写入文件失败' });
  }
});

// POST /api/workspace/:courseId/:type/:itemId/file — create new file or directory
workspaceRouter.post('/:courseId/:type/:itemId/file', (req: Request, res: Response) => {
  try {
    const { courseId, type, itemId } = req.params;
    if (type !== 'labs' && type !== 'projects') {
      res.status(400).json({ error: 'type 必须是 labs 或 projects' });
      return;
    }
    const { path: filePath, content, fileType } = req.body;
    const dirPath = workspace.getItemPath(courseId, type as 'labs' | 'projects', itemId);
    if (!filePath) {
      res.status(400).json({ error: 'path 不能为空' });
      return;
    }
    if (fileType === 'directory') {
      const fullPath = workspace.safePath(dirPath, filePath);
      if (!fullPath) {
        res.status(403).json({ error: '路径无效' });
        return;
      }
      workspace.ensureDir(fullPath);
      res.json({ success: true });
      return;
    }
    const success = workspace.writeFile(dirPath, filePath, content || '');
    if (!success) {
      res.status(500).json({ error: '创建文件失败' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '创建文件失败' });
  }
});

// DELETE /api/workspace/:courseId/:type/:itemId/file/* — delete file
workspaceRouter.delete('/:courseId/:type/:itemId/file/*', (req: Request, res: Response) => {
  try {
    const { courseId, type, itemId } = req.params;
    if (type !== 'labs' && type !== 'projects') {
      res.status(400).json({ error: 'type 必须是 labs 或 projects' });
      return;
    }
    const filePath = req.params[0];
    const dirPath = workspace.getItemPath(courseId, type as 'labs' | 'projects', itemId);
    const success = workspace.deleteFile(dirPath, filePath);
    if (!success) {
      res.status(404).json({ error: '文件不存在' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '删除文件失败' });
  }
});

// POST /api/workspace/:courseId/:type/:itemId/rename — rename file
workspaceRouter.post('/:courseId/:type/:itemId/rename', (req: Request, res: Response) => {
  try {
    const { courseId, type, itemId } = req.params;
    if (type !== 'labs' && type !== 'projects') {
      res.status(400).json({ error: 'type 必须是 labs 或 projects' });
      return;
    }
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      res.status(400).json({ error: '缺少 oldPath 或 newPath 参数' });
      return;
    }
    const dirPath = workspace.getItemPath(courseId, type as 'labs' | 'projects', itemId);
    const success = workspace.renameFile(dirPath, oldPath, newPath);
    if (!success) {
      res.status(500).json({ error: '重命名文件失败' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '重命名文件失败' });
  }
});

// POST /api/workspace/:courseId/:type/:itemId/sync — sync starter_code from DB to disk
workspaceRouter.post('/:courseId/:type/:itemId/sync', (req: Request, res: Response) => {
  try {
    const { courseId, type, itemId } = req.params;
    if (type !== 'labs' && type !== 'projects') {
      res.status(400).json({ error: 'type 必须是 labs 或 projects' });
      return;
    }

    const db = getDb();
    const tableName = type === 'labs' ? 'labs' : 'projects';
    const row = dbGet(`SELECT starter_code FROM ${tableName} WHERE id = ? AND course_id = ?`, itemId, courseId);

    if (!row) {
      res.status(404).json({ error: '项目不存在' });
      return;
    }

    const starterCode = safeJSONParse(row.starter_code, {});
    const dirPath = workspace.getItemPath(courseId, type as 'labs' | 'projects', itemId);
    workspace.writeFiles(dirPath, starterCode);
    res.json({ success: true, filesCount: Object.keys(starterCode).length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || '同步文件失败' });
  }
});
