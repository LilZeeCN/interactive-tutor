import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../index.js';
import type { Server } from 'http';

const BASE = 'http://localhost:3099';

let server: Server;
let authToken: string;

async function authFetch(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${authToken}`);
  if (!headers.has('Content-Type') && init?.body) headers.set('Content-Type', 'application/json');
  return fetch(url, { ...init, headers });
}

beforeAll(async () => {
  process.env.PORT = '3099';
  process.env.ENCRYPTION_KEY = 'test-encryption-key-for-integration-tests';
  const { server: s } = createApp();
  server = s;
  await new Promise<void>((resolve) => {
    server.listen(3099, () => resolve());
  });
  // Bootstrap auth token
  const bootstrapRes = await fetch(`${BASE}/api/bootstrap`);
  const bootstrapData = await bootstrapRes.json();
  authToken = bootstrapData.token as string;
}, 10000);

afterAll(async () => {
  server.close();
});

describe('Courses API', () => {
  it('GET /api/courses returns array', async () => {
    const res = await authFetch(`${BASE}/api/courses`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  let createdCourseId: string;

  it('POST /api/courses creates a course', async () => {
    const res = await authFetch(`${BASE}/api/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test Course', description: 'desc', content: 'content', requirements: 'reqs' }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe('Test Course');
    expect(data.id).toBeDefined();
    createdCourseId = data.id;
  });

  it('DELETE /api/courses/:id cleans up test course', async () => {
    if (!createdCourseId) return;
    const res = await authFetch(`${BASE}/api/courses/${createdCourseId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
  });

  it('GET /api/courses/:id returns 404 for missing', async () => {
    const res = await authFetch(`${BASE}/api/courses/nonexistent`);
    expect(res.status).toBe(404);
  });
});

describe('Workspace API', () => {
  it('GET tree rejects invalid type', async () => {
    const res = await authFetch(`${BASE}/api/workspace/test-course/invalid-type/lab-1/tree`);
    expect(res.status).toBe(400);
  });

  it('GET tree returns array for valid params', async () => {
    const res = await authFetch(`${BASE}/api/workspace/test-course/labs/lab-1/tree`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('Settings API', () => {
  it('GET /api/settings returns masked key', async () => {
    // First set a key
    await authFetch(`${BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: 'sk-test-key-12345678' }),
    });

    const res = await authFetch(`${BASE}/api/settings`);
    expect(res.status).toBe(200);
    const data = await res.json();
    // Key should be masked
    if (data.api_key) {
      expect(data.api_key).not.toBe('sk-test-key-12345678');
      expect(data.api_key).toContain('****');
    }
  });
});

describe('Chat API', () => {
  it('POST /api/chat validates required fields', async () => {
    const res = await authFetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/chat/topics validates courseId', async () => {
    const res = await authFetch(`${BASE}/api/chat/topics`);
    expect(res.status).toBe(400);
  });
});
