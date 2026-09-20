import { Skeleton } from '@/components/ui/skeleton';
import { PageHeaderSkeleton } from '@/components/ui/page-header-skeleton';

export default function PurchaseOrdersLoading() {
  return (
    <div className="operations-page max-w-6xl">
      <PageHeaderSkeleton />
      <Skeleton className="h-24 rounded-lg sm:h-20" />
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-none" />
        ))}
      </div>
    </div>
  );
}
