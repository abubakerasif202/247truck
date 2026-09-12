import { redirect } from 'next/navigation';

import { StockForm } from '@/components/stock/stock-form';
import { adjustStockAction } from '@/app/(protected)/stock/actions';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getStockFormContext } from '@/lib/inventory/stock-page-data';

export default async function StockAdjustPage() {
  const access = await getCurrentAccess();
  // Picking a product reveals stock, so the DB-enforced inventory.view is required too.
  if (!hasPermission(access, 'inventory.adjust') || !hasPermission(access, 'inventory.view')) redirect('/dashboard');
  const ctx = await getStockFormContext();
  return (
    <div className="mx-auto w-full max-w-lg p-6">
      <StockForm mode="adjust" action={adjustStockAction} {...ctx} />
    </div>
  );
}
