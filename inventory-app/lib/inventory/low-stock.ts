export type LowStockInput = {
  available: number;
  minimumStock: number;
};

/**
 * Low stock means available is strictly below the location's minimum. A minimum
 * of 0 disables the warning.
 */
export function isLowStock({ available, minimumStock }: LowStockInput): boolean {
  return minimumStock > 0 && available < minimumStock;
}

export type ReorderSuggestion = {
  shortfall: number;
  suggestedOrderQuantity: number;
};

/**
 * Non-binding reorder hint: how far below minimum, and the configured reorder
 * quantity (at least enough to clear the shortfall). Never triggers an order.
 */
export function reorderSuggestion(input: {
  available: number;
  minimumStock: number;
  reorderQuantity: number;
}): ReorderSuggestion | null {
  if (!isLowStock(input)) return null;
  const shortfall = input.minimumStock - input.available;
  return {
    shortfall,
    suggestedOrderQuantity: Math.max(shortfall, input.reorderQuantity),
  };
}
