import { redirect } from 'next/navigation';

import { ProductForm } from '@/components/inventory/product-form';
import { getCurrentAccess } from '@/lib/auth/access';

export default async function NewProductPage() {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    redirect('/inventory');
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold">New product</h1>
        <p className="text-sm text-muted-foreground">
          Selling price is one global GST-inclusive value across both branches.
        </p>
      </header>
      <ProductForm />
    </div>
  );
}
