import { Loader2 } from 'lucide-react';

interface ReconnectingIndicatorProps {
  show: boolean;
}

export function ReconnectingIndicator({ show }: ReconnectingIndicatorProps) {
  if (!show) return null;

  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 z-50 mt-3">
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/90 text-amber-950 text-sm font-medium shadow-lg backdrop-blur-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>重新连接中...</span>
      </div>
    </div>
  );
}
