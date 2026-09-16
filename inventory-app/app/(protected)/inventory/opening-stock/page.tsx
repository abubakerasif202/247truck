import { redirect } from 'next/navigation';

import { addOpeningStockAction } from '@/app/(protected)/inventory/opening-stock/actions';
import { OpeningStockForm } from '@/components/inventory/opening-stock-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { getStockFormContext } from '@/lib/inventory/stock-page-data';

export default async function OpeningStockPage() {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') redirect('/inventory');
  const context = await getStockFormContext(true);
  return <div className="operations-page max-w-2xl domain-inventory"><OpeningStockForm action={addOpeningStockAction} rows={context.rows} locationIds={context.locationIds} /></div>;
}
