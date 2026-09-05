const messages: Record<string, string> = {
  ACCESS_DENIED: 'You do not have access to this finance action.',
  FINANCE_VERSION_CONFLICT: 'These settings changed. Please reload and review your changes.',
  INVOICE_VERSION_CONFLICT: 'This invoice changed. Please reload and review your changes.',
  INVALID_FINANCE_INPUT: 'Please check the finance settings and try again.',
  INVALID_DECIMAL: 'Enter a valid amount with the allowed decimal precision.',
  DISCOUNT_REASON_REQUIRED: 'A reason is required for a positive discount.',
  DISCOUNT_LIMIT_EXCEEDED: 'This discount exceeds your current authority.',
  IDEMPOTENCY_KEY_REUSED: 'This request was already used with different details. Please reload.',
  INVOICE_FINANCIAL_LOCKED: 'Financial revisions are permanently locked after the first payment.',
};

export function financeError(error: { message?: string } | null): string {
  return messages[error?.message ?? ''] ?? 'The finance action could not be completed. Please try again.';
}
