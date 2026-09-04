export const PRODUCT_CATEGORY_CODES = [
  'truck_tyre',
  'rim_wheel',
  'tube',
  'valve',
  'wheel_nut_stud',
  'repair_material',
  'balancing_weight',
  'workshop_consumable',
  'other_part',
] as const;

export type ProductCategoryCode = (typeof PRODUCT_CATEGORY_CODES)[number];

/** Display labels — keep in sync with the `product_categories` seed rows. */
export const PRODUCT_CATEGORY_LABELS: Record<ProductCategoryCode, string> = {
  truck_tyre: 'Truck Tyres',
  rim_wheel: 'Rims / Wheels',
  tube: 'Tubes',
  valve: 'Valves',
  wheel_nut_stud: 'Wheel Nuts / Studs',
  repair_material: 'Repair Materials',
  balancing_weight: 'Balancing Weights',
  workshop_consumable: 'Workshop Consumables',
  other_part: 'Other Related Parts',
};

export const TYRE_CONDITIONS = ['new', 'used'] as const;
export type TyreCondition = (typeof TYRE_CONDITIONS)[number];

export const USED_TYRE_UNIT_CONDITIONS = [
  'excellent',
  'good',
  'fair',
  'scrap',
] as const;
export type UsedTyreUnitCondition = (typeof USED_TYRE_UNIT_CONDITIONS)[number];

export const USED_TYRE_UNIT_STATUSES = [
  'available',
  'reserved',
  'sold',
  'scrap',
] as const;
export type UsedTyreUnitStatus = (typeof USED_TYRE_UNIT_STATUSES)[number];

export type TyreAttributes = {
  condition: TyreCondition;
  brand: string;
  pattern: string | null;
  size: string;
  loadIndex: string | null;
  speedRating: string | null;
};

export type ProductSummary = {
  id: string;
  name: string;
  categoryCode: ProductCategoryCode;
  partReference: string | null;
  sellingPriceInclGst: number | null;
  active: boolean;
  tyreCondition: TyreCondition | null;
  brandName: string | null;
  patternName: string | null;
  sizeName: string | null;
};
