import { useRef, useEffect, useMemo, memo } from 'react';
import { cn } from '../lib/utils';

interface HtmlLectureRendererProps {
  html: string;
  className?: string;
}

const HtmlLectureRenderer = memo(function HtmlLectureRenderer({ html, className }: HtmlLectureRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Build srcdoc with KaTeX injection + auto-resize
  const srcdoc = useMemo(() => {
    // KaTeX CSS + JS (injected before </body>)
    const katexInject = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/katex.min.js"><\/script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.44/dist/contrib/auto-render.min.js"
  onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\\\[',right:'\\\\]',display:true},{left:'\\\\(',right:'\\\\)',display:false}]});"><\/script>`;

    // Auto-resize script
    const resizeScript = `
<script>
  function sendHeight() {
    try {
      var h = document.documentElement.scrollHeight;
      if (window.parent && h > 0) {
        window.parent.postMessage({ type: 'lecture-height', height: h }, '*');
      }
    } catch(e) {}
  }
  window.addEventListener('load', sendHeight);
  window.addEventListener('resize', sendHeight);
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(sendHeight);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }
<\/script>`;

    let modified = html;
    if (modified.includes('</body>')) {
      modified = modified.replace('</body>', katexInject + resizeScript + '</body>');
    } else {
      modified = katexInject + resizeScript + modified;
    }

    return modified;
  }, [html]);

  // Listen for height updates from iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === 'lecture-height' && iframeRef.current) {
        const h = Math.max(Number(event.data.height), 400);
        iframeRef.current.style.height = `${h}px`;
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
      className={cn('w-full border-0 rounded-lg', className)}
      style={{ minHeight: '600px' }}
      title="交互式讲义内容"
    />
  );
});

export { HtmlLectureRenderer };
