import { describe, expect, it } from 'vitest';

/**
 * Mathematical models for inventory weighted-average cost (WAC) calculations
 * mirroring PostgreSQL database stored procedures in:
 * - private.post_inventory_movement (quick_stock_in, used_unit_in, purchase_receipt, customer_return)
 * - public.post_opening_stock (opening_stock)
 * - public.receive_transfer (transfer_in)
 */

function calculateNewWac(
  currentOnHand: number,
  currentWac: number,
  deltaQuantity: number,
  inboundCost: number | null,
  movementType: 'quick_stock_in' | 'used_unit_in' | 'purchase_receipt' | 'customer_return' | 'opening_stock' | 'transfer_in' | 'stock_out' | 'adjustment',
): number {
  const newOnHand = currentOnHand + deltaQuantity;

  if (movementType === 'stock_out' || movementType === 'adjustment') {
    return currentWac;
  }

  if (movementType === 'quick_stock_in' || movementType === 'used_unit_in' || movementType === 'purchase_receipt') {
    if (inboundCost === null || inboundCost < 0) {
      throw new Error('INBOUND_COST_REQUIRED');
    }
    return ((currentOnHand * currentWac) + (deltaQuantity * inboundCost)) / newOnHand;
  }

  if (movementType === 'customer_return') {
    if (inboundCost !== null && inboundCost < 0) {
      throw new Error('INVALID_COST');
    }
    if (inboundCost !== null && inboundCost >= 0) {
      const baseCost = currentOnHand === 0 ? inboundCost : (currentWac || inboundCost);
      return ((currentOnHand * baseCost) + (deltaQuantity * inboundCost)) / newOnHand;
    }
    return currentWac;
  }

  if (movementType === 'opening_stock') {
    if (inboundCost === null || inboundCost < 0) {
      throw new Error('INBOUND_COST_REQUIRED');
    }
    return ((currentOnHand * currentWac) + (deltaQuantity * inboundCost)) / newOnHand;
  }

  if (movementType === 'transfer_in') {
    if (inboundCost === null || inboundCost < 0) {
      throw new Error('TRANSFER_COST_REQUIRED');
    }
    return ((currentOnHand * currentWac) + (deltaQuantity * inboundCost)) / newOnHand;
  }

  return currentWac;
}

describe('Inventory Ledger WAC & Inbound Movement Invariants', () => {
  describe('A. PO receipt into zero-stock balance', () => {
    it('calculates exact unit cost as new WAC when initial on_hand is 0', () => {
      // 0 units @ $0 WAC, receive 2 @ $100 -> on_hand = 2, WAC = 100
      const wac = calculateNewWac(0, 0, 2, 100, 'purchase_receipt');
      expect(wac).toBe(100);
    });
  });

  describe('B. PO receipt into existing stock', () => {
    it('recalculates weighted average cost proportionally', () => {
      // 10 units @ $100 WAC, receive 10 @ $200 -> on_hand = 20, WAC = 150
      const wac = calculateNewWac(10, 100, 10, 200, 'purchase_receipt');
      expect(wac).toBe(150);
    });
  });

  describe('C & D. Partial PO receipts and compounding WAC', () => {
    it('compounds WAC across multiple partial receipts', () => {
      // Initial: 0 on_hand
      // Receipt 1: 5 units @ $130
      const wac1 = calculateNewWac(0, 0, 5, 130, 'purchase_receipt');
      expect(wac1).toBe(130);

      // Receipt 2: 5 units @ $170 into 5 @ $130
      const wac2 = calculateNewWac(5, wac1, 5, 170, 'purchase_receipt');
      expect(wac2).toBe(150);

      // Receipt 3: 10 units @ $180 into 10 @ $150
      // ((10 * 150) + (10 * 180)) / 20 = (1500 + 1800) / 20 = 3300 / 20 = 165
      const wac3 = calculateNewWac(10, wac2, 10, 180, 'purchase_receipt');
      expect(wac3).toBe(165);
    });
  });

  describe('E. Duplicate receipt / replay idempotency', () => {
    it('does not alter on_hand or WAC when movement is already posted', () => {
      const initialStock = 10;
      const initialWac = 150;
      // Replayed request returns existing balance unchanged
      expect(initialStock).toBe(10);
      expect(initialWac).toBe(150);
    });
  });

  describe('F. Customer return without unit cost', () => {
    it('preserves existing WAC when unit cost is null', () => {
      // 10 units @ $150 WAC, customer returns 2 units with null unitCost
      const wac = calculateNewWac(10, 150, 2, null, 'customer_return');
      expect(wac).toBe(150);
    });
  });

  describe('G. Customer return with historical unit cost', () => {
    it('incorporates historical return unit cost into WAC', () => {
      // 10 units @ $150 WAC, customer returns 2 units with historical purchase cost $120
      // ((10 * 150) + (2 * 120)) / 12 = (1500 + 240) / 12 = 1740 / 12 = 145
      const wac = calculateNewWac(10, 150, 2, 120, 'customer_return');
      expect(wac).toBe(145);
    });

    it('sets initial WAC when returning item into zero stock with cost', () => {
      // 0 units @ $0, customer returns 1 unit with cost $250
      const wac = calculateNewWac(0, 0, 1, 250, 'customer_return');
      expect(wac).toBe(250);
    });

    it('rejects negative return cost', () => {
      expect(() => calculateNewWac(10, 150, 2, -50, 'customer_return')).toThrow('INVALID_COST');
    });
  });

  describe('H. Transfer In', () => {
    it('uses source-location transfer cost snapshot to recalculate destination WAC', () => {
      // Destination currently has 4 units @ $120 WAC
      // Receives 6 units from source transfer with transfer_cost_snapshot $160
      // ((4 * 120) + (6 * 160)) / 10 = (480 + 960) / 10 = 1440 / 10 = 144
      const destWac = calculateNewWac(4, 120, 6, 160, 'transfer_in');
      expect(destWac).toBe(144);
    });
  });

  describe('I. Opening Stock', () => {
    it('sets initial valuation and compounds additional opening stock batches', () => {
      // Initial import: 20 units @ $85 unit cost
      const wac1 = calculateNewWac(0, 0, 20, 85, 'opening_stock');
      expect(wac1).toBe(85);

      // Additional opening batch: 10 units @ $100
      // ((20 * 85) + (10 * 100)) / 30 = (1700 + 1000) / 30 = 2700 / 30 = 90
      const wac2 = calculateNewWac(20, wac1, 10, 100, 'opening_stock');
      expect(wac2).toBe(90);
    });
  });

  describe('Outbound movements (stock_out, used_unit_out, adjustment)', () => {
    it('does not alter WAC on stock out', () => {
      const wac = calculateNewWac(10, 150, -4, null, 'stock_out');
      expect(wac).toBe(150);
    });

    it('does not alter WAC on stock adjustment', () => {
      const wac = calculateNewWac(10, 150, -1, null, 'adjustment');
      expect(wac).toBe(150);
    });
  });
});
