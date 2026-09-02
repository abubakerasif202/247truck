import type {
  PurchaseOrderDraftInput,
  PurchaseOrderLineInput,
  SupplierInput,
} from './types';

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function optional(
  formData: FormData,
  key: string,
  label: string,
  maxLength: number,
): string | null {
  const value = text(formData, key);
  if (value.length > maxLength) {
    const verb = label === 'Notes' ? 'are' : 'is';
    throw new Error(`${label} ${verb} too long.`);
  }
  return value === '' ? null : value;
}

export function parseSupplierInput(formData: FormData): SupplierInput {
  const name = text(formData, 'name');
  if (name === '') throw new Error('Supplier name is required.');
  if (name.length > 160) throw new Error('Supplier name is too long.');

  const email = optional(formData, 'email', 'Email', 500);

  return {
    name,
    abn: optional(formData, 'abn', 'ABN', 500),
    contactName: optional(formData, 'contactName', 'Contact name', 500),
    phone: optional(formData, 'phone', 'Phone', 500),
    email: email?.toLowerCase() ?? null,
    address: optional(formData, 'address', 'Address', 2000),
    paymentTerms: optional(formData, 'paymentTerms', 'Payment terms', 500),
    accountReference: optional(formData, 'accountReference', 'Account reference', 500),
    notes: optional(formData, 'notes', 'Notes', 2000),
  };
}

type RawPurchaseOrderLine = {
  productId?: unknown;
  orderedQuantity?: unknown;
  unitCost?: unknown;
  notes?: unknown;
};

function parsePurchaseOrderLines(value: string): PurchaseOrderLineInput[] {
  let rawLines: unknown;
  try {
    rawLines = JSON.parse(value);
  } catch {
    throw new Error('Purchase order lines are invalid.');
  }

  if (!Array.isArray(rawLines)) {
    throw new Error('Purchase order lines are invalid.');
  }
  if (rawLines.length === 0) {
    throw new Error('Add at least one purchase order line.');
  }

  const seenProductIds = new Set<string>();

  return rawLines.map((raw): PurchaseOrderLineInput => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Purchase order lines are invalid.');
    }

    const line = raw as RawPurchaseOrderLine;
    const productId = typeof line.productId === 'string' ? line.productId.trim() : '';
    if (productId === '') throw new Error('Product is required for each line.');
    if (seenProductIds.has(productId)) {
      throw new Error('Duplicate products are not allowed.');
    }
    seenProductIds.add(productId);

    const orderedQuantity = Number(line.orderedQuantity);
    if (!Number.isInteger(orderedQuantity) || orderedQuantity < 1) {
      throw new Error('Quantity must be at least 1.');
    }

    const rawCost =
      typeof line.unitCost === 'string'
        ? line.unitCost.trim()
        : typeof line.unitCost === 'number'
          ? String(line.unitCost)
          : '';
    const unitCost = Number(rawCost);
    if (rawCost === '' || !Number.isFinite(unitCost) || unitCost < 0) {
      throw new Error('Unit cost must be a finite amount of 0 or more.');
    }

    const decimalPart = rawCost.toLowerCase().includes('e')
      ? ''
      : (rawCost.split('.')[1] ?? '');
    if (decimalPart.length > 4) {
      throw new Error('Unit cost supports up to 4 decimal places.');
    }

    const notes = typeof line.notes === 'string' ? line.notes.trim() : '';
    if (notes.length > 2000) throw new Error('Line notes are too long.');

    return {
      productId,
      orderedQuantity,
      unitCost,
      notes: notes === '' ? null : notes,
    };
  });
}

export function parsePurchaseOrderDraft(formData: FormData): PurchaseOrderDraftInput {
  const locationId = text(formData, 'locationId');
  if (locationId === '') throw new Error('Location is required.');

  const supplierId = text(formData, 'supplierId');
  if (supplierId === '') throw new Error('Supplier is required.');

  const linesValue = text(formData, 'lines');
  if (linesValue === '') throw new Error('Add at least one purchase order line.');

  return {
    locationId,
    supplierId,
    supplierReference: optional(formData, 'supplierReference', 'Supplier reference', 500),
    notes: optional(formData, 'notes', 'Notes', 2000),
    lines: parsePurchaseOrderLines(linesValue),
  };
}
