/**
 * Token estimation and truncation utilities for AI API calls.
 * No external dependencies — uses character-based approximation.
 */

// CJK Unicode ranges
const CJK_RANGES: Array<[number, number]> = [
  [0x4E00, 0x9FFF],   // CJK Unified Ideographs
  [0x3400, 0x4DBF],   // CJK Extension A
  [0x3000, 0x303F],   // CJK Symbols and Punctuation
  [0xFF00, 0xFFEF],   // Fullwidth Forms
  [0x2E80, 0x2FDF],   // CJK Radicals
  [0xF900, 0xFAFF],   // CJK Compatibility Ideographs
  [0x2F00, 0x2FDF],   // Kangxi Radicals
];

function isCJK(char: string): boolean {
  const code = char.codePointAt(0)!;
  return CJK_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/**
 * Estimate token count for mixed CJK/Latin text.
 * Conservative: slightly overestimates to stay within context limits.
 * - CJK: ~1 token per 1.5 characters
 * - Other: ~1 token per 4 characters
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (isCJK(char)) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk / 1.5) + Math.ceil(other / 4);
}

/**
 * Truncate text to fit within maxTokens, appending a suffix if truncated.
 */
export function truncateTextToTokens(
  text: string,
  maxTokens: number,
  suffix: string = '\n...(内容已截断)'
): string {
  const tokens = estimateTokens(text);
  if (tokens <= maxTokens) return text;

  // Estimate characters to keep: be conservative, aim for maxTokens - suffix tokens
  const suffixTokens = estimateTokens(suffix);
  const targetTokens = maxTokens - suffixTokens;

  // Approximate: assume ~2.5 chars per token (mixed average)
  const approxChars = Math.floor(targetTokens * 2.5);
  const truncated = text.slice(0, approxChars);

  // Verify and adjust if still over
  if (estimateTokens(truncated + suffix) > maxTokens) {
    // Binary search for the right cutoff
    let lo = 0;
    let hi = approxChars;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (estimateTokens(text.slice(0, mid) + suffix) <= maxTokens) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return text.slice(0, lo) + suffix;
  }

  return truncated + suffix;
}

/**
 * Truncate chat messages to fit within a token budget.
 * Strategy: keep the most recent messages, drop oldest first.
 * Individual messages exceeding perMessageCap are truncated in place.
 * Returns a new array (does not mutate input).
 */
export function truncateMessages(
  messages: Array<{ role: string; content: string }>,
  budgetTokens: number,
  perMessageCap: number
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [];
  let usedTokens = 0;

  // Iterate from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    let content = msg.content;

    const msgTokens = estimateTokens(content);

    // Truncate individual message if it exceeds per-message cap
    if (msgTokens > perMessageCap) {
      content = truncateTextToTokens(content, perMessageCap);
    }

    const cappedTokens = estimateTokens(content);

    if (usedTokens + cappedTokens > budgetTokens) {
      break;
    }

    result.unshift({ role: msg.role, content });
    usedTokens += cappedTokens;
  }

  // Guarantee at least the newest message is included (even if over budget),
  // to avoid sending an empty messages array to the API.
  if (result.length === 0 && messages.length > 0) {
    const last = messages[messages.length - 1];
    let content = last.content;
    if (estimateTokens(content) > perMessageCap) {
      content = truncateTextToTokens(content, perMessageCap);
    }
    return [{ role: last.role, content }];
  }

  return result;
}
