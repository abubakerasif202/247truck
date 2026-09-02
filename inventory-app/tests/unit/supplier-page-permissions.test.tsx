import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentAccess = vi.fn();
const listSuppliers = vi.fn();
const redirect = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}));

vi.mock('@/lib/auth/access', () => ({
  getCurrentAccess: (...args: unknown[]) => getCurrentAccess(...args),
}));

vi.mock('@/lib/purchasing/queries', () => ({
  listSuppliers: (...args: unknown[]) => listSuppliers(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({})),
}));

vi.mock('@/components/purchasing/supplier-form', () => ({
  SupplierForm: ({ supplier }: { supplier?: { name: string } }) => (
    <div>{supplier ? `Edit ${supplier.name}` : 'Create supplier form'}</div>
  ),
}));

import SuppliersPage from '../../app/(protected)/purchasing/suppliers/page';

const supplier = {
  id: 'supplier-1',
  name: 'Bridgestone Australia',
  abn: '12345678901',
  contactName: 'Sales Team',
  phone: '08 8123 4567',
  email: 'sales@example.com',
  address: '1 Supplier Street',
  paymentTerms: '30 days',
  accountReference: 'ACCT-12',
  notes: 'Priority supplier',
  active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  listSuppliers.mockResolvedValue([supplier]);
});

describe('SuppliersPage permissions', () => {
  it('renders supplier mutation controls for Admin', async () => {
    getCurrentAccess.mockResolvedValue({
      userId: 'admin-1',
      role: 'admin',
      locationId: null,
      locationCode: null,
      permissions: new Set(),
    });

    render(await SuppliersPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Bridgestone Australia')).toBeInTheDocument();
    expect(screen.getByText('Add supplier')).toBeInTheDocument();
    expect(screen.getAllByText('Edit Bridgestone Australia')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Archive supplier' })).toHaveLength(2);
    expect(listSuppliers).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('lets a purchasing Manager read suppliers without mutation controls', async () => {
    getCurrentAccess.mockResolvedValue({
      userId: 'manager-1',
      role: 'manager',
      locationId: 'location-lon',
      locationCode: 'LON',
      permissions: new Set(['purchasing.view']),
    });

    render(await SuppliersPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Bridgestone Australia')).toBeInTheDocument();
    expect(screen.queryByText('Add supplier')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit Bridgestone Australia')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive supplier' })).not.toBeInTheDocument();
    expect(listSuppliers).toHaveBeenCalledWith(expect.anything(), false);
  });

  it('redirects a Manager without purchasing.view', async () => {
    redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    getCurrentAccess.mockResolvedValue({
      userId: 'manager-2',
      role: 'manager',
      locationId: 'location-lon',
      locationCode: 'LON',
      permissions: new Set(),
    });

    await expect(
      SuppliersPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
    expect(listSuppliers).not.toHaveBeenCalled();
  });
});
