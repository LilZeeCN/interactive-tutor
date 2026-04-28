# Interactive Tutor — AI 智能学习平台

[English](README.md)

一个基于 AI 的 1v1 对话式学习平台，具备结构化教学大纲、交互式讲义、动手实验和综合项目。内置代码编辑器和终端的全栈 Web 应用。

## 功能特性

### 课程管理
- **AI 生成教学大纲** — 只需提供主题，AI 自动生成完整的按周安排的教学大纲，包含阅读材料和作业
- **多种授课风格** — 提供 6 种教学模式：Khan Academy、ChatGPT-Learn、费曼、苏格拉底、第一性原理、哈佛导师
- **讲义格式选项** — 支持 Markdown 或 HTML 渲染
- **按需内容生成** — 创建课程时生成大纲；实验和项目在打开时按需生成

### 交互式学习
- **AI 课堂** — 1v1 对话式教学，支持 SSE 流式响应、LaTeX 数学公式渲染和代码语法高亮
- **持久记忆** — AI 为每门课程维护学生档案和学习摘要，记住你的学习进度并自适应调整教学水平
- **深度推理** — 内置"深度思考"模式，用于复杂问题的逐步推理

### 动手实践
- **编程实验** — AI 生成的编程练习，包含起始代码、测试用例和 Monaco 编辑器工作区
- **综合项目** — 多里程碑项目，支持进度跟踪、起始代码和验收标准
- **内置终端** — 基于 xterm.js + node-pty 的完整 PTY 终端，可直接在浏览器中运行代码
- **AI 代码审查** — 提交代码获取 AI 驱动的代码审查建议
- **AI 代码修改** — 让 AI 直接在编辑器中修改你的代码

### 学习工具
- **间隔重复** — 基于 SM-2 算法的复习系统，从讲义内容自动生成闪卡式复习题
- **讲义进度追踪** — 跟踪每个章节的阅读状态和用时
- **版本历史** — 讲义内容版本管理
- **课程导出** — 导出课程内容供离线使用
- **课程笔记** — 支持手动笔记和 AI 自动生成的主题笔记

### 安全与架构
- **API 密钥加密** — AES-256-GCM 加密存储 API 密钥
- **会话认证** — 基于 Token 的认证，终端使用一次性 Token
- **速率限制** — AI 生成接口限制为每分钟 30 次请求
- **输入验证** — 路径遍历防护、文件大小限制、内容消毒
- **深色主题** — 专为长时间学习设计的深色 UI

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 19, Vite 6, Tailwind CSS v4, TypeScript |
| **后端** | Express, TypeScript (tsx), SQLite (better-sqlite3) |
| **AI** | Anthropic Claude SDK, Google GenAI SDK, OpenAI SDK |
| **代码编辑器** | Monaco Editor (@monico-editor/react) |
| **终端** | xterm.js + node-pty |
| **流式传输** | Server-Sent Events (SSE) |
| **测试** | Vitest |

## 快速开始

### 环境要求

- **Node.js** >= 18
- **Anthropic API Key**（主要 AI 提供商）

### 安装

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/interactive-tutor.git
cd interactive-tutor

