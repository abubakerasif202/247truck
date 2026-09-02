type RpcErrorLike = {
  message?: string;
  code?: string;
};

const messages: Record<string, string> = {
  ACCESS_DENIED: 'You do not have permission to perform this action.',
  SUPPLIER_NOT_FOUND: 'Supplier not found.',
  INVALID_SUPPLIER_NAME: 'Supplier name is required.',
  PURCHASE_ORDER_NOT_FOUND: 'Purchase order not found.',
  PO_NOT_EDITABLE: 'This purchase order can no longer be edited.',
  PO_CANNOT_SUBMIT: 'This purchase order cannot be submitted from its current status.',
  PO_LINES_REQUIRED: 'Add at least one purchase order line before submitting.',
  PO_CANNOT_APPROVE: 'This purchase order cannot be approved from its current status.',
  PO_CANNOT_REJECT: 'This purchase order cannot be rejected from its current status.',
  REJECTION_REASON_REQUIRED: 'A rejection reason is required.',
  PO_CANNOT_MARK_SENT: 'Only an approved purchase order can be marked as sent.',
  CANCELLATION_REASON_REQUIRED: 'A cancellation reason is required.',
  PO_CANNOT_CANCEL: 'This purchase order can no longer be cancelled.',
  PRODUCT_NOT_FOUND: 'One of the selected products is unavailable.',
  DUPLICATE_PO_PRODUCT: 'Duplicate products are not allowed.',
  INVALID_PO_LINES: 'One or more purchase order lines are invalid.',
};

export function mapPurchasingRpcError(
  error: RpcErrorLike | null | undefined,
  fallback: string,
): string {
  const message = error?.message ?? '';
  for (const [token, safeMessage] of Object.entries(messages)) {
    if (message.includes(token)) return safeMessage;
  }
  return fallback;
}
