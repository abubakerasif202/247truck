import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isLocationCode } from '../app-config';
import { hasPermission } from '../auth/permissions';
import type { UserAccessContext } from '../auth/types';
import type { LocationScope } from '../location/scope';
import type {
  PurchaseOrderActionFlags,
  PurchaseOrderDetail,
  PurchaseOrderLocationOption,
  PurchaseOrderProductOption,
  ReceivablePurchaseOrder,
  PurchaseOrderStatus,
  PurchaseOrderSummary,
  ReorderSuggestion,
  SupplierSummary,
} from './types';

type SupplierRow = {
  id: string;
  name: string;
  abn: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms: string | null;
  account_reference: string | null;
  notes: string | null;
  active: boolean;
};

type PurchaseOrderSummaryRow = {
  purchase_order_id: string;
  po_number: string;
  location_id: string;
  location_code: string;
  supplier_id: string;
  supplier_name: string;
  status: PurchaseOrderStatus;
  created_at: string;
  ordered_total: number | string | null;
  ordered_quantity: number | string;
  outstanding_quantity: number | string;
};

type PurchaseOrderDetailRow = {
  purchase_order_id: string;
  po_number: string;
  location_id: string;
  location_code: string;
  supplier_id: string;
  supplier_name: string;
  status: PurchaseOrderStatus;
  supplier_reference: string | null;
  purchase_order_notes: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  sent_at: string | null;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  line_id: string | null;
  product_id: string | null;
  product_name: string | null;
  supplier_sku: string | null;
  ordered_quantity: number | string | null;
  received_quantity: number | string | null;
  unit_cost: number | string | null;
  line_notes: string | null;
};

type LocationRow = { id: string; code: string; name: string };
type ProductRow = { id: string; name: string; part_reference: string | null };

type ReorderSuggestionRow = {
  product_id: string;
  product_name: string;
  location_code: string;
  available: number | string;
  minimum_stock: number | string;
  reorder_quantity: number | string;
  preferred_supplier_id: string | null;
  preferred_supplier_name: string | null;
};

function toSupplier(row: SupplierRow): SupplierSummary {
  return {
    id: row.id,
    name: row.name,
    abn: row.abn,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    paymentTerms: row.payment_terms,
    accountReference: row.account_reference,
    notes: row.notes,
    active: row.active,
  };
}

