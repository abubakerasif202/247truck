import { Skeleton } from '@/components/ui/skeleton';
import { PageHeaderSkeleton } from '@/components/ui/page-header-skeleton';

export default function InvoicesLoading() {
  return (
    <div className="operations-page max-w-6xl">
      <PageHeaderSkeleton />
      <Skeleton className="h-40 rounded-xl sm:h-24 lg:h-20" />
      <div className="grid gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
