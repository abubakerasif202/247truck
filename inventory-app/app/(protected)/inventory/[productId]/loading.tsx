import { Skeleton } from '@/components/ui/skeleton';
import { PageHeaderSkeleton } from '@/components/ui/page-header-skeleton';

export default function ProductDetailLoading() {
  return (
    <div className="operations-page max-w-5xl">
      <Skeleton className="h-4 w-24" />
      <PageHeaderSkeleton />
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
