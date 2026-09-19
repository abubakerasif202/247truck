import { Skeleton } from '@/components/ui/skeleton';

/** Mirrors PageHeader's shape (eyebrow + title + subtitle) so route loading.tsx
 * files don't shift layout once the real header streams in. */
export function PageHeaderSkeleton() {
  return (
    <header className="operations-header">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-2 h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-48" />
    </header>
  );
}
