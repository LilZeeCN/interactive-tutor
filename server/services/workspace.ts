import { join, resolve, relative, dirname, sep } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, renameSync, rmSync } from 'fs';
import { readdir, stat } from 'fs/promises';

const WORKSPACES_ROOT = join(process.cwd(), 'data', 'workspaces');

function validateId(id: string): boolean {
  if (!id || id.includes('..') || id.includes('/') || id.includes(sep) || id.includes('\0')) return false;
  // Block zero-width characters that could be used to bypass validation
  if (/[\u200B-\u200D\uFEFF\u00AD\u2060-\u2064\u180E]/.test(id)) return false;
  return true;
}

function getBasePath(courseId: string): string {
  if (!validateId(courseId)) throw new Error('Invalid courseId');
  return join(WORKSPACES_ROOT, courseId);
}

function getItemPath(courseId: string, type: 'labs' | 'projects', itemId: string): string {
  if (!validateId(courseId) || !validateId(itemId)) throw new Error('Invalid courseId or itemId');
  return join(getBasePath(courseId), type, itemId);
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

function safePath(basePath: string, relativePath: string): string | null {
  const resolvedBase = resolve(basePath);
  const target = resolve(basePath, relativePath);
  if (!target.startsWith(resolvedBase + sep) && target !== resolvedBase) {
    return null;
  }
  if (relativePath.includes('\0')) {
    return null;
  }
  return target;
}

const MAX_FILE_COUNT = 30;
const MAX_FILE_SIZE = 512 * 1024; // 512 KB per file

function writeFiles(dirPath: string, files: Record<string, string>): void {
  const entries = Object.entries(files);
  if (entries.length > MAX_FILE_COUNT) {
    throw new Error(`Too many files: ${entries.length} (max ${MAX_FILE_COUNT})`);
  }
  ensureDir(dirPath);
  for (const [filePath, content] of entries) {
    const fullPath = safePath(dirPath, filePath);
    if (!fullPath) {
      console.warn(`Skipping unsafe path: ${filePath}`);
      continue;
    }
    const size = Buffer.byteLength(content, 'utf-8');
    if (size > MAX_FILE_SIZE) {
      console.warn(`Skipping oversized file: ${filePath} (${size} bytes, max ${MAX_FILE_SIZE})`);
      continue;
    }
    ensureDir(dirname(fullPath));
    writeFileSync(fullPath, content, 'utf-8');
  }
}

function readFile(dirPath: string, filePath: string): string | null {
  const fullPath = safePath(dirPath, filePath);
  if (!fullPath || !existsSync(fullPath)) return null;
  try {
    return readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

function writeFile(dirPath: string, filePath: string, content: string): boolean {
  const fullPath = safePath(dirPath, filePath);
  if (!fullPath) return false;
  const size = Buffer.byteLength(content, 'utf-8');
  if (size > MAX_FILE_SIZE) {
    console.warn(`File too large: ${filePath} (${size} bytes, max ${MAX_FILE_SIZE})`);
    return false;
  }
  ensureDir(dirname(fullPath));
  try {
    writeFileSync(fullPath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function deleteFile(dirPath: string, filePath: string): boolean {
  const fullPath = safePath(dirPath, filePath);
  if (!fullPath || !existsSync(fullPath)) return false;
  try {
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      rmSync(fullPath, { recursive: true });
    } else {
      unlinkSync(fullPath);
    }
    return true;
  } catch {
    return false;
  }
}

function renameFile(dirPath: string, oldPath: string, newPath: string): boolean {
  const fullOld = safePath(dirPath, oldPath);
  const fullNew = safePath(dirPath, newPath);
  if (!fullOld || !fullNew || !existsSync(fullOld)) return false;
  try {
    ensureDir(dirname(fullNew));
    renameSync(fullOld, fullNew);
    return true;
  } catch {
    return false;
  }
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

function listTree(dirPath: string): FileNode[] {
  if (!existsSync(dirPath)) return [];
  function buildTree(currentPath: string, relPath: string): FileNode[] {
    const items = readdirSync(currentPath);
    const nodes: FileNode[] = [];
    for (const item of items) {
      if (item.startsWith('.')) continue;
      const fullPath = join(currentPath, item);
      const itemRelPath = relPath ? `${relPath}/${item}` : item;
      try {
        const itemStat = statSync(fullPath);
        if (itemStat.isDirectory()) {
          const children = buildTree(fullPath, itemRelPath);
          nodes.push({ name: item, path: itemRelPath, type: 'directory', children });
        } else {
          nodes.push({ name: item, path: itemRelPath, type: 'file' });
        }
      } catch {
        // skip unreadable items
      }
    }
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  }
  return buildTree(dirPath, '');
}

async function listTreeAsync(dirPath: string): Promise<FileNode[]> {
  try {
    const items = await readdir(dirPath);
    const nodes: FileNode[] = [];
    for (const item of items) {
      if (item.startsWith('.')) continue;
      const fullPath = join(dirPath, item);
      try {
        const itemStat = await stat(fullPath);
        if (itemStat.isDirectory()) {
          const children = await listTreeAsync(fullPath);
          nodes.push({ name: item, path: item, type: 'directory', children });
        } else {
          nodes.push({ name: item, path: item, type: 'file' });
        }
      } catch {
        // skip unreadable items
      }
    }
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  } catch {
    return [];
  }
}

function deleteWorkspace(courseId: string): void {
  if (!validateId(courseId)) {
    console.warn(`Skipping deleteWorkspace for invalid courseId: ${courseId}`);
    return;
  }
  const basePath = getBasePath(courseId);
  const resolved = resolve(basePath);
  // Extra safety: ensure resolved path is under WORKSPACES_ROOT
  if (!resolved.startsWith(resolve(WORKSPACES_ROOT) + sep) && resolved !== resolve(WORKSPACES_ROOT)) {
    console.warn(`Skipping deleteWorkspace for path outside root: ${resolved}`);
    return;
  }
  if (existsSync(basePath)) {
    rmSync(basePath, { recursive: true });
  }
}

function resolveCwd(cwdParam: string): string {
  // Format: "lab:{courseId}:{itemId}" or "project:{courseId}:{itemId}"
  const parts = cwdParam.split(':');
  if (parts.length !== 3) return process.cwd();
  const [type, courseId, itemId] = parts;
  // Validate no path traversal in courseId/itemId
  if (courseId.includes('..') || courseId.includes('/') || courseId.includes(sep) ||
      itemId.includes('..') || itemId.includes('/') || itemId.includes(sep)) {
    return process.cwd();
  }
  const mappedType = type === 'lab' ? 'labs' : type === 'project' ? 'projects' : null;
  if (!mappedType) return process.cwd();
  const path = getItemPath(courseId, mappedType, itemId);
  ensureDir(path);
  return path;
}

export const workspace = {
  getBasePath,
  getItemPath,
  ensureDir,
  safePath,
  writeFiles,
  readFile,
  writeFile,
  deleteFile,
  renameFile,
  listTree,
  listTreeAsync,
  deleteWorkspace,
  resolveCwd,
  WORKSPACES_ROOT,
};
