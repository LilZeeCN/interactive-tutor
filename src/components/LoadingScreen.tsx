import { Loader2 } from 'lucide-react';

interface LoadingScreenProps {
  text?: string;
  className?: string;
}

export function LoadingScreen({ text = '加载中...', className = '' }: LoadingScreenProps) {
  return (
    <div className={`flex h-full items-center justify-center ${className}`}>
      <div className="flex flex-col items-center gap-4 text-white/40">
        <Loader2 className="w-7 h-7 animate-spin" />
        <span className="text-sm">{text}</span>
      </div>
    </div>
  );
}

interface InlineLoaderProps {
  text?: string;
  className?: string;
}

export function InlineLoader({ text = '加载中...', className = '' }: InlineLoaderProps) {
  return (
    <div className={`flex items-center gap-2 text-white/40 ${className}`}>
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-sm">{text}</span>
    </div>
  );
}
