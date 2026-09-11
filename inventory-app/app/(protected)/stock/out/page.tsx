import { redirect } from 'next/navigation';

import { stockOutAction } from '@/app/(protected)/stock/actions';
import { StockForm } from '@/components/stock/stock-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getStockFormContext } from '@/lib/inventory/stock-page-data';

export default async function StockOutPage() {
  const access = await getCurrentAccess();
  // Picking a product reveals stock, so the DB-enforced inventory.view is required too.
  if (!hasPermission(access, 'inventory.stock_out') || !hasPermission(access, 'inventory.view')) redirect('/dashboard');
  const ctx = await getStockFormContext();

  return (
    <div className="operations-page max-w-2xl">
      <StockForm mode="out" action={stockOutAction} {...ctx} />
    </div>
  );
}
