# Interactive Tutor

[中文文档](README_CN.md)

An AI-powered 1v1 conversational learning platform with structured syllabus, interactive lectures, hands-on labs, and comprehensive projects. Built as a full-stack web application with a built-in code editor and terminal.

## Features

### Course Management
- **AI-Generated Syllabus** — Create a course by providing a topic, and AI generates a complete week-by-week syllabus with readings and assignments
- **Multiple Lecture Styles** — Choose from 6 teaching styles: Khan Academy, ChatGPT-Learn, Feynman, Socratic, First Principles, and Harvard Tutor
- **Lecture Format Options** — Markdown or HTML rendering for lecture content
- **On-Demand Content Generation** — Syllabus is generated on creation; labs and projects are generated when you open them

### Interactive Learning
- **AI Classroom** — 1v1 conversational tutoring with streaming responses via SSE, supporting LaTeX math rendering and syntax-highlighted code blocks
- **Persistent Memory** — The AI maintains a per-course student profile and learning summary, so it remembers your progress and adapts to your level
- **Deep Reasoning** — Built-in "Deep Think" mode for complex problem-solving with step-by-step reasoning

### Hands-On Practice
- **Code Labs** — AI-generated coding exercises with starter code, test cases, and a Monaco editor workspace
- **Projects** — Multi-milestone projects with progress tracking, starter code, and acceptance criteria
- **Built-in Terminal** — Full PTY terminal (xterm.js + node-pty) for running code directly in the browser
- **AI Code Review** — Submit code for AI-powered review with suggestions and fixes
- **AI Code Modify** — Ask the AI to modify your code directly in the editor

### Learning Tools
- **Spaced Repetition** — SM-2 algorithm-based review system with flashcard-style review items generated from lecture content
- **Lecture Progress Tracking** — Track reading status and time spent per section
- **Version History** — Lecture content versioning for tracking changes
- **Export** — Export course content for offline access
- **Course Notes** — Per-course note-taking with AI-generated topic notes

### Security & Architecture
- **Encrypted API Keys** — AES-256-GCM encryption for stored API keys
- **Session Authentication** — Token-based auth with one-time terminal tokens
- **Rate Limiting** — 30 req/min on AI generation endpoints
- **Input Validation** — Path traversal protection, file size limits, content sanitization
- **Dark Theme** — Optimized dark-only UI designed for extended study sessions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite 6, Tailwind CSS v4, TypeScript |
| **Backend** | Express, TypeScript (tsx), SQLite (better-sqlite3) |
| **AI** | Anthropic Claude SDK, Google GenAI SDK, OpenAI SDK |
| **Code Editor** | Monaco Editor (@monaco-editor/react) |
| **Terminal** | xterm.js + node-pty |
| **Streaming** | Server-Sent Events (SSE) |
| **Testing** | Vitest |

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **Anthropic API Key** (primary AI provider)

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/interactive-tutor.git
cd interactive-tutor

# Install dependencies
npm install
```

### Configuration

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set the required variables:
   ```env
   # Required: Generate with -> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ENCRYPTION_KEY="your-random-32-byte-hex-key"

   # Required: Application URL
   APP_URL="http://localhost:3000"
   ```

3. Start the application:
   ```bash
   # Start both server and client
   npm run dev:all
   ```

   Or start them separately:
   ```bash
   # Backend only (port 3001)
   npm run server

   # Frontend only (port 3000)
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) and configure your API key in **Settings**.

### API Key Setup

The app does not bundle any API keys. On first use:
1. Click the **Settings** (设置) button in the sidebar
2. Enter your **Anthropic API Key**
3. Choose your preferred model
4. Keys are encrypted with AES-256-GCM and stored locally in SQLite

## Project Structure

