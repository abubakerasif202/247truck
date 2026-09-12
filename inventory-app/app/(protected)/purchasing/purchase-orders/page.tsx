import Link from 'next/link';
import { redirect } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { formatAud } from '@/lib/format';
import { normalizeListCursor } from '@/lib/listing/cursor';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import {
  listPurchaseOrders,
  listSuppliers,
} from '@/lib/purchasing/queries';
import type { PurchaseOrderStatus } from '@/lib/purchasing/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

const statuses: PurchaseOrderStatus[] = [
  'draft',
  'submitted',
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
  'rejected',
  'cancelled',
];

function parseStatus(value: string | undefined): PurchaseOrderStatus | null {
  return statuses.includes(value as PurchaseOrderStatus)
    ? (value as PurchaseOrderStatus)
    : null;
}

function statusLabel(status: PurchaseOrderStatus): string {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; supplier?: string; cursor?: string }>;
}) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'purchasing.view')) redirect('/dashboard');

  const params = await searchParams;
  const status = parseStatus(params.status);
  const supplierId = params.supplier?.trim() || null;
  const cursor = normalizeListCursor(params.cursor?.trim());
  const scope = await getCurrentLocationScope(access);
  const supabase = await createServerSupabaseClient();
  const [page, suppliers] = await Promise.all([
    listPurchaseOrders(supabase, access, { scope, status, supplierId, cursor }),
    listSuppliers(supabase),
  ]);
  const purchaseOrders = page.rows;
  const canCreate = hasPermission(access, 'purchasing.create_po');
  const filterQuery = `${status ? `status=${status}&` : ''}${supplierId ? `supplier=${supplierId}&` : ''}`;

  return (
    <div className="operations-page max-w-6xl domain-purchasing">
      <PageHeader domain="purchasing" eyebrow="Purchasing control" title="Purchase orders" subtitle="Draft, approval and supplier ordering for the current location scope." actions={canCreate ? (
          <Link href="/purchasing/purchase-orders/new" prefetch={false} className={cn(buttonVariants(), 'h-11')}>
            New purchase order
          </Link>
        ) : null} />

      <form className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]" method="get" noValidate>
        <div className="grid gap-1">
          <label htmlFor="po-status-filter" className="text-sm font-medium">Status</label>
          <select
            id="po-status-filter"
            name="status"
            defaultValue={status ?? ''}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All statuses</option>
            {statuses.map((item) => (
              <option key={item} value={item}>{statusLabel(item)}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="po-supplier-filter" className="text-sm font-medium">Supplier</label>
          <select
            id="po-supplier-filter"
            name="supplier"
            defaultValue={supplierId ?? ''}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All suppliers</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
        </div>
        <button className="h-10 self-end rounded-md border border-input px-4 text-sm font-medium" type="submit">
          Filter
        </button>
      </form>

      {purchaseOrders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {cursor ? 'No more purchase orders match this view.' : 'No purchase orders match this view.'}
        </div>
      ) : (
        <>
          <div className="operations-panel hidden overflow-x-auto md:block">
            <table className="operations-table w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">PO Number</th>
                  <th className="px-4 py-3 font-medium">Supplier</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 text-right font-medium">Ordered Total</th>
                  <th className="px-4 py-3 text-right font-medium">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((po) => (
                  <tr key={po.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        className="underline-offset-4 hover:underline"
                        href={`/purchasing/purchase-orders/${po.id}`}
                        prefetch={false}
                      >
                        {po.poNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{po.supplierName}</td>
                    <td className="px-4 py-3">{po.locationCode}</td>
                    <td className="px-4 py-3"><StatusBadge status={po.status}>{statusLabel(po.status)}</StatusBadge></td>
                    <td className="px-4 py-3">{dateLabel(po.createdAt)}</td>
                    <td className="px-4 py-3 text-right">{po.orderedTotal === null ? '—' : formatAud(po.orderedTotal)}</td>
                    <td className="px-4 py-3 text-right">{po.outstandingQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {purchaseOrders.map((po) => (
              <Link
                key={po.id}
                href={`/purchasing/purchase-orders/${po.id}`}
                prefetch={false}
                className="grid gap-3 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{po.poNumber}</p>
                    <p className="text-sm text-muted-foreground">{po.supplierName}</p>
                  </div>
                  <StatusBadge status={po.status}>{statusLabel(po.status)}</StatusBadge>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-muted-foreground">Location</dt><dd>{po.locationCode}</dd></div>
                  <div><dt className="text-muted-foreground">Created</dt><dd>{dateLabel(po.createdAt)}</dd></div>
                  <div><dt className="text-muted-foreground">Ordered total</dt><dd>{po.orderedTotal === null ? '—' : formatAud(po.orderedTotal)}</dd></div>
                  <div><dt className="text-muted-foreground">Outstanding</dt><dd>{po.outstandingQuantity}</dd></div>
                </dl>
              </Link>
            ))}
          </div>
        </>
      )}

      {cursor || page.hasMore ? (
        <nav aria-label="Purchase order pages" className="flex items-center justify-between text-sm">
          {cursor ? (
            <Link className="rounded-md border px-3 py-2" href={`/purchasing/purchase-orders?${filterQuery}`}>
              Back to first page
            </Link>
          ) : <span />}
          {page.hasMore && page.nextCursor ? (
            <Link
              className="rounded-md border px-3 py-2"
              href={`/purchasing/purchase-orders?${filterQuery}cursor=${encodeURIComponent(page.nextCursor)}`}
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
