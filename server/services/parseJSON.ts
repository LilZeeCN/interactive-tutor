/**
 * Robust JSON parser for AI-generated text.
 * Tries: direct parse → markdown code block → balanced bracket/brace extraction.
 */

/**
 * Extract the first balanced JSON structure (array or object) from text.
 * Uses a bracket-counting approach instead of greedy regex to avoid
 * matching from first `[` to last `]` across unrelated content.
 */
function extractBalancedJSON(text: string, openChar: string, closeChar: string): string | null {
  const start = text.indexOf(openChar);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function parseJSON(text: string): any {
  if (!text || text.trim().length === 0) {
    throw new Error('Empty AI response');
  }

  // 1. Direct parse
  try { return JSON.parse(text); } catch {}

  // 2. Extract from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch {}
  }

  // 3. Extract balanced array
  const arrStr = extractBalancedJSON(text, '[', ']');
  if (arrStr) {
    try { return JSON.parse(arrStr); } catch {}
  }

  // 4. Extract balanced object
  const objStr = extractBalancedJSON(text, '{', '}');
  if (objStr) {
    try { return JSON.parse(objStr); } catch {}
  }

  // 5. Try to fix truncated JSON — find last valid object/array boundary
  const fixed = tryFixTruncatedJSON(text);
  if (fixed !== null) return fixed;

  throw new Error('Could not parse JSON from AI response');
}

/**
 * Attempt to repair truncated JSON by closing open brackets/braces.
 * Handles cases where AI output was cut off mid-response due to max_tokens.
 */
function tryFixTruncatedJSON(text: string): any {
  // Extract the raw JSON region first
  let jsonText: string | null = null;

  // Try code block
  const cbMatch = text.match(/```(?:json)?\s*([\s\S]*)/);
  if (cbMatch) jsonText = cbMatch[1].trimEnd();
  if (!jsonText) jsonText = text.trim();

  // Find the start of JSON
  const objStart = jsonText.indexOf('{');
  const arrStart = jsonText.indexOf('[');
  if (objStart === -1 && arrStart === -1) return null;

  let start: number;
  let openCh: string, closeCh: string;
  if (objStart === -1) { start = arrStart; openCh = '['; closeCh = ']'; }
  else if (arrStart === -1) { start = objStart; openCh = '{'; closeCh = '}'; }
  else { start = Math.min(objStart, arrStart); openCh = start === arrStart ? '[' : '{'; closeCh = start === arrStart ? ']' : '}'; }

  const sliced = jsonText.slice(start);

  // Try adding closing brackets
  const fixes = openCh === '['
    ? [sliced + ']', sliced + '}}]', sliced + '}]', sliced + '"]']
    : [sliced + '}', sliced + '}}', sliced + '"}]', sliced + ']'];

  for (const candidate of fixes) {
    try { return JSON.parse(candidate); } catch {}
  }

  // More aggressive: count open brackets and close them
  let depth = 0;
  let inStr = false;
  let esc = false;
  let lastValidIdx = sliced.length;

  for (let i = 0; i < sliced.length; i++) {
    const ch = sliced[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === openCh || ch === '{' || ch === '[') depth++;
    else if (ch === closeCh || ch === '}' || ch === ']') {
      depth--;
      if (depth <= 0) { lastValidIdx = i + 1; break; }
    }
  }

  // If still unbalanced, try closing the string and brackets
  let attempt = sliced.slice(0, lastValidIdx);
  if (inStr) attempt += '"';
  // Count remaining open brackets
  let openCount = 0;
  inStr = false; esc = false;
  for (let i = 0; i < attempt.length; i++) {
    const ch = attempt[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') openCount++;
    else if (ch === '}' || ch === ']') openCount--;
  }
  for (let i = 0; i < openCount; i++) attempt += (openCh === '{' ? '}' : ']');

  try { return JSON.parse(attempt); } catch {}

  return null;
}

/**
 * Safe JSON parser for DB-stored text fields.
 * Returns fallback instead of throwing on corrupt data.
 */
export function safeJSONParse(text: string | null | undefined, fallback: any = null): any {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}