```
interactive-tutor/
├── server/                    # Express backend
│   ├── index.ts               # App entry point, Express + WebSocket setup
│   ├── db.ts                  # SQLite database initialization + migrations
│   ├── schema.sql             # Database schema
│   ├── routes/                # API route handlers
│   │   ├── courses.ts         # Course CRUD
│   │   ├── chat.ts            # AI chat (SSE streaming)
│   │   ├── content.ts         # Syllabus, labs, projects generation
│   │   ├── lectures.ts        # Lecture CRUD + generation
│   │   ├── review.ts          # AI code review
│   │   ├── workspace.ts       # File operations for labs/projects
│   │   ├── settings.ts        # API key configuration
│   │   ├── environment.ts     # Runtime environment detection
│   │   ├── progress.ts        # Lecture progress tracking
│   │   ├── versions.ts        # Content versioning
│   │   ├── export.ts          # Course export
│   │   └── reviewItems.ts     # Spaced repetition items
│   ├── services/              # Business logic
│   │   ├── ai.ts              # Anthropic/OpenAI/GenAI SDK wrapper
│   │   ├── generator.ts       # Content orchestration (syllabus, labs, projects)
│   │   ├── context.ts         # AI prompt building with token budgets
│   │   ├── memory.ts          # Per-course persistent memory (profile + summary)
│   │   ├── workspace.ts       # File system operations
│   │   ├── spacedRepetition.ts # SM-2 algorithm implementation
│   │   ├── deepSolve.ts       # Deep reasoning mode
│   │   ├── crypto.ts          # AES-256-GCM encryption
│   │   └── ...                # Token counting, parsing, validation, etc.
│   ├── prompts/               # AI prompt templates
│   │   ├── syllabus.ts        # Syllabus generation prompt
│   │   ├── labs.ts            # Lab generation prompt
│   │   ├── projects.ts        # Project generation prompt
│   │   ├── lectures.ts        # Lecture generation prompt
│   │   ├── notes.ts           # Note generation prompt
│   │   └── topicNotes.ts      # Topic note generation prompt
│   ├── terminal/              # PTY terminal manager
│   ├── middleware/             # Auth middleware
│   └── helpers/               # SSE, async handler, task tracker
├── src/                       # React frontend
│   ├── App.tsx                # Main app with navigation state
│   ├── components/
│   │   ├── ChatView.tsx       # AI chat interface
│   │   ├── LectureView.tsx    # Lecture reader with progress
│   │   ├── LabWorkspace.tsx   # Code editor + terminal for labs
│   │   ├── ProjectWorkspace.tsx # Code editor + terminal for projects
│   │   ├── SyllabusTab.tsx    # Syllabus viewer
│   │   ├── NotesTab.tsx       # Notes viewer
│   │   ├── Sidebar.tsx        # Navigation sidebar
│   │   ├── SettingsModal.tsx  # API key & model settings
│   │   ├── MarkdownRenderer.tsx # Markdown with KaTeX, code highlighting
│   │   └── ...
│   ├── hooks/
│   │   ├── useStreamFetch.ts  # SSE stream consumer
│   │   ├── useTerminal.ts     # xterm.js terminal hook
│   │   └── useWorkspace.ts    # File tree + editor + AI modify
│   ├── lib/
│   │   ├── api.ts             # apiFetch() wrapper with auth
│   │   └── utils.ts           # cn() utility
│   └── types.ts               # TypeScript type definitions
├── package.json
├── vite.config.ts             # Vite config with API proxy
├── tsconfig.json
└── CLAUDE.md                  # Development guide for AI assistants
```

## Database Schema

The app uses SQLite with the following key tables:

| Table | Purpose |
|-------|---------|
| `courses` | Course metadata and settings |
| `syllabus` | Week-by-week syllabus entries |
| `lectures` | Generated lecture content per section |
| `lecture_progress` | Per-section reading status and time tracking |
| `lecture_versions` | Content version history |
| `labs` | Lab exercises with starter code and test cases |
| `projects` | Multi-milestone projects with progress |
| `topics` | Chat conversation topics |
| `messages` | Chat message history |
| `topic_notes` | AI-generated topic notes |
| `notes` | Course-level notes |
| `review_items` | Spaced repetition flashcards |
| `course_memory` | Per-course student profile + learning summary |
| `settings` | Key-value store for API configuration |

All foreign keys use `ON DELETE CASCADE`. Migrations run inline in `server/db.ts` with idempotent `ALTER TABLE` statements.

## API Overview

The backend exposes REST endpoints under `/api/`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/courses` | GET/POST | List or create courses |
| `/api/courses/:id` | GET/PUT/DELETE | Course CRUD |
| `/api/chat/:topicId` | POST (SSE) | AI chat with streaming |
| `/api/courses/:id/syllabus` | POST (SSE) | Generate syllabus |
| `/api/courses/:id/labs/:labId` | POST (SSE) | Generate lab detail |
| `/api/courses/:id/projects/:projId` | POST (SSE) | Generate project detail |
| `/api/courses/:id/lectures` | GET/POST | List or generate lectures |
| `/api/review` | POST (SSE) | AI code review |
| `/api/workspace/*` | GET/PUT | File read/write operations |
| `/api/settings` | GET/PUT | API key and model settings |
| `/api/environment/detect` | GET | Detect installed runtimes |

WebSocket endpoint at `/ws/terminal` for PTY terminal with token-based auth.

## Scripts

```bash
npm run dev:all      # Start both server (port 3001) and client (port 3000)
npm run server       # Server only (tsx watch)
npm run dev          # Client only (Vite dev server)
npm run build        # Production build
npm run lint         # TypeScript type check (tsc --noEmit)
npm run test         # Run tests (Vitest)
npm run test:watch   # Vitest in watch mode
npm run clean        # Remove dist/ and data/
```

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

Tests include:
- **Integration tests** — Course CRUD, workspace operations, settings, chat (`server/__tests__/integration.test.ts`)
- **Unit tests** — JSON parsing, workspace utilities (`server/__tests__/parseJSON.test.ts`, `server/__tests__/workspace.test.ts`)

## License

MIT
