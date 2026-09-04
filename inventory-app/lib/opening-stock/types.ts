export type OpeningStockRow = {
  rowNumber: number;
  brand: string;
  pattern: string;
  size: string;
  quantity: number;
  condition: 'new';
  category: 'truck_tyre';
  location: 'REG';
  costPrice: null;
  sellingPrice: null;
  rowKey: string;
  requestId: string;
};

export type OpeningStockSource = {
  datasetKey: string;
  sha256: string;
  rows: OpeningStockRow[];
  totalQuantity: number;
};
