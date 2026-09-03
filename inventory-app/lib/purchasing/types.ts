import type { LocationCode } from '../app-config';

export type SupplierInput = {
  name: string;
  abn: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTerms: string | null;
  accountReference: string | null;
  notes: string | null;
};

export type SupplierSummary = SupplierInput & {
  id: string;
  active: boolean;
};

export type PurchaseOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'closed'
  | 'rejected'
  | 'cancelled';

export type PurchaseOrderLineInput = {
  productId: string;
  orderedQuantity: number;
  unitCost: number;
  notes: string | null;
};

export type ReceiptLineInput = {
  purchaseOrderLineId: string;
  quantityReceived: number;
};

export type ReceiptFormInput = {
  lines: ReceiptLineInput[];
  supplierDeliveryReference: string | null;
  notes: string | null;
};

export type ReceivablePurchaseOrderLine = {
  id: string;
  productId: string;
  productName: string;
  orderedQuantity: number;
  previouslyReceived: number;
  outstandingQuantity: number;
  unitCost: number | null;
};

export type ReceivablePurchaseOrder = {
  id: string;
  poNumber: string;
  supplierName: string;
  locationCode: LocationCode;
  status: PurchaseOrderStatus;
  lines: ReceivablePurchaseOrderLine[];
  canReceive: boolean;
};

export type PurchaseOrderDraftInput = {
  locationId: string;
  supplierId: string;
  supplierReference: string | null;
  notes: string | null;
  lines: PurchaseOrderLineInput[];
};

export type PurchaseOrderSummary = {
  id: string;
  poNumber: string;
  locationId: string;
  locationCode: LocationCode;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  createdAt: string;
  orderedTotal: number | null;
  orderedQuantity: number;
  outstandingQuantity: number;
};

export type PurchaseOrderLineDetail = {
  id: string;
  productId: string;
  productName: string;
  supplierSku: string | null;
  orderedQuantity: number;
  receivedQuantity: number;
  unitCost: number | null;
  notes: string | null;
};

export type PurchaseOrderActionFlags = {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canMarkSent: boolean;
  canCancel: boolean;
  canReceive?: boolean;
};

export type PurchaseOrderDetail = {
  id: string;
  poNumber: string;
  locationId: string;
  locationCode: LocationCode;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  supplierReference: string | null;
  notes: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  sentAt: string | null;
  rejectionReason: string | null;
  cancellationReason: string | null;
  lines: PurchaseOrderLineDetail[];
  actions: PurchaseOrderActionFlags;
};

export type PurchaseOrderLocationOption = {
  id: string;
  code: LocationCode;
  name: string;
};

export type PurchaseOrderProductOption = {
  id: string;
  name: string;
  partReference: string | null;
};
