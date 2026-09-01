import { redirect } from 'next/navigation';

import { StockForm } from '@/components/stock/stock-form';
import { usedTyreIntakeAction } from '@/app/(protected)/stock/actions';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getStockFormContext } from '@/lib/inventory/stock-page-data';

export default async function UsedTyreIntakePage() {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.stock_in')) redirect('/dashboard');
  const ctx = await getStockFormContext();
  return (
    <div className="mx-auto w-full max-w-lg p-6">
      <StockForm mode="used-intake" action={usedTyreIntakeAction} {...ctx} />
    </div>
  );
}
