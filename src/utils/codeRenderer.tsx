import { useState, useCallback } from 'react';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

/**
 * Custom components for react-markdown v10.
 *
 * react-markdown v10 renders fenced code as <pre><code class="language-xxx">.
 * SyntaxHighlighter also renders <pre><code>, causing double nesting.
 * We override `pre` to pass through children and override `code` to use SyntaxHighlighter
 * with PreTag="div" to avoid the nesting issue.
 *
 * Exported as a module-level constant so the object reference is stable across renders,
 * preventing unnecessary ReactMarkdown re-renders.
 */

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-1 text-xs rounded-md bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
};

const codeComponent = ({ className, children, ...props }: any) => {
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1].toLowerCase() : '';

  if (lang) {
    const codeText = String(children).replace(/\n$/, '');
    return (
      <div className="relative group">
        <CopyButton text={codeText} />
        <SyntaxHighlighter
          style={vscDarkPlus as any}
          language={lang}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: '0.75rem',
            border: '1px solid rgba(255,255,255,0.1)',
            background: '#0A0A0A',
          }}
        >
          {codeText}
        </SyntaxHighlighter>
      </div>
    );
  }

  return <code className={className} {...props}>{children}</code>;
};

export const markdownComponents = {
  pre({ children }: any) {
    const child = Array.isArray(children) ? children[0] : children;
    const className = child?.props?.className || '';
    if (/language-\w+/.test(className)) {
      return <>{children}</>;
    }
    return (
      <pre className="relative overflow-x-auto rounded-xl border border-white/10 bg-[#0A0A0A] p-4 text-sm leading-relaxed [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
        {children}
      </pre>
    );
  },
  code: codeComponent,
  // Style <details>/<summary> elements for collapsible sections
  details({ children, ...props }: any) {
    return (
      <details
        {...props}
        className="my-2 rounded-lg border border-white/10 bg-white/[0.02] group-open:border-white/20 transition-colors"
      >
        {children}
      </details>
    );
  },
  summary({ children, ...props }: any) {
    return (
      <summary
        {...props}
        className="cursor-pointer px-4 py-2.5 text-sm text-white/60 hover:text-white/80 transition-colors select-none [&::-webkit-details-marker]:hidden list-none"
      >
        <span className="mr-1.5">▸</span>
        {children}
      </summary>
    );
  },
};

/** @deprecated Use `markdownComponents` directly instead */
export function createMarkdownComponents() {
  return markdownComponents;
}
