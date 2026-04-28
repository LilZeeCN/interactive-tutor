/**
 * Validates AI-generated HTML lecture content meets structural requirements.
 */

export function validateLectureHtml(html: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for basic HTML structure
  const hasDoctype = /<!DOCTYPE\s+html/i.test(html);
  const hasHtmlTag = /<html[\s>]/i.test(html);
  const hasBodyTag = /<body[\s>]/i.test(html);
  const hasContentDiv = /<div[^>]*>[\s\S]{100,}/i.test(html);

  if (!hasDoctype && !hasHtmlTag) {
    errors.push('缺少 <!DOCTYPE html> 或 <html> 标签');
  }

  if (!hasBodyTag && !hasContentDiv) {
    errors.push('缺少 <body> 或有内容的 <div> 标签');
  }

  // Check minimum content length (strip tags to get text)
  const textContent = html.replace(/<[^>]+>/g, '').trim();
  if (textContent.length < 300) {
    errors.push(`内容过短（仅 ${textContent.length} 字符，至少需要 300）`);
  }

  // Check for Chinese text
  if (!/[\u4e00-\u9fff]/.test(textContent)) {
    errors.push('内容中未检测到中文文字');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
