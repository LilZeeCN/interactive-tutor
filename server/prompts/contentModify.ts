export function buildLabModifyPrompt(params: {
  labTitle: string;
  labTopic: string;
  currentFiles: Record<string, string>;
  instruction: string;
  labInstructions?: string;
  testCases?: string;
  courseInfo?: string;
}): { system: string; user: string } {
  const { labTitle, labTopic, currentFiles, instruction, labInstructions, testCases, courseInfo } = params;

  const fileList = Object.keys(currentFiles).map(f => `- ${f}`).join('\n');
  const fileContents = Object.entries(currentFiles)
    .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  const courseSection = courseInfo
    ? `\n\n## 课程背景\n${courseInfo}`
    : '';

  const system = `你是一位资深的编程教育导师。你正在帮助学生修改实验代码。

实验标题：${labTitle}
关联主题：${labTopic}${courseSection}
${labInstructions ? `\n实验说明：\n${labInstructions}` : ''}${testCases ? `\n\n测试用例（修改后的代码应能通过这些测试）：\n${testCases}` : ''}

请只输出被修改或新增的文件，未修改的文件不要输出。严格按以下 JSON 格式输出：
{
  "files": {
    "文件路径": "文件完整内容"
  },
  "summary": "修改说明（一句话）"
}

注意：
1. files 中只包含被修改或新增的文件，未修改的文件不要输出
2. 如果需要新增文件，直接在 files 中添加
3. 所有文件内容必须完整，不要用 "// ..." 或 "# ..." 省略
4. 修改后的代码应能通过已有的测试用例
5. 代码中保留或补充中文注释帮助学生理解
6. 修改说明简要概括你做了什么修改`;

  const user = `当前文件列表：
${fileList}

当前文件内容：
${fileContents}

学生要求：${instruction}`;

  return { system, user };
}

export function buildProjectModifyPrompt(params: {
  projectTitle: string;
  projectDesc: string;
  currentFiles: Record<string, string>;
  instruction: string;
  milestones?: string;
  courseInfo?: string;
}): { system: string; user: string } {
  const { projectTitle, projectDesc, currentFiles, instruction, milestones, courseInfo } = params;

  const fileList = Object.keys(currentFiles).map(f => `- ${f}`).join('\n');
  const fileContents = Object.entries(currentFiles)
    .map(([path, content]) => `### ${path}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  const courseSection = courseInfo
    ? `\n\n## 课程背景\n${courseInfo}`
    : '';

  const system = `你是一位资深的编程教育导师。你正在帮助学生修改项目代码。

项目标题：${projectTitle}
项目描述：${projectDesc}${courseSection}${milestones ? `\n\n项目里程碑（修改应符合里程碑的验收标准）：\n${milestones}` : ''}

请只输出被修改或新增的文件，未修改的文件不要输出。严格按以下 JSON 格式输出：
{
  "files": {
    "文件路径": "文件完整内容"
  },
  "summary": "修改说明（一句话）"
}

注意：
1. files 中只包含被修改或新增的文件，未修改的文件不要输出
2. 所有文件内容必须完整，不要用 "// ..." 或 "# ..." 省略
3. 如果需要新增文件，直接在 files 中添加
4. 修改后的代码应符合项目里程碑的验收标准
5. 代码中保留或补充中文注释帮助学生理解`;

  const user = `当前文件列表：
${fileList}

当前文件内容：
${fileContents}

学生要求：${instruction}`;

  return { system, user };
}
