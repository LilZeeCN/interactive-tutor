/**
 * Server-side HTML sanitizer for AI-generated lecture content.
 * Strips dangerous elements before storing in database.
 */

export function sanitizeLectureHtml(rawHtml: string): { html: string; warnings: string[] } {
  const warnings: string[] = [];
  let html = rawHtml;

  // 0. Strip markdown code block wrappers (```html ... ``` or ``` ... ```)
  const codeBlockMatch = html.match(/^[\s\n]*```(?:html|HTML)?\s*\n([\s\S]*?)\n```[\s\n]*$/);
  if (codeBlockMatch) {
    html = codeBlockMatch[1];
  }

  // 1. Remove <script> tags that contain dangerous API calls (fetch/XMLHttpRequest/WebSocket/eval)
  // Keep safe scripts that define interactive functions (changeStep, switchTab, etc.)
  // The iframe sandbox provides isolation — scripts cannot access parent page or external APIs
  const scriptPattern = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let strippedScripts = 0;
  html = html.replace(scriptPattern, (_match, attrs: string, body: string) => {
    // Keep script if it loads KaTeX
    if (/katex/i.test(attrs)) return _match;
    // Remove if it contains dangerous API calls
    if (/\b(fetch|XMLHttpRequest|WebSocket|eval\s*\(|new\s+Function)\s*\(/i.test(body)) {
      strippedScripts++;
      return '';
    }
    // Keep safe interactive scripts
    return _match;
  });
  if (strippedScripts > 0) {
    warnings.push(`移除了 ${strippedScripts} 个包含危险 API 调用的 <script> 标签`);
  }

  // 2. Remove inline event handlers that contain dangerous API calls (fetch/XMLHttpRequest/WebSocket)
  // Keep safe event handlers (onclick, onchange, etc.) for interactive functionality
  // The iframe sandbox provides isolation — no need to strip all handlers
  const eventPattern = /\son([a-z]+)\s*=\s*(['"])([\s\S]*?)\2/gi;
  let strippedEvents = 0;
  html = html.replace(eventPattern, (_match, _eventName: string, _q: string, body: string) => {
    if (/\b(fetch|XMLHttpRequest|WebSocket|eval|Function)\s*\(/i.test(body)) {
      strippedEvents++;
      return ''; // Remove handlers with dangerous API calls
    }
    return _match; // Keep safe handlers
  });
  if (strippedEvents > 0) {
    warnings.push(`移除了 ${strippedEvents} 个包含危险 API 调用的事件处理器`);
  }

  // 3. Remove javascript: URLs in href/src
  const jsUrlPattern = /\s(href|src)\s*=\s*(['"])javascript:[\s\S]*?\2/gi;
  let strippedJsUrls = 0;
  html = html.replace(jsUrlPattern, () => { strippedJsUrls++; return ''; });
  if (strippedJsUrls > 0) {
    warnings.push(`移除了 ${strippedJsUrls} 个 javascript: URL`);
  }

  // 4. Remove fetch/XMLHttpRequest/WebSocket usage in inline scripts that survived
  const dangerousApis = /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/g;
  let strippedApis = 0;
  html = html.replace(dangerousApis, () => { strippedApis++; return '/* removed */'; });
  if (strippedApis > 0) {
    warnings.push(`移除了 ${strippedApis} 个外部 API 调用`);
  }

  return { html, warnings };
}
