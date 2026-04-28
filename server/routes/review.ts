import { Router, Request, Response } from 'express';
import { sendChatMessage } from '../services/ai.js';
import { buildLabContext, buildProjectContext, buildCourseContext } from '../services/context.js';
import { setupSSERes } from '../helpers/sse.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { estimateTokens, truncateTextToTokens } from '../services/tokens.js';
import { REVIEW_CODE_TOKEN_CAP } from '../services/tokenBudgets.js';
import { dbGet, dbAll } from '../db-types.js';

export const reviewRouter = Router();

// POST /api/review - AI code review with SSE streaming
reviewRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { code, labTitle, instructions, courseId, labId, projectId } = req.body;

  if (!code) {
    res.status(400).json({ error: 'code 不能为空' });
    return;
  }

  // Cap code size to prevent context overflow
  let cappedCode = code;
  if (estimateTokens(code) > REVIEW_CODE_TOKEN_CAP) {
    cappedCode = truncateTextToTokens(code, REVIEW_CODE_TOKEN_CAP, '\n\n...(代码已截断)');
  }

  // Build context from lab or project
  let itemContext = '';
  let courseInfo = '';
  if (courseId) {
    const { info } = buildCourseContext(courseId);
    courseInfo = info;
    if (labId) {
      itemContext = await buildLabContext(courseId, labId);
    } else if (projectId) {
      itemContext = await buildProjectContext(courseId, projectId);
    }
  }

  const sse = setupSSERes(res, req);

  const abortCtrl = new AbortController();
  // Detect disconnect via SSE write failures, not req.on('close') which fires prematurely

  const systemPrompt = `你是一位资深的课程讲师和编程教育专家，负责审查学生的代码。请根据实验要求和代码内容，提供详细的审查意见：
- 指出代码中的问题和潜在 bug
- 给出具体的改进建议和代码示例
- 如果代码有亮点，也要表扬
- 使用 Markdown 格式回复，可以包含代码块
- 请使用中文回复

${courseInfo ? `## 课程信息\n${courseInfo}\n\n` : ''}${itemContext ? `## 上下文信息\n${itemContext}\n\n` : ''}实验标题：${labTitle || '未知'}
实验说明：
${instructions || '无'}`;

  try {
    let fullContent = '';

    await sendChatMessage(
      {
        systemPrompt,
        messages: [{ role: 'user', content: `请审查以下代码：\n\n${cappedCode}` }],
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
