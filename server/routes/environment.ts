import { Router, Request, Response } from 'express';
import { detectAllRuntimes, getSetupCommands } from '../services/environment.js';
import { workspace } from '../services/workspace.js';
import { generateText } from '../services/ai.js';
import { parseJSON } from '../services/parseJSON.js';
import { setupSSERes } from '../helpers/sse.js';
import { asyncHandler } from '../helpers/asyncHandler.js';
import { dbGet, dbAll } from '../db-types.js';

export const environmentRouter = Router();

// GET /:courseId/environment — get course environment info
environmentRouter.get('/:courseId/environment', asyncHandler(async (req: Request, res: Response) => {
  const runtimes = await detectAllRuntimes();
  const targetDir = workspace.getBasePath(req.params.courseId);
  res.json({ runtimes, workspaceDir: targetDir });
}));

// POST /api/courses/:courseId/environment — get setup commands for a runtime
environmentRouter.post('/:courseId/environment', (req: Request, res: Response) => {
  const { runtime } = req.body;
  const validRuntimes = ['python3', 'python', 'node', 'java', 'cpp', 'go', 'rust'];
  if (!runtime) {
    res.status(400).json({ error: 'runtime 不能为空' });
    return;
  }
  if (!validRuntimes.includes(runtime)) {
    res.status(400).json({ error: `不支持的运行时：${runtime}，可选：${validRuntimes.join(', ')}` });
    return;
  }
  const targetDir = workspace.getBasePath(req.params.courseId);
  const setup = getSetupCommands(runtime, targetDir);
  res.json(setup);
});

// POST /api/courses/:courseId/environment/setup — AI-assisted environment setup
environmentRouter.post('/:courseId/environment/setup', asyncHandler(async (req: Request, res: Response) => {
  const { description } = req.body;
  if (!description) {
    res.status(400).json({ error: '描述不能为空' });
    return;
  }

  const runtimes = await detectAllRuntimes();
  const installed = runtimes.filter((r: any) => r.installed).map((r: any) => `${r.name} (${r.version})`);
  const targetDir = workspace.getBasePath(req.params.courseId);

  const sse = setupSSERes(res, req);

  const abortCtrl = new AbortController();
  req.on('close', () => { abortCtrl.abort(); });

  try {
    const system = `你是一位环境配置专家。请根据项目描述和当前系统环境，生成配置命令。

请输出 JSON 格式的配置方案，严格按以下格式：
{
  "description": "环境配置说明",
  "commands": [
    "命令1",
    "命令2"
  ],
  "notes": "注意事项和说明"
}

要求：
1. commands 中的命令必须可以直接在终端执行
2. 如果需要安装依赖，请包含安装命令
3. 优先使用已安装的运行时
4. 包含环境验证命令`;

    const user = `项目描述：${description}
工作目录：${targetDir}
已安装的运行时：
${installed.join('\n')}`;

    const fullText = await generateText(system, user, 4096, abortCtrl.signal);
    if (sse.isDisconnected()) { sse.cleanup(); res.end(); return; }

    const result = parseJSON(fullText);
    sse.sendEvent({ type: 'done', ...result });
  } catch (err: any) {
    if (!sse.isDisconnected()) {
      sse.sendEvent({ type: 'error', error: err?.message || '配置生成失败' });
    }
  }
  sse.cleanup();
  res.end();
}));
