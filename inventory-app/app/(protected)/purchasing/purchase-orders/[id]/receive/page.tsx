import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ReceivePurchaseOrderForm } from '@/components/purchasing/receive-purchase-order-form';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { getReceivablePurchaseOrder } from '@/lib/purchasing/queries';
import type { PurchaseOrderStatus } from '@/lib/purchasing/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';

function statusLabel(status: PurchaseOrderStatus): string {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function ReceivePurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'purchasing.view')) redirect('/dashboard');

  const supabase = await createServerSupabaseClient();
  const purchaseOrder = await getReceivablePurchaseOrder(supabase, access, id);
  if (!purchaseOrder) notFound();

  const hasOutstanding = purchaseOrder.lines.some((line) => line.outstandingQuantity > 0);

  return (
    <div className="operations-page max-w-5xl domain-receiving">
      <Link
        href={`/purchasing/purchase-orders/${purchaseOrder.id}`}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← {purchaseOrder.poNumber}
      </Link>

      <PageHeader domain="receiving" eyebrow="Goods receiving" title={<span className="flex flex-wrap items-center gap-2">Receive stock<StatusBadge status={purchaseOrder.status}>{statusLabel(purchaseOrder.status)}</StatusBadge></span>} subtitle={`${purchaseOrder.poNumber} · ${purchaseOrder.supplierName} · ${purchaseOrder.locationCode}`} />

      {!purchaseOrder.canReceive ? (
        <section className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          {!hasOutstanding
            ? 'All purchase order items have already been received.'
            : `This purchase order cannot be received while it is ${statusLabel(purchaseOrder.status).toLowerCase()}.`}
        </section>
      ) : (
        <section className="form-surface grid gap-5 rounded-lg border border-border p-4 sm:p-6">
          <div>
            <h2 className="text-base font-semibold">Receipt details</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the quantity arriving now. Leave rows at zero when they are not part of this delivery.
            </p>
          </div>
          <ReceivePurchaseOrderForm purchaseOrder={purchaseOrder} />
        </section>
      )}
    </div>
  );
}
