# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Interactive Tutor — a 1v1 conversational learning platform with structured syllabus, labs, and projects. Originally a Google AI Studio app. UI is primarily in Chinese (Simplified).

**Stack:** React 19 + Vite 6 + Tailwind v4 (frontend) / Express + SQLite (backend) / Anthropic Claude (AI)

## Commands

```bash
npm run dev:all      # Start both server (port 3001) and client (port 3000)
npm run server       # Server only (tsx watch)
npm run dev          # Client only (Vite)
npm run build        # Production build
npm run lint         # TypeScript type check (tsc --noEmit)
npm run test         # Run vitest
npm run test:watch   # Vitest watch mode
npm run clean        # Remove dist/ and data/
```

## Architecture

### Client-Server Communication

- **REST API** via `apiFetch()` wrapper (`src/lib/api.ts`). Vite proxies `/api/*` and `/workspace/*` to `localhost:3001` in dev.
- **SSE Streaming** for AI chat, code review, AI-modify, and topic-note generation. Server: `setupSSERes()` in `server/helpers/sse.ts` (15s heartbeat, 5min max). Client: `readSSEStream()` / `fetchSSE()` in `src/hooks/useStreamFetch.ts`.
- **WebSocket** at `/ws/terminal` for PTY terminal. Auth via one-time token from `/api/terminal-token`.

### Two-Phase Content Generation

1. **On course creation:** Generate syllabus only (~5s). Labs/projects are listed but not detailed.
2. **On demand:** When user clicks a lab/project, `generateLabDetail()` / `generateProjectDetail()` generates starter code and writes to `data/workspaces/{courseId}/labs|projects/{itemId}/`.

### Database (SQLite via better-sqlite3)

- Schema in `server/schema.sql`, migrations inline in `server/db.ts` (ALTER TABLE with try/catch for idempotency)
- `courses` → `syllabus`, `labs`, `projects`, `topics`, `notes`, `topic_notes` (cascade on delete)
- `topics` → `messages` (chat history)
- `settings` key-value store for API config

### Server Structure

- `server/routes/` — Express route handlers (courses, chat, content, settings, review, workspace, environment)
- `server/services/` — Business logic (ai.ts for Anthropic SDK wrapper, generator.ts for content orchestration, context.ts for prompt building, workspace.ts for file operations)
- `server/prompts/` — AI prompt templates (syllabus, labs, projects, notes, topicNotes, contentModify)
- `server/helpers/` — Express async wrapper, SSE helper
- `server/terminal/` — node-pty terminal manager with child_process fallback

### Client Structure

- `src/components/` — React UI components
- `src/hooks/` — Shared hooks: `useStreamFetch` (SSE), `useTerminal` (xterm.js), `useWorkspace` (file tree + editor + AI modify)
- `src/lib/` — Utilities: `api.ts`, `monaco.ts` (language mapping), `utils.ts` (cn helper)

### Key Patterns

- AI responses parsed robustly via `parseJSON()` (handles markdown code blocks, raw arrays/objects)
- API keys encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY` env var required)
- Workspace files: max 30 files, 512KB per file, path traversal protection via `safePath()`
- Rate limiting: 30 req/min on AI endpoints (in-memory)
- Dark theme only (#050505 background)
- Session state persisted in sessionStorage

## Environment Setup

Required env vars (see `.env.example`):
- `ENCRYPTION_KEY` — AES-256-GCM key for encrypting stored API keys
- `APP_URL` — Application URL

Users configure their own Anthropic API key and model through the Settings modal in the UI (encrypted and stored in DB).

## Testing

- Framework: Vitest
- Integration tests in `server/__tests__/integration.test.ts` (courses CRUD, workspace, settings, chat)
- Unit tests in `server/__tests__/parseJSON.test.ts` and `server/__tests__/workspace.test.ts`
- Integration tests use a test server on port 3099
