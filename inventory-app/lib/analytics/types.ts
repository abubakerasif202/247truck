import type { ProductCategoryCode } from '@/lib/products/types';

export type InventoryDistributionRow = {
  groupLabel: string;
  productCount: number;
  onHand: number;
  available: number;
  lowStockCount: number;
  /** null when the caller lacks cost visibility, or when no row in the group has a known cost. */
  knownInventoryValue: number | null;
};

export type InventoryByCategoryRow = InventoryDistributionRow & {
  categoryCode: ProductCategoryCode | null;
  outOfStockCount: number;
};

export type MovementBucket = {
  movementType: string;
  movementCount: number;
  totalQuantity: number;
};

export type StockMovementSummary = {
  periodDays: number;
  buckets: MovementBucket[];
  stockInUnits: number;
  stockOutUnits: number;
  adjustmentUnits: number;
};

export type FastMovingProduct = {
  productId: string;
  productName: string;
  brandName: string | null;
  sizeName: string | null;
  locationCode: string;
  quantityMoved: number;
  movementCount: number;
  onHand: number;
  minimumStock: number;
};

export type SlowMovingProduct = {
  productId: string;
  productName: string;
  brandName: string | null;
  sizeName: string | null;
  locationCode: string;
  onHand: number;
  lastOutwardMovementAt: string | null;
  daysSinceLastMovement: number | null;
  neverMoved: boolean;
};

export type PurchasingAnalyticsSummary = {
  openPurchaseOrders: number;
  outstandingPoUnits: number;
};

export type ReceivablesAnalyticsSummary = {
  outstandingReceivables: number;
  overdueReceivables: number;
  outstandingInvoiceCount: number;
  overdueInvoiceCount: number;
};

export type SlowMovingWindow = 30 | 60 | 90;
export type MovementPeriod = 7 | 30 | 90;
