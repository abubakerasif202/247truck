import { Skeleton } from '@/components/ui/skeleton';
import { PageHeaderSkeleton } from '@/components/ui/page-header-skeleton';

export default function InventoryLoading() {
  return (
    <div className="operations-page max-w-6xl">
      <PageHeaderSkeleton />
      <Skeleton className="h-16 rounded-xl md:h-[4.5rem]" />
      <Skeleton className="h-4 w-40" />
      <div className="operations-panel hidden overflow-hidden md:block">
        <div className="flex flex-col divide-y divide-border">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-12 rounded-none" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2.5 md:hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
