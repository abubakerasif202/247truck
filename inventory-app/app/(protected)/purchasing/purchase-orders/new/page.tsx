import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PackageSearch } from 'lucide-react';

import { PurchaseOrderForm } from '@/components/purchasing/purchase-order-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import {
  listPurchaseOrderLocations,
  listPurchaseOrderProducts,
  listSuppliers,
} from '@/lib/purchasing/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

export default async function NewPurchaseOrderPage() {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'purchasing.create_po')) redirect('/purchasing/purchase-orders');

  const supabase = await createServerSupabaseClient();
  const [locations, suppliers, products] = await Promise.all([
    listPurchaseOrderLocations(supabase, access),
    listSuppliers(supabase),
    listPurchaseOrderProducts(supabase),
  ]);

  return (
    <div className="operations-page max-w-5xl domain-purchasing">
      <div>
        <Link href="/purchasing/purchase-orders" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Purchase orders
        </Link>
        <div className="mt-3"><PageHeader domain="purchasing" eyebrow="Purchasing control" title="New purchase order" subtitle="Save a supplier order as a draft before submitting it for Admin approval." /></div>
      </div>

      {suppliers.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No active suppliers yet"
          description="Add an active supplier before creating a purchase order."
        />
      ) : products.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No active products yet"
          description="Add an active inventory product before creating a purchase order."
        />
      ) : (
        <PurchaseOrderForm
          locations={locations}
          suppliers={suppliers}
          products={products}
          fixedLocationId={access.role === 'manager' ? access.locationId ?? undefined : undefined}
        />
      )}
    </div>
  );
}
