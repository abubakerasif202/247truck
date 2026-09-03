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
      <PageHeader domain="inventory" eyebrow="Inventory control" title="New product" subtitle="Selling price is one global GST-inclusive value across both branches." />
      <ProductForm />
    </div>
  );
}
