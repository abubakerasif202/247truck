import type {
  PurchaseOrderDraftInput,
  PurchaseOrderLineInput,
  ReceiptFormInput,
  ReceiptLineInput,
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

export function parseReceiptLines(value: string): ReceiptLineInput[] {
  let rawLines: unknown;
  try {
    rawLines = JSON.parse(value);
  } catch {
    throw new Error('Receipt lines are invalid.');
  }

  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new Error('Add at least one receipt line.');
  }

  const seenLineIds = new Set<string>();
  return rawLines.map((raw): ReceiptLineInput => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Receipt lines are invalid.');
    }
    const line = raw as { purchaseOrderLineId?: unknown; quantityReceived?: unknown };
    const purchaseOrderLineId =
      typeof line.purchaseOrderLineId === 'string' ? line.purchaseOrderLineId.trim() : '';
    if (purchaseOrderLineId === '') throw new Error('Purchase order line is required.');
    if (seenLineIds.has(purchaseOrderLineId)) throw new Error('Duplicate receipt lines are not allowed.');
    seenLineIds.add(purchaseOrderLineId);

    const quantityReceived = Number(line.quantityReceived);
    if (!Number.isInteger(quantityReceived) || quantityReceived <= 0) {
      throw new Error('Received quantity must be at least 1.');
    }
    return { purchaseOrderLineId, quantityReceived };
  });
}

type RawReceiptFormLine = {
  purchaseOrderLineId?: unknown;
  receiveNow?: unknown;
  outstandingQuantity?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function receiptInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function parseReceiptForm(formData: FormData): ReceiptFormInput {
  const rawValue = formData.get('lines');
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new Error('Receipt lines are invalid.');
  }

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(rawValue);
  } catch {
    throw new Error('Receipt lines are invalid.');
  }

  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new Error('Add at least one receipt line.');
  }

  const seenLineIds = new Set<string>();
  const lines: ReceiptLineInput[] = [];
  for (const raw of rawLines) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Receipt lines are invalid.');
    }

    const line = raw as RawReceiptFormLine;
    const purchaseOrderLineId =
      typeof line.purchaseOrderLineId === 'string' ? line.purchaseOrderLineId.trim() : '';
    if (!UUID_PATTERN.test(purchaseOrderLineId)) {
      throw new Error('Purchase order line ID is invalid.');
    }
    if (seenLineIds.has(purchaseOrderLineId)) {
      throw new Error('Duplicate receipt lines are not allowed.');
    }
    seenLineIds.add(purchaseOrderLineId);

    const receiveNow = receiptInteger(line.receiveNow);
    const outstandingQuantity = receiptInteger(line.outstandingQuantity);
    if (
      receiveNow === null ||
      outstandingQuantity === null ||
      receiveNow < 0 ||
      outstandingQuantity < 0
    ) {
      throw new Error('Receive Now must be a whole number of 0 or more.');
    }
    if (receiveNow > outstandingQuantity) {
      throw new Error('Receive Now cannot exceed the outstanding quantity.');
    }
    if (receiveNow > 0) lines.push({ purchaseOrderLineId, quantityReceived: receiveNow });
  }

  if (lines.length === 0) throw new Error('Receive at least one item.');

  return {
    lines,
    supplierDeliveryReference: optional(
      formData,
      'supplierDeliveryReference',
      'Supplier delivery reference',
      500,
    ),
    notes: optional(formData, 'notes', 'Notes', 2000),
  };
}
