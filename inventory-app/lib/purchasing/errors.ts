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
  RECEIPT_LINES_REQUIRED: 'Add at least one item to receive.',
  INVALID_RECEIPT_LINES: 'One or more receipt lines are invalid.',
  DUPLICATE_RECEIPT_LINE: 'Each purchase order line can only be received once per submission.',
  INVALID_RECEIPT_QUANTITY: 'Received quantities must be whole numbers greater than zero.',
  RECEIPT_QUANTITY_EXCEEDS_OUTSTANDING: 'A receipt quantity exceeds the current outstanding quantity.',
  RECEIPT_LINE_NOT_IN_PURCHASE_ORDER: 'One of the selected receipt lines is not on this purchase order.',
  PO_NOT_RECEIVABLE: 'This purchase order is not available for receiving.',
  IDEMPOTENCY_KEY_REUSED: 'This receiving request cannot be reused.',
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
