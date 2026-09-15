import { redirect } from 'next/navigation';

import { ProductForm } from '@/components/inventory/product-form';
import { getCurrentAccess } from '@/lib/auth/access';
import { PageHeader } from '@/components/ui/page-header';

export default async function NewProductPage() {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    redirect('/inventory');
  }

  return (
    <div className="operations-page max-w-xl domain-inventory">
      <PageHeader domain="inventory" eyebrow="Inventory control" title="New product" subtitle="Create a zero-stock product for the active business workspace. Opening stock is recorded separately." />
      <ProductForm />
    </div>
  );
}