function numberOrZero(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function costOrNull(
  value: number | string | null | undefined,
  access: UserAccessContext,
): number | null {
  if (!hasPermission(access, 'inventory.view_cost') || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getPurchaseOrderActionFlags(
  access: UserAccessContext,
  status: PurchaseOrderStatus,
): PurchaseOrderActionFlags {
  const editable = status === 'draft' || status === 'rejected';
  const isAdmin = access.role === 'admin';

  return {
    canEdit: editable && hasPermission(access, 'purchasing.create_po'),
    canSubmit: editable && hasPermission(access, 'purchasing.submit_po'),
    canApprove: isAdmin && status === 'submitted',
    canReject: isAdmin && status === 'submitted',
    canMarkSent: isAdmin && status === 'approved',
    canCancel:
      isAdmin &&
      ['draft', 'submitted', 'approved', 'sent', 'rejected'].includes(status),
    canReceive:
      hasPermission(access, 'purchasing.receive_po') &&
      ['approved', 'sent', 'partially_received'].includes(status),
  };
}

export function toReceivablePurchaseOrder(
  purchaseOrder: PurchaseOrderDetail,
  access: UserAccessContext,
): ReceivablePurchaseOrder {
  const lines = purchaseOrder.lines.map((line) => ({
    id: line.id,
    productId: line.productId,
    productName: line.productName,
    orderedQuantity: line.orderedQuantity,
    previouslyReceived: line.receivedQuantity,
    outstandingQuantity: Math.max(0, line.orderedQuantity - line.receivedQuantity),
    unitCost: costOrNull(line.unitCost, access),
  }));

  return {
    id: purchaseOrder.id,
    poNumber: purchaseOrder.poNumber,
    supplierName: purchaseOrder.supplierName,
    locationCode: purchaseOrder.locationCode,
    status: purchaseOrder.status,
    lines,
    canReceive:
      purchaseOrder.actions.canReceive === true &&
      lines.some((line) => line.outstandingQuantity > 0),
  };
}

export function mapPurchaseOrderSummaryRow(
  raw: Record<string, unknown>,
  access: UserAccessContext,
): PurchaseOrderSummary {
  const row = raw as unknown as PurchaseOrderSummaryRow;
  if (!isLocationCode(row.location_code)) {
    throw new Error('Invalid purchase order location.');
  }

  return {
    id: row.purchase_order_id,
    poNumber: row.po_number,
    locationId: row.location_id,
    locationCode: row.location_code,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    status: row.status,
    createdAt: row.created_at,
    orderedTotal: costOrNull(row.ordered_total, access),
    orderedQuantity: numberOrZero(row.ordered_quantity),
    outstandingQuantity: numberOrZero(row.outstanding_quantity),
  };
}

export async function listSuppliers(
  client: SupabaseClient,
  includeInactive = false,
): Promise<SupplierSummary[]> {
  let query = client
    .from('suppliers')
    .select(
      'id, name, abn, contact_name, phone, email, address, payment_terms, account_reference, notes, active',
    )
    .order('name');

  if (!includeInactive) query = query.eq('active', true);

  const { data, error } = await query.returns<SupplierRow[]>();
  if (error) {
    console.error('[purchasing] listSuppliers failed', error.message);
    throw new Error('Could not load suppliers.');
  }

  return (data ?? []).map(toSupplier);
}

async function locationIdForScope(
  client: SupabaseClient,
  scope: LocationScope,
): Promise<string | null> {
  if (scope.kind === 'all') return null;

  const { data, error } = await client
    .from('locations')
    .select('id')
    .eq('code', scope.code)
    .eq('active', true)
    .single<{ id: string }>();
  if (error || !data) {
    console.error('[purchasing] location lookup failed', error?.message);
    throw new Error('Could not load purchase orders.');
  }
  return data.id;
}

export async function listPurchaseOrders(
  client: SupabaseClient,
  access: UserAccessContext,
  options: {
    scope: LocationScope;
    status?: PurchaseOrderStatus | null;
    supplierId?: string | null;
  },
): Promise<PurchaseOrderSummary[]> {
  const locationId = await locationIdForScope(client, options.scope);
  const { data, error } = await client.rpc('purchase_order_summary', {
    p_location_id: locationId,
    p_status: options.status ?? null,
  });

  if (error) {
    console.error('[purchasing] purchase order summary failed', error.message);
    throw new Error('Could not load purchase orders.');
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => mapPurchaseOrderSummaryRow(row, access))
    .filter((po) => !options.supplierId || po.supplierId === options.supplierId);
}

export async function getPurchaseOrderDetail(
  client: SupabaseClient,
  access: UserAccessContext,
  purchaseOrderId: string,
): Promise<PurchaseOrderDetail | null> {
  const { data, error } = await client.rpc('purchase_order_detail', {
    p_purchase_order_id: purchaseOrderId,
  });

  if (error) {
    if (error.message.includes('PURCHASE_ORDER_NOT_FOUND')) return null;
    console.error('[purchasing] purchase order detail failed', error.message);
    throw new Error('Could not load purchase order.');
  }

  const rows = (data ?? []) as PurchaseOrderDetailRow[];
  const first = rows[0];
  if (!first) return null;
  if (!isLocationCode(first.location_code)) {
    throw new Error('Invalid purchase order location.');
  }

  return {
    id: first.purchase_order_id,
    poNumber: first.po_number,
    locationId: first.location_id,
    locationCode: first.location_code,
    supplierId: first.supplier_id,
    supplierName: first.supplier_name,
    status: first.status,
    supplierReference: first.supplier_reference,
    notes: first.purchase_order_notes,
    createdAt: first.created_at,
    submittedAt: first.submitted_at,
    approvedAt: first.approved_at,
    rejectedAt: first.rejected_at,
    sentAt: first.sent_at,
    rejectionReason: first.rejection_reason,
    cancellationReason: first.cancellation_reason,
    lines: rows.flatMap((row) => {
      if (!row.line_id || !row.product_id || !row.product_name) return [];
      return [
        {
          id: row.line_id,
          productId: row.product_id,
          productName: row.product_name,
          supplierSku: row.supplier_sku,
          orderedQuantity: numberOrZero(row.ordered_quantity),
          receivedQuantity: numberOrZero(row.received_quantity),
          unitCost: costOrNull(row.unit_cost, access),
          notes: row.line_notes,
        },
      ];
    }),
    actions: getPurchaseOrderActionFlags(access, first.status),
  };
}

export async function getReceivablePurchaseOrder(
  client: SupabaseClient,
  access: UserAccessContext,
  purchaseOrderId: string,
): Promise<ReceivablePurchaseOrder | null> {
  const purchaseOrder = await getPurchaseOrderDetail(client, access, purchaseOrderId);
  return purchaseOrder ? toReceivablePurchaseOrder(purchaseOrder, access) : null;
}

export async function listPurchaseOrderLocations(
  client: SupabaseClient,
  access: UserAccessContext,
): Promise<PurchaseOrderLocationOption[]> {
  let query = client
    .from('locations')
    .select('id, code, name')
    .eq('active', true)
    .order('code');

  if (access.role === 'manager' && access.locationId) {
    query = query.eq('id', access.locationId);
  }

  const { data, error } = await query.returns<LocationRow[]>();
  if (error) {
    console.error('[purchasing] locations failed', error.message);
    throw new Error('Could not load locations.');
  }

  return (data ?? []).flatMap((row) =>
    isLocationCode(row.code) ? [{ id: row.id, code: row.code, name: row.name }] : [],
  );
}

export async function listPurchaseOrderProducts(
  client: SupabaseClient,
): Promise<PurchaseOrderProductOption[]> {
  const { data, error } = await client
    .from('products')
    .select('id, name, part_reference')
    .eq('active', true)
    .order('name')
    .returns<ProductRow[]>();

  if (error) {
    console.error('[purchasing] products failed', error.message);
    throw new Error('Could not load products.');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    partReference: row.part_reference,
  }));
}

export function mapReorderSuggestion(row: ReorderSuggestionRow): ReorderSuggestion {
  if (!isLocationCode(row.location_code)) {
    throw new Error('Invalid reorder suggestion location.');
  }
  return {
    productId: row.product_id,
    productName: row.product_name,
    locationCode: row.location_code,
    available: numberOrZero(row.available),
    minimumStock: numberOrZero(row.minimum_stock),
    reorderQuantity: numberOrZero(row.reorder_quantity),
    preferredSupplierId: row.preferred_supplier_id,
    preferredSupplierName: row.preferred_supplier_name,
  };
}

export async function listReorderSuggestions(
  client: SupabaseClient,
  locationId: string | null,
): Promise<ReorderSuggestion[]> {
  const { data, error } = await client.rpc('reorder_suggestions', {
    p_location_id: locationId,
  });
  if (error) {
    console.error('[purchasing] reorder suggestions failed', error.message);
    throw new Error('Could not load reorder suggestions.');
  }
  return ((data ?? []) as ReorderSuggestionRow[]).map(mapReorderSuggestion);
}
