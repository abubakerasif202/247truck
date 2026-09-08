const messages: Record<string, string> = {
  ACCESS_DENIED: 'You do not have access to this finance action.',
  FINANCE_VERSION_CONFLICT: 'These settings changed. Please reload and review your changes.',
  INVOICE_VERSION_CONFLICT: 'This invoice changed. Please reload and review your changes.',
  INVALID_FINANCE_INPUT: 'Please check the invoice details and try again.',
  INVALID_DECIMAL: 'Enter a valid amount with the allowed decimal precision.',
  MONEY_OUT_OF_RANGE: 'That amount is outside the allowed range.',
  DISCOUNT_REASON_REQUIRED: 'A reason is required for a positive discount.',
  DISCOUNT_LIMIT_EXCEEDED: 'This discount exceeds your current authority.',
  IDEMPOTENCY_KEY_REUSED: 'This request was already used with different details. Please reload.',
  INVOICE_FINANCIAL_LOCKED: 'Financial revisions are permanently locked after the first payment.',
  JOB_CONSUMPTION_UNVERIFIED:
    'This job’s stock consumption could not be verified. Ask a supervisor to review it — do not re-run completion.',
  JOB_NOT_COMPLETED: 'The job must be completed before it can be invoiced.',
  JOB_ALREADY_INVOICED: 'This job already has an invoice.',
  JOB_ALREADY_COMPLETED: 'This job is already completed. Create the invoice from the completed job instead.',
  JOB_VERSION_CONFLICT: 'This job changed. Please reload and try again.',
  INVOICE_NOT_DRAFT: 'Only a draft invoice can be changed this way.',
  INVOICE_NOT_ISSUED: 'Only an issued invoice can be revised.',
  INVOICE_PRICE_PENDING: 'Every line needs a price before the invoice can be issued.',
  INVOICE_LINES_REQUIRED: 'Add at least one line to the invoice.',
  INVOICE_LINE_DESCRIPTION_REQUIRED: 'Each line needs a description.',
  INVOICE_LINE_NOT_EDITABLE: 'That line comes from the source job and cannot be added, removed or re-priced.',
  INVOICE_LINE_NOT_FOUND: 'One of the lines no longer exists. Please reload.',
  MANUAL_INVOICE_SERVICE_ONLY: 'A manual invoice can only contain labour or service lines.',
  FINANCE_IDENTITY_INCOMPLETE:
    'Complete the business and branch finance identity in Finance Settings before issuing invoices.',
  REVISION_REASON_REQUIRED: 'A reason is required to revise an issued invoice.',
  CANCELLATION_REASON_REQUIRED: 'A reason is required to cancel an invoice.',
  ISSUED_CANCELLATION_NOT_AVAILABLE: 'Issued invoices cannot be cancelled yet. Use a revision, or ask an Admin.',
  INVALID_INVOICE_TRANSITION: 'This invoice cannot change to that state.',
  INVALID_PAYMENT_TERMS: 'Choose valid payment terms for this customer.',
  CUSTOMER_ARCHIVED: 'That customer is archived.',
  VEHICLE_CUSTOMER_MISMATCH: 'That vehicle does not belong to the selected customer.',
  INVALID_LIMIT: 'Invalid list size requested.',
  PAYMENT_EXCEEDS_BALANCE: 'The payment exceeds the invoice’s outstanding balance. Reload and review the amount.',
  PAYMENT_NOT_ALLOWED: 'This invoice cannot accept a manual payment.',
  PAYMENT_ALREADY_REVERSED: 'This payment has already been reversed.',
  PAYMENT_NOT_FOUND: 'The payment could not be found on this invoice.',
  PAYMENT_REVERSAL_NOT_ALLOWED: 'This payment cannot be reversed.',
  REVERSAL_REASON_REQUIRED: 'Enter a reason for reversing this payment.',
  INVALID_PAYMENT_TENDERS: 'Check each payment method and amount.',
};

/**
 * Maps a known finance sentinel to a safe customer/staff message. Any error text
 * that is not an exact known sentinel collapses to a generic message so raw
 * database/provider detail never reaches the UI.
 */
export function financeError(error: { message?: string } | null): string {
  const raw = error?.message ?? '';
  if (messages[raw]) return messages[raw];
  const code = raw.match(/^([A-Z][A-Z0-9_]{3,})$/)?.[1] ?? raw.match(/([A-Z][A-Z0-9_]{3,})/)?.[1] ?? '';
  return messages[code] ?? 'The finance action could not be completed. Please try again.';
}
