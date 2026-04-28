import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join, resolve, sep } from 'path';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { workspace } from '../services/workspace.js';

const TEST_ROOT = join(process.cwd(), 'data', 'test-workspace');

describe('workspace.safePath', () => {
  it('resolves a normal relative path', () => {
    const result = workspace.safePath('/tmp/test', 'src/index.ts');
    expect(result).toBe(resolve('/tmp/test/src/index.ts'));
  });

  it('returns null for path traversal with ..', () => {
    expect(workspace.safePath('/tmp/test', '../../etc/passwd')).toBeNull();
  });

  it('returns null for absolute path escape', () => {
    expect(workspace.safePath('/tmp/test', '/etc/passwd')).toBeNull();
  });

  it('returns null for null byte injection', () => {
    expect(workspace.safePath('/tmp/test', 'file\0.txt')).toBeNull();
  });

  it('allows same-directory reference', () => {
    const result = workspace.safePath('/tmp/test', 'file.txt');
    expect(result).toBe(resolve('/tmp/test/file.txt'));
  });

  it('allows nested subdirectory', () => {
    const result = workspace.safePath('/tmp/test', 'a/b/c.txt');
    expect(result).toBe(resolve('/tmp/test/a/b/c.txt'));
  });
});

describe('workspace.resolveCwd', () => {
  it('resolves lab path correctly', () => {
    const result = workspace.resolveCwd('lab:course1:lab1');
    expect(result).toContain('labs');
    expect(result).toContain('course1');
    expect(result).toContain('lab1');
  });

  it('resolves project path correctly', () => {
    const result = workspace.resolveCwd('project:course1:proj1');
    expect(result).toContain('projects');
  });

  it('returns cwd for invalid format', () => {
    expect(workspace.resolveCwd('invalid')).toBe(process.cwd());
  });

  it('returns cwd for wrong part count', () => {
    expect(workspace.resolveCwd('lab:course1')).toBe(process.cwd());
  });

  it('returns cwd for path traversal in courseId', () => {
    expect(workspace.resolveCwd('lab:../etc:lab1')).toBe(process.cwd());
  });

  it('returns cwd for path traversal in itemId', () => {
    expect(workspace.resolveCwd('lab:course1:..')).toBe(process.cwd());
  });

  it('returns cwd for slash in courseId', () => {
    expect(workspace.resolveCwd('lab:foo/bar:lab1')).toBe(process.cwd());
  });

  it('returns cwd for unknown type', () => {
    expect(workspace.resolveCwd('quiz:course1:item1')).toBe(process.cwd());
  });
});

describe('workspace file operations', () => {
  beforeEach(() => {
    mkdirSync(TEST_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('writeFiles + readFile roundtrip', () => {
    workspace.writeFiles(TEST_ROOT, {
      'main.py': 'print("hello")',
      'src/utils.py': 'def add(a, b): return a + b',
    });
    expect(workspace.readFile(TEST_ROOT, 'main.py')).toBe('print("hello")');
    expect(workspace.readFile(TEST_ROOT, 'src/utils.py')).toBe('def add(a, b): return a + b');
  });

  it('skips unsafe paths in writeFiles', () => {
    workspace.writeFiles(TEST_ROOT, {
      '../../../etc/evil': 'bad',
      'safe.txt': 'ok',
    });
    expect(workspace.readFile(TEST_ROOT, '../../../etc/evil')).toBeNull();
    expect(workspace.readFile(TEST_ROOT, 'safe.txt')).toBe('ok');
  });

  it('listTree returns correct structure', () => {
    workspace.writeFiles(TEST_ROOT, {
      'a.txt': '1',
      'sub/b.txt': '2',
    });
    const tree = workspace.listTree(TEST_ROOT);
    expect(tree).toHaveLength(2);
    const dir = tree.find(n => n.type === 'directory');
    expect(dir?.name).toBe('sub');
    expect(dir?.children).toHaveLength(1);
  });

  it('deleteFile removes file', () => {
    workspace.writeFiles(TEST_ROOT, { 'x.txt': 'x' });
    expect(workspace.deleteFile(TEST_ROOT, 'x.txt')).toBe(true);
    expect(workspace.readFile(TEST_ROOT, 'x.txt')).toBeNull();
  });

  it('renameFile moves file', () => {
    workspace.writeFiles(TEST_ROOT, { 'old.txt': 'data' });
    expect(workspace.renameFile(TEST_ROOT, 'old.txt', 'new.txt')).toBe(true);
    expect(workspace.readFile(TEST_ROOT, 'old.txt')).toBeNull();
    expect(workspace.readFile(TEST_ROOT, 'new.txt')).toBe('data');
  });

  it('writeFile creates new file', () => {
    expect(workspace.writeFile(TEST_ROOT, 'created.txt', 'hello')).toBe(true);
    expect(workspace.readFile(TEST_ROOT, 'created.txt')).toBe('hello');
  });

  it('readFile returns null for non-existent', () => {
    expect(workspace.readFile(TEST_ROOT, 'nope.txt')).toBeNull();
  });

  it('readFile returns null for unsafe path', () => {
    expect(workspace.readFile(TEST_ROOT, '../../etc/passwd')).toBeNull();
  });
});
