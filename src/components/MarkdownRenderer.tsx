import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { sanitizePlugin } from '../lib/sanitize';
import { markdownComponents } from '../utils/codeRenderer.tsx';

// Stable plugin arrays — created once, reused across all instances
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex, sanitizePlugin];

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Memoized Markdown renderer with stable plugin references.
 * Prevents ReactMarkdown from re-creating the remark/rehype plugin chain
 * on every parent render, which is expensive for long conversations.
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
});
