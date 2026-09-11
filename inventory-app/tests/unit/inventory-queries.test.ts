import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getDashboardInventoryMetrics,
  searchInventory,
} from '../../lib/inventory/queries';
import type { UserAccessContext } from '../../lib/auth/types';

const rpc = vi.fn();

/** A chainable stub mimicking the PostgREST query builder: every method
 * returns itself, and awaiting the chain resolves to the given result. */
function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {
    select: () => obj,
    order: () => obj,
    limit: () => obj,
    eq: () => obj,
    maybeSingle: () => Promise.resolve(result),
    returns: () => Promise.resolve(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return obj;
}

function client() {
  return {
    rpc,
    from: vi.fn(() => chain({ data: [], error: null })),
  } as unknown as Parameters<typeof searchInventory>[0];
}

function access(overrides: Partial<UserAccessContext> = {}): UserAccessContext {
  return {
    userId: 'u1',
    role: 'manager',
    locationId: 'l-lon',
    locationCode: 'LON',
    permissions: new Set(['inventory.view']),
    ...overrides,
  };
}

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    product_id: 'p1',
    name: 'Michelin X Line',
    category_code: 'truck_tyre',
    part_reference: null,
    selling_price_incl_gst: 700,
    tyre_condition: 'new',
    brand_name: 'Michelin',
    pattern_name: 'X Line',
    size_name: '315/80R22.5',
    location_code: 'LON',
    location_name: 'Lonsdale',
    on_hand: 12,
    reserved: 2,
    available: 10,
    weighted_average_cost: 450,
    minimum_stock: 6,
    reorder_quantity: 12,
    low_stock: false,
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  rpc.mockReset();
});

describe('searchInventory', () => {
  it('calls inventory_summary_page with correct args for page/limit/scope/filters', async () => {
    rpc.mockResolvedValue({
      data: { rows: [], total_products: 0, offset: 50, limit: 25, has_more: false },
      error: null,
    });

    await searchInventory(client(), access({ role: 'admin', permissions: new Set() }), {
      scope: { kind: 'location', code: 'REG' },
      search: '  michelin  ',
      category: 'truck_tyre',
      tyreCondition: 'new',
      lowStockOnly: true,
      includeArchived: true,
      page: 3,
      limit: 25,
    });

    expect(rpc).toHaveBeenCalledWith('inventory_summary_page', {
      p_location_code: 'REG',
      p_product_id: null,
      p_search: 'michelin',
      p_category: 'truck_tyre',
      p_tyre_condition: 'new',
      p_low_stock_only: true,
      p_include_archived: true,
      p_offset: 50,
      p_limit: 25,
    });
  });

  it('defaults to page 1 and limit 50, and caps limit at 200', async () => {
    rpc.mockResolvedValue({
      data: { rows: [], total_products: 0, offset: 0, limit: 50, has_more: false },
      error: null,
    });

    await searchInventory(client(), access(), { scope: { kind: 'all' } });
    expect(rpc).toHaveBeenLastCalledWith(
      'inventory_summary_page',
      expect.objectContaining({ p_offset: 0, p_limit: 50 }),
    );

    await searchInventory(client(), access(), { scope: { kind: 'all' }, limit: 5000 });
    expect(rpc).toHaveBeenLastCalledWith(
      'inventory_summary_page',
      expect.objectContaining({ p_limit: 200 }),
    );
  });

  it('leaves cost null for callers without inventory.view_cost, never coercing to 0', async () => {
    rpc.mockResolvedValue({
      data: {
        rows: [summaryRow({ weighted_average_cost: 450 })],
        total_products: 1,
        offset: 0,
        limit: 50,
        has_more: false,
      },
      error: null,
    });

    const result = await searchInventory(
      client(),
      access({ permissions: new Set() }),
      { scope: { kind: 'location', code: 'LON' } },
    );

    expect(result.rows[0].weightedAverageCost).toBeNull();
  });

  it('returns the real cost for callers with inventory.view_cost', async () => {
    rpc.mockResolvedValue({
      data: {
        rows: [summaryRow({ weighted_average_cost: 450 })],
        total_products: 1,
        offset: 0,
        limit: 50,
        has_more: false,
      },
      error: null,
    });

    const result = await searchInventory(
      client(),
      access({ permissions: new Set(['inventory.view_cost']) }),
      { scope: { kind: 'location', code: 'LON' } },
    );

    expect(result.rows[0].weightedAverageCost).toBe(450);
  });

  it('surfaces total_products and has_more for a scope with more than 1000 rows', async () => {
    rpc.mockResolvedValue({
      data: {
        rows: [summaryRow()],
        total_products: 1500,
        offset: 0,
        limit: 50,
        has_more: true,
      },
      error: null,
    });

    const result = await searchInventory(client(), access(), { scope: { kind: 'all' } });

    expect(result.totalProducts).toBe(1500);
    expect(result.hasMore).toBe(true);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
  });

  it('throws on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } });
    await expect(
      searchInventory(client(), access(), { scope: { kind: 'all' } }),
    ).rejects.toThrow('Could not load inventory.');
  });
});

describe('getDashboardInventoryMetrics', () => {
  it('reads totals from the inventory_dashboard_metrics RPC rather than counting rows', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'inventory_dashboard_metrics') {
        return Promise.resolve({
          data: { active_products: 42, total_on_hand: 999, low_stock_items: 3 },
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const result = await getDashboardInventoryMetrics(
      client(),
      access({ permissions: new Set() }),
      { kind: 'all' },
    );

    expect(rpc).toHaveBeenCalledWith('inventory_dashboard_metrics', { p_location_code: null });
    expect(result.activeProducts).toBe(42);
    expect(result.totalOnHand).toBe(999);
    expect(result.lowStockItems).toBe(3);
  });

  it('throws when the dashboard metrics RPC errors', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'inventory_dashboard_metrics') {
        return Promise.resolve({ data: null, error: { message: 'boom', code: '42501' } });
      }
      return Promise.resolve({ data: [], error: null });
    });

    await expect(
      getDashboardInventoryMetrics(client(), access(), { kind: 'location', code: 'LON' }),
    ).rejects.toThrow('Could not load dashboard metrics.');
  });
});
