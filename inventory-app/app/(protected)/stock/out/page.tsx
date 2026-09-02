import { redirect } from 'next/navigation';

import { stockOutAction } from '@/app/(protected)/stock/actions';
import { StockForm } from '@/components/stock/stock-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getStockFormContext } from '@/lib/inventory/stock-page-data';

export default async function StockOutPage() {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.stock_out')) redirect('/dashboard');
  const ctx = await getStockFormContext();

  return (
    <div className="mx-auto w-full max-w-lg p-6">
      <StockForm mode="out" action={stockOutAction} {...ctx} />
    </div>
  );
}
