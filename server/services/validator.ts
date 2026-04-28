const REQUIRED_SECTIONS = [
  { pattern: /目标|要学什么|objective|goal|搞懂/i, label: '学习目标' },
  { pattern: /核心|概念|讲解|理解|原理/i, label: '核心讲解' },
  { pattern: /误区|错误|陷阱|坑|misconception|pitfall/i, label: '常见误区' },
  { pattern: /练习|quiz|check|检查|exercise|practice|练一练/i, label: '练习检验' },
];

export function validateLectureContent(content: string): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!section.pattern.test(content)) missing.push(section.label);
  }
  return { valid: missing.length === 0, missing };
}
