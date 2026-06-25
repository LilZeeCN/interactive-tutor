import { Router, Request, Response } from 'express';
import { sendChatMessage } from '../services/ai.js';
import { buildLabContext, buildProjectContext, buildCourseContext } from '../services/context.js';
import { setupSSERes } from '../helpers/sse.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { estimateTokens, truncateTextToTokens } from '../services/tokens.js';
import { REVIEW_CODE_TOKEN_CAP } from '../services/tokenBudgets.js';
import { dbGet, dbAll } from '../db-types.js';
import { workspace } from '../services/workspace.js';

export const reviewRouter = Router();

function flattenFileTree(nodes: any[]): string[] {
  const files: string[] = [];
  for (const n of nodes) {
    if (n.type === 'file') files.push(n.path);
    if (n.children) files.push(...flattenFileTree(n.children));
  }
  return files;
}

// POST /api/review - AI code review with SSE streaming
reviewRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { mode, code, activeFile, question, labTitle, instructions, courseId, labId, projectId } = req.body;

  if (!code && !activeFile) {
    res.status(400).json({ error: 'code 不能为空' });
    return;
  }

  // Build context from lab or project
  let itemContext = '';
  let courseInfo = '';
  let workspaceFilesContext = '';

  if (courseId) {
    const { info } = buildCourseContext(courseId);
    courseInfo = info;
    if (labId) {
      itemContext = await buildLabContext(courseId, labId);
    } else if (projectId) {
      itemContext = await buildProjectContext(courseId, projectId);
    }

    // Save latest content to activeFile on disk if provided to ensure it's saved before reading
    const type = labId ? 'labs' : 'projects';
    const itemId = (labId || projectId) as string;
    if (itemId) {
      const dirPath = workspace.getItemPath(courseId, type, itemId);
      try {
        if (activeFile && code) {
          workspace.writeFile(dirPath, activeFile, code);
        }

        // Read all files from disk for context
        const tree = await workspace.listTreeAsync(dirPath);
        const files = flattenFileTree(tree);
        const fileContents: string[] = [];
        for (const file of files) {
          const content = workspace.readFile(dirPath, file);
          if (content !== null) {
            fileContents.push(`### 文件: ${file}\n\`\`\`\n${content}\n\`\`\``);
          }
        }
        if (fileContents.length > 0) {
          workspaceFilesContext = fileContents.join('\n\n');
        }
      } catch (e) {
        console.error('Failed to read workspace files for review context:', e);
      }
    }
  }

  // Determine code to review: use full workspace files content if available, otherwise fallback to request code
  let codeToReview = workspaceFilesContext || code || '';

  // Cap code size to prevent context overflow
  let cappedCode = codeToReview;
  if (estimateTokens(codeToReview) > REVIEW_CODE_TOKEN_CAP) {
    cappedCode = truncateTextToTokens(codeToReview, REVIEW_CODE_TOKEN_CAP, '\n\n...(代码已截断)');
  }

  const sse = setupSSERes(res, req);

  const abortCtrl = new AbortController();
  // Detect disconnect via SSE write failures, not req.on('close') which fires prematurely

  const isTutorMode = mode === 'tutor' || (typeof instructions === 'string' && instructions.includes('你是这个实验的AI助教'));
  console.log('[/api/review] Incoming request:', { mode, isTutorMode, question, labTitle, labId, projectId });

  let systemPrompt = '';
  if (isTutorMode) {
    const cleanInstructions = (typeof instructions === 'string' && instructions.includes('你是这个实验的AI助教'))
      ? (instructions.match(/实验说明：\n([\s\S]*?)(?:\n\n请用简洁的中文回答|$)/)?.[1] || instructions)
      : instructions;

    systemPrompt = `你是一位专业、耐心的 AI 辅导老师，正在辅助学生完成实验或项目。
请根据具体的实验/项目背景以及学生当前的提问，提供针对性的答疑和辅导。

请遵循以下辅导原则：
1. 【引导式教学】：不要直接给出完整代码或最终答案。先判断学生当前的疑问或卡点，通过提问、指出概念或给出代码片段来逐步引导学生思考。
2. 【严格扣题】：解答和讨论范围必须紧密围绕当前实验/项目的具体说明。如果学生询问“当前实验/项目要求做什么”，请根据“当前说明”为学生清晰、简要地拆解实验/项目目标和步骤。
3. 【基于当前代码】：如果提供了代码，参考其作为学生当前的实现状态，解答他们的疑惑或指出他们逻辑上的卡点，但依然以启发引导为主。
4. 使用 Markdown 格式回复，可以包含代码块，请使用中文回复。

${courseInfo ? `## 课程总体参考信息\n${courseInfo}\n\n` : ''}${itemContext ? `## 实验/项目上下文背景\n${itemContext}\n\n` : ''}当前实验/项目标题：${labTitle || '未知'}
当前说明：
${cleanInstructions || '无'}`;
  } else {
    systemPrompt = `你是一位资深的课程讲师和编程教育专家，负责审查学生的代码。请根据具体的实验/项目说明和代码内容，提供详细的审查意见。

请遵循以下审查约束原则：
1. 【严格对照要求】：只评估学生是否完成了当前实验或项目「说明」中明确要求的内容。如果某项功能、设计或文件在当前的说明中没有被要求，即使其出现在“课程总体参考信息”或“课程要求”里，也绝对不要指责学生缺失此项或未完成。
2. 【专注于实现与质量】：重点指出代码本身的逻辑问题、边缘情况错误、性能隐患、不良编码习惯以及潜在 bug，并给出具体的改进建议与代码示例。
3. 【避免画蛇添足】：不要针对实验说明里未提及的扩展功能、可视化辅助、不相关的设计缺陷或更高难度的改进进行苛求或说教。
4. 使用 Markdown 格式回复，可以包含代码块，请使用中文回复。

${courseInfo ? `## 课程总体参考信息\n${courseInfo}\n\n` : ''}${itemContext ? `## 实验/项目上下文背景\n${itemContext}\n\n` : ''}当前实验/项目标题：${labTitle || '未知'}
当前说明（判定是否完成 the only 标准）：
${instructions || '无'}`;
  }

  try {
    let fullContent = '';
    let promptMessage = '';
    if (isTutorMode) {
      let tutorQuestion = question;
      if (!tutorQuestion && typeof instructions === 'string' && instructions.includes('学生的问题是：')) {
        tutorQuestion = instructions.match(/学生的问题是：([\s\S]*?)(?:\n\n实验标题|$)/)?.[1] || instructions;
      }
      promptMessage = `学生提问：${tutorQuestion || '请问当前实验/项目具体要求我做什么？'}\n\n当前代码文件如下：\n\n${cappedCode}`;
    } else {
      promptMessage = workspaceFilesContext ? `请审查以下代码文件：\n\n${cappedCode}` : `请审查以下代码：\n\n${cappedCode}`;
    }

    await sendChatMessage(
      {
        systemPrompt,
        messages: [{ role: 'user', content: promptMessage }],
      },
      (chunk, kind) => {
        if (sse.isDisconnected()) { if (!abortCtrl.signal.aborted) abortCtrl.abort(); return; }
        if (kind !== 'reasoning') {
          fullContent += chunk;
          sse.sendEvent({ type: 'chunk', content: chunk });
        }
      },
      (full) => {
        if (sse.isDisconnected()) return;
        sse.sendEvent({ type: 'done', content: full });
        sse.cleanup();
      },
      abortCtrl.signal
    );
  } catch (err: any) {
    if (!sse.isDisconnected()) {
      const errorMsg = err?.message || 'AI 服务暂时不可用';
      sse.sendEvent({ type: 'error', error: errorMsg });
    }
    sse.cleanup();
  }
}));
