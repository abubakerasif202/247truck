import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentAccess, listSalesCustomers, getCustomer } = vi.hoisted(() => ({
  getCurrentAccess: vi.fn(),
  listSalesCustomers: vi.fn(),
  getCustomer: vi.fn(),
}));

vi.mock('@/lib/auth/access', () => ({ getCurrentAccess }));
vi.mock('@/lib/sales/queries', () => ({ listSalesCustomers }));
vi.mock('@/lib/customers/queries', () => ({ getCustomer }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn(async () => ({ rpc: vi.fn() })) }));

import { GET as getCustomers } from '@/app/api/sales/customers/route';
import { GET as getVehicles } from '@/app/api/sales/vehicles/route';

const invoiceAuthorisedAccess = {
  userId: 'user-1', role: 'manager', locationId: 'location-1', locationCode: 'REG',
  permissions: new Set(['invoices.view', 'invoices.create']),
};

describe('sales lookups for manual invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentAccess.mockResolvedValue(invoiceAuthorisedAccess);
  });

  it('allows an invoice-authorised user to search customers', async () => {
    listSalesCustomers.mockResolvedValue([]);

    const response = await getCustomers(new Request('https://inventory.test/api/sales/customers?q=ac'));

    expect(response.status).toBe(200);
    expect(listSalesCustomers).toHaveBeenCalledOnce();
  });

  it('allows an invoice-authorised user to load a selected customer vehicles', async () => {
    getCustomer.mockResolvedValue({ active: true, vehicles: [{ id: 'vehicle-1', registration: 'ABC123', fleet_number: null, vehicle_type: null, make: null, model: null, active: true }] });

    const response = await getVehicles(new Request('https://inventory.test/api/sales/vehicles?customer_id=customer-1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ vehicles: [{ id: 'vehicle-1', registration: 'ABC123', fleet_number: null, vehicle_type: null, make: null, model: null }] });
  });

  it('does not allow invoice viewing alone to query customer data', async () => {
    getCurrentAccess.mockResolvedValue({ ...invoiceAuthorisedAccess, permissions: new Set(['invoices.view']) });

    const response = await getCustomers(new Request('https://inventory.test/api/sales/customers?q=ac'));

    expect(response.status).toBe(403);
    expect(listSalesCustomers).not.toHaveBeenCalled();
  });
});
