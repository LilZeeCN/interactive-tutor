import { cn } from '../../lib/utils';

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn('animate-pulse bg-white/[0.06] rounded-lg', className)} style={style} />
  );
}

export function SkeletonLine({ width = '100%', className }: { width?: string; className?: string }) {
  return <Skeleton className={cn('h-4', className)} style={{ width }} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2.5', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4 rounded"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-white/[0.06] p-5 space-y-4', className)}>
      <Skeleton className="h-10 w-10 rounded-xl" />
      <Skeleton className="h-5 w-3/4" />
      <SkeletonText lines={2} />
    </div>
  );
}

export function SkeletonSidebar() {
  return (
    <div className="p-3 space-y-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 rounded-lg" />
      ))}
    </div>
  );
}

export function SkeletonArticle({ className }: { className?: string }) {
  return (
    <div className={cn('max-w-3xl mx-auto px-6 py-8 space-y-6', className)}>
      <Skeleton className="h-8 w-2/3" />
      <SkeletonText lines={4} />
      <Skeleton className="h-40 w-full rounded-xl" />
      <SkeletonText lines={3} />
      <Skeleton className="h-24 w-full rounded-xl" />
      <SkeletonText lines={5} />
    </div>
  );
}
