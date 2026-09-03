import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { PurchaseOrderActions } from '@/components/purchasing/purchase-order-actions';
import { PurchaseOrderForm } from '@/components/purchasing/purchase-order-form';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { formatAud } from '@/lib/format';
import {
  getPurchaseOrderDetail,
  listPurchaseOrderLocations,
  listPurchaseOrderProducts,
  listSuppliers,
} from '@/lib/purchasing/queries';
import type { PurchaseOrderStatus } from '@/lib/purchasing/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';

function statusLabel(status: PurchaseOrderStatus): string {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default async function PurchaseOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; received?: string }>;
}) {
  const { id } = await params;
  const { edit, received } = await searchParams;
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'purchasing.view')) redirect('/dashboard');

  const supabase = await createServerSupabaseClient();
  const purchaseOrder = await getPurchaseOrderDetail(supabase, access, id);
  if (!purchaseOrder) notFound();

  const wantsEdit = edit === '1' && purchaseOrder.actions.canEdit;
  const hasVisibleCosts = purchaseOrder.lines.every((line) => line.unitCost !== null);

  if (wantsEdit && hasVisibleCosts) {
    const [locations, suppliers, products] = await Promise.all([
      listPurchaseOrderLocations(supabase, access),
      listSuppliers(supabase),
      listPurchaseOrderProducts(supabase),
    ]);

    return (
      <div className="operations-page max-w-5xl domain-purchasing">
        <div>
          <Link href={`/purchasing/purchase-orders/${id}`} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            ← {purchaseOrder.poNumber}
          </Link>
          <div className="mt-3"><PageHeader domain="purchasing" eyebrow="Purchasing control" title="Edit purchase order draft" subtitle="Location and PO number stay fixed. Saving replaces the editable draft lines atomically." /></div>
        </div>
        <PurchaseOrderForm
          locations={locations}
          suppliers={suppliers}
          products={products}
          fixedLocationId={purchaseOrder.locationId}
          purchaseOrder={{
            id: purchaseOrder.id,
            supplierId: purchaseOrder.supplierId,
            supplierReference: purchaseOrder.supplierReference,
            notes: purchaseOrder.notes,
            lines: purchaseOrder.lines.map((line) => ({
              productId: line.productId,
              orderedQuantity: line.orderedQuantity,
              unitCost: line.unitCost as number,
              notes: line.notes,
            })),
          }}
        />
      </div>
    );
  }

  const total = hasVisibleCosts
    ? purchaseOrder.lines.reduce(
        (sum, line) => sum + line.orderedQuantity * (line.unitCost ?? 0),
        0,
      )
    : null;

  return (
    <div className="operations-page max-w-5xl domain-purchasing">
      <Link href="/purchasing/purchase-orders" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← Purchase orders
      </Link>

      <PageHeader domain="purchasing" eyebrow="Purchase order" title={<span className="flex flex-wrap items-center gap-2">{purchaseOrder.poNumber}<StatusBadge status={purchaseOrder.status}>{statusLabel(purchaseOrder.status)}</StatusBadge></span>} subtitle={`${purchaseOrder.supplierName} · ${purchaseOrder.locationCode}`} actions={<PurchaseOrderActions
          purchaseOrderId={purchaseOrder.id}
          flags={purchaseOrder.actions}
          hasOutstanding={purchaseOrder.lines.some(
            (line) => line.orderedQuantity > line.receivedQuantity,
          )}
        />} />

      {received === '1' ? (
        <div role="status" className="rounded-lg border border-success/30 bg-success-soft p-4 text-sm font-medium text-success">
          Stock received successfully.
        </div>
      ) : null}

      {edit === '1' && purchaseOrder.actions.canEdit && !hasVisibleCosts ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          Stored unit costs are hidden for your account, so this existing draft cannot be safely pre-filled for editing. Ask an Admin or a user with cost-view permission to revise it.
        </div>
      ) : null}

      <section className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Supplier reference</p><p className="mt-1 text-sm font-medium">{purchaseOrder.supplierReference ?? '—'}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Ordered total</p><p className="mt-1 text-sm font-medium">{total === null ? '—' : formatAud(total)}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Created</p><p className="mt-1 text-sm font-medium">{dateTime(purchaseOrder.createdAt)}</p></div>
        <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Outstanding units</p><p className="mt-1 text-sm font-medium">{purchaseOrder.lines.reduce((sum, line) => sum + Math.max(0, line.orderedQuantity - line.receivedQuantity), 0)}</p></div>
      </section>

      {purchaseOrder.notes ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{purchaseOrder.notes}</p>
        </section>
      ) : null}

      {purchaseOrder.rejectionReason ? (
        <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h2 className="text-sm font-semibold text-destructive">Rejection reason</h2>
          <p className="mt-2 text-sm">{purchaseOrder.rejectionReason}</p>
        </section>
      ) : null}

      {purchaseOrder.cancellationReason ? (
        <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h2 className="text-sm font-semibold text-destructive">Cancellation reason</h2>
          <p className="mt-2 text-sm">{purchaseOrder.cancellationReason}</p>
        </section>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">Order lines</h2>
        <div className="operations-panel hidden overflow-x-auto md:block">
          <table className="operations-table w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Supplier SKU</th>
                <th className="px-4 py-3 text-right font-medium">Ordered</th>
                <th className="px-4 py-3 text-right font-medium">Received</th>
                <th className="px-4 py-3 text-right font-medium">Unit cost</th>
              </tr>
            </thead>
            <tbody>
              {purchaseOrder.lines.map((line) => (
                <tr key={line.id} className="border-t border-border">
                  <td className="px-4 py-3"><p className="font-medium">{line.productName}</p>{line.notes ? <p className="text-xs text-muted-foreground">{line.notes}</p> : null}</td>
                  <td className="px-4 py-3">{line.supplierSku ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{line.orderedQuantity}</td>
                  <td className="px-4 py-3 text-right">{line.receivedQuantity}</td>
                  <td className="px-4 py-3 text-right">{line.unitCost === null ? '—' : formatAud(line.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 md:hidden">
          {purchaseOrder.lines.map((line) => (
            <div key={line.id} className="grid gap-2 rounded-lg border border-border bg-card p-4 text-sm">
              <div><p className="font-medium">{line.productName}</p><p className="text-xs text-muted-foreground">{line.supplierSku ?? 'No supplier SKU'}</p></div>
              <div className="grid grid-cols-3 gap-2">
                <div><p className="text-xs text-muted-foreground">Ordered</p><p>{line.orderedQuantity}</p></div>
                <div><p className="text-xs text-muted-foreground">Received</p><p>{line.receivedQuantity}</p></div>
                <div><p className="text-xs text-muted-foreground">Unit cost</p><p>{line.unitCost === null ? '—' : formatAud(line.unitCost)}</p></div>
              </div>
              {line.notes ? <p className="text-muted-foreground">{line.notes}</p> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Status history</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <div><dt className="text-muted-foreground">Created</dt><dd>{dateTime(purchaseOrder.createdAt)}</dd></div>
          <div><dt className="text-muted-foreground">Submitted</dt><dd>{dateTime(purchaseOrder.submittedAt)}</dd></div>
          <div><dt className="text-muted-foreground">Approved</dt><dd>{dateTime(purchaseOrder.approvedAt)}</dd></div>
          <div><dt className="text-muted-foreground">Rejected</dt><dd>{dateTime(purchaseOrder.rejectedAt)}</dd></div>
          <div><dt className="text-muted-foreground">Sent</dt><dd>{dateTime(purchaseOrder.sentAt)}</dd></div>
        </dl>
      </section>
    </div>
  );
}