# 安装依赖
npm install
```

### 配置

1. 复制环境变量示例文件：
   ```bash
   cp .env.example .env
   ```

2. 编辑 `.env` 文件，设置必需的变量：
   ```env
   # 必填：使用以下命令生成 -> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ENCRYPTION_KEY="你的随机32字节十六进制密钥"

   # 必填：应用 URL
   APP_URL="http://localhost:3000"
   ```

3. 启动应用：
   ```bash
   # 同时启动服务器和客户端
   npm run dev:all
   ```

   或分别启动：
   ```bash
   # 仅后端（端口 3001）
   npm run server

   # 仅前端（端口 3000）
   npm run dev
   ```

4. 打开 [http://localhost:3000](http://localhost:3000)，在 **设置** 中配置你的 API 密钥。

### API 密钥设置

本应用不内置任何 API 密钥。首次使用时：
1. 点击侧边栏中的 **设置** 按钮
2. 输入你的 **Anthropic API Key**
3. 选择你偏好的模型
4. 密钥将通过 AES-256-GCM 加密并存储在本地 SQLite 数据库中

## 项目结构

```
interactive-tutor/
├── server/                    # Express 后端
│   ├── index.ts               # 应用入口，Express + WebSocket 配置
│   ├── db.ts                  # SQLite 数据库初始化 + 迁移
│   ├── schema.sql             # 数据库表结构
│   ├── routes/                # API 路由处理器
│   │   ├── courses.ts         # 课程增删改查
│   │   ├── chat.ts            # AI 聊天（SSE 流式）
│   │   ├── content.ts         # 大纲、实验、项目生成
│   │   ├── lectures.ts        # 讲义增删改查 + 生成
│   │   ├── review.ts          # AI 代码审查
│   │   ├── workspace.ts       # 实验和项目的文件操作
│   │   ├── settings.ts        # API 密钥配置
│   │   ├── environment.ts     # 运行时环境检测
│   │   ├── progress.ts        # 讲义进度追踪
│   │   ├── versions.ts        # 内容版本管理
│   │   ├── export.ts          # 课程导出
│   │   └── reviewItems.ts     # 间隔重复复习题
│   ├── services/              # 业务逻辑层
│   │   ├── ai.ts              # Anthropic/OpenAI/GenAI SDK 封装
│   │   ├── generator.ts       # 内容编排（大纲、实验、项目）
│   │   ├── context.ts         # AI 提示词构建（含 Token 预算）
│   │   ├── memory.ts          # 每门课程的持久记忆（档案 + 摘要）
│   │   ├── workspace.ts       # 文件系统操作
│   │   ├── spacedRepetition.ts # SM-2 算法实现
│   │   ├── deepSolve.ts       # 深度推理模式
│   │   ├── crypto.ts          # AES-256-GCM 加密
│   │   └── ...                # Token 计数、解析、验证等
│   ├── prompts/               # AI 提示词模板
│   │   ├── syllabus.ts        # 教学大纲生成提示词
│   │   ├── labs.ts            # 实验生成提示词
│   │   ├── projects.ts        # 项目生成提示词
│   │   ├── lectures.ts        # 讲义生成提示词
│   │   ├── notes.ts           # 笔记生成提示词
│   │   └── topicNotes.ts      # 主题笔记生成提示词
│   ├── terminal/              # PTY 终端管理器
│   ├── middleware/             # 认证中间件
│   └── helpers/               # SSE、异步处理器、任务追踪器
├── src/                       # React 前端
│   ├── App.tsx                # 主应用及导航状态管理
│   ├── components/
│   │   ├── ChatView.tsx       # AI 聊天界面
│   │   ├── LectureView.tsx    # 讲义阅读器（含进度）
│   │   ├── LabWorkspace.tsx   # 实验代码编辑器 + 终端
│   │   ├── ProjectWorkspace.tsx # 项目代码编辑器 + 终端
│   │   ├── SyllabusTab.tsx    # 教学大纲查看器
│   │   ├── NotesTab.tsx       # 笔记查看器
│   │   ├── Sidebar.tsx        # 导航侧边栏
│   │   ├── SettingsModal.tsx  # API 密钥和模型设置
│   │   ├── MarkdownRenderer.tsx # Markdown 渲染（KaTeX、代码高亮）
│   │   └── ...
│   ├── hooks/
│   │   ├── useStreamFetch.ts  # SSE 流消费者
│   │   ├── useTerminal.ts     # xterm.js 终端 Hook
│   │   └── useWorkspace.ts    # 文件树 + 编辑器 + AI 修改
│   ├── lib/
│   │   ├── api.ts             # apiFetch() 封装（含认证）
│   │   └── utils.ts           # cn() 工具函数
│   └── types.ts               # TypeScript 类型定义
├── package.json
├── vite.config.ts             # Vite 配置（含 API 代理）
├── tsconfig.json
└── CLAUDE.md                  # AI 助手开发指南
```

## 数据库结构

应用使用 SQLite，核心数据表如下：

| 表名 | 用途 |
|------|------|
| `courses` | 课程元数据和设置 |
| `syllabus` | 按周安排的教学大纲条目 |
| `lectures` | 每个章节的生成讲义内容 |
| `lecture_progress` | 每章节的阅读状态和用时追踪 |
| `lecture_versions` | 讲义内容版本历史 |
| `labs` | 实验练习（含起始代码和测试用例） |
| `projects` | 多里程碑项目（含进度） |
| `topics` | 聊天对话主题 |
| `messages` | 聊天消息历史 |
| `topic_notes` | AI 生成的主题笔记 |
| `notes` | 课程级笔记 |
| `review_items` | 间隔重复闪卡 |
| `course_memory` | 每门课程的学生档案 + 学习摘要 |
| `settings` | API 配置的键值存储 |

所有外键使用 `ON DELETE CASCADE`。数据库迁移在 `server/db.ts` 中以幂等的 `ALTER TABLE` 语句内联执行。

## API 概览

后端在 `/api/` 下暴露 REST 接口：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/courses` | GET/POST | 获取课程列表或创建课程 |
| `/api/courses/:id` | GET/PUT/DELETE | 课程增删改查 |
| `/api/chat/:topicId` | POST (SSE) | AI 流式聊天 |
| `/api/courses/:id/syllabus` | POST (SSE) | 生成教学大纲 |
| `/api/courses/:id/labs/:labId` | POST (SSE) | 生成实验详情 |
| `/api/courses/:id/projects/:projId` | POST (SSE) | 生成项目详情 |
| `/api/courses/:id/lectures` | GET/POST | 获取或生成讲义 |
| `/api/review` | POST (SSE) | AI 代码审查 |
| `/api/workspace/*` | GET/PUT | 文件读写操作 |
| `/api/settings` | GET/PUT | API 密钥和模型设置 |
| `/api/environment/detect` | GET | 检测已安装的运行时环境 |

WebSocket 端点 `/ws/terminal` 用于 PTY 终端，采用基于 Token 的认证。

## 脚本命令

```bash
npm run dev:all      # 同时启动服务器（端口 3001）和客户端（端口 3000）
npm run server       # 仅服务器（tsx watch）
npm run dev          # 仅客户端（Vite 开发服务器）
npm run build        # 生产构建
npm run lint         # TypeScript 类型检查 (tsc --noEmit)
npm run test         # 运行测试（Vitest）
npm run test:watch   # Vitest 监听模式
npm run clean        # 清除 dist/ 和 data/
```

## 测试

```bash
# 运行所有测试
npm test

# 监听模式
npm run test:watch
```

测试覆盖：
- **集成测试** — 课程增删改查、工作区操作、设置、聊天（`server/__tests__/integration.test.ts`）
- **单元测试** — JSON 解析、工作区工具函数（`server/__tests__/parseJSON.test.ts`、`server/__tests__/workspace.test.ts`）

## 许可证

MIT
