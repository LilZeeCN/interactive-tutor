import { useState, useRef, useCallback, useEffect } from 'react';

interface ResizablePanelProps {
  top: React.ReactNode;
  bottom: React.ReactNode;
  initialRatio?: number; // 0-1, top panel percentage (default 0.65)
  minTop?: number; // minimum top height in px
  minBottom?: number; // minimum bottom height in px
  className?: string;
}

export function ResizablePanel({
  top,
  bottom,
  initialRatio = 0.65,
  minTop = 120,
  minBottom = 100,
  className,
}: ResizablePanelProps) {
  const [ratio, setRatio] = useState(initialRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const startRatio = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startHeight.current = containerRef.current?.clientHeight || 0;
    startRatio.current = ratio;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [ratio]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientY - startY.current;
      const newRatio = startRatio.current + delta / startHeight.current;
      const minRatio = minTop / startHeight.current;
      const maxRatio = 1 - minBottom / startHeight.current;
      setRatio(Math.min(maxRatio, Math.max(minRatio, newRatio)));
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [minTop, minBottom]);

  return (
    <div ref={containerRef} className={`flex flex-col ${className || ''}`}>
      <div style={{ flex: `0 0 ${ratio * 100}%`, minHeight: minTop }} className="min-h-0 overflow-hidden">
        {top}
      </div>
      <div
        onMouseDown={onMouseDown}
        className="h-1 shrink-0 cursor-row-resize hover:bg-indigo-500/40 active:bg-indigo-500/60 transition-colors relative group"
      >
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center">
          <div className="w-8 h-1 rounded-full bg-white/20 group-hover:bg-white/40 transition-colors" />
        </div>
      </div>
      <div style={{ flex: `0 0 ${(1 - ratio) * 100}%`, minHeight: minBottom }} className="min-h-0 overflow-hidden">
        {bottom}
      </div>
    </div>
  );
}
