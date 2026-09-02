export type InventoryBalance = {
  onHand: number;
  reserved: number;
  available: number;
  weightedAverageCost: number | null;
};

export type InventoryMutationResult = InventoryBalance & {
  movementId: string;
};

export type MovementType =
  | 'quick_stock_in'
  | 'stock_out'
  | 'adjustment'
  | 'used_unit_in'
  | 'used_unit_out';

export type PostMovementInput = {
  requestId: string;
  productId: string;
  locationId: string;
  quantityDelta: number;
  movementType: MovementType;
  reason?: string | null;
  inboundUnitCost?: number | null;
  usedTyreUnitId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  supplierName?: string | null;
};

export type SetInventoryCountInput = {
  requestId: string;
  productId: string;
  locationId: string;
  countedQuantity: number;
  reason: string;
  notes?: string | null;
};

export type UsedTyreIntakeInput = {
  requestId: string;
  productId: string;
  locationId: string;
  treadDepthMm: number;
  condition: 'excellent' | 'good' | 'fair' | 'scrap';
  costBasis: number;
  sellingPriceOverride?: number | null;
  notes?: string | null;
};
