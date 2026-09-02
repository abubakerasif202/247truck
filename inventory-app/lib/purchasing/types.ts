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
