import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PurchaseOrderForm } from '@/components/purchasing/purchase-order-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import {
  listPurchaseOrderLocations,
  listPurchaseOrderProducts,
  listSuppliers,
} from '@/lib/purchasing/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <Link href="/purchasing/purchase-orders" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Purchase orders
        </Link>
        <h1 className="mt-3 text-xl font-semibold">New purchase order</h1>
        <p className="text-sm text-muted-foreground">
          Save a supplier order as a draft before submitting it for Admin approval.
        </p>
      </div>

      {suppliers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          Add an active supplier before creating a purchase order.
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
          Add an active inventory product before creating a purchase order.
        </div>
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
