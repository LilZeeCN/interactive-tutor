/**
 * Extracts a plain-text summary from HTML for use in chat context and search.
 */

export function extractHtmlSummary(html: string, maxLen: number = 1000): string {
  // Strip all HTML tags
  let text = html.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");

  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  if (text.length > maxLen) {
    text = text.slice(0, maxLen) + '...';
  }

  return text;
}
