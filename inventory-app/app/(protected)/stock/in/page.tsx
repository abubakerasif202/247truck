import { redirect } from 'next/navigation';

import { StockForm } from '@/components/stock/stock-form';
import { stockInAction } from '@/app/(protected)/stock/actions';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getStockFormContext } from '@/lib/inventory/stock-page-data';

export default async function StockInPage() {
  const access = await getCurrentAccess();
  // Picking a product reveals stock, so the DB-enforced inventory.view is required too.
  if (!hasPermission(access, 'inventory.stock_in') || !hasPermission(access, 'inventory.view')) redirect('/dashboard');
  const ctx = await getStockFormContext();
  return (
    <div className="operations-page max-w-2xl">
      <StockForm mode="in" action={stockInAction} {...ctx} />
    </div>
  );
}
