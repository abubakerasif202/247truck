type RpcErrorLike = {
  message?: string;
  code?: string;
};

const messages: Record<string, string> = {
  ACCESS_DENIED: 'You do not have permission to perform this action.',
  SUPPLIER_NOT_FOUND: 'Supplier not found.',
  INVALID_SUPPLIER_NAME: 'Supplier name is required.',
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
