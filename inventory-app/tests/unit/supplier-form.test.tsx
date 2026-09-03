import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SupplierForm } from '../../components/purchasing/supplier-form';

vi.mock('../../app/(protected)/purchasing/suppliers/actions', () => ({
  createSupplierAction: vi.fn(async () => ({ ok: true })),
  updateSupplierAction: vi.fn(async () => ({ ok: true })),
}));

describe('SupplierForm', () => {
  it('renders the create supplier workflow', () => {
    render(<SupplierForm />);

    expect(screen.getByLabelText('Supplier name')).toBeRequired();
    expect(screen.getByLabelText('ABN')).toBeInTheDocument();
    expect(screen.getByLabelText('Account reference')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Payment terms')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create supplier' })).toBeInTheDocument();
  });

  it('pre-fills the edit supplier workflow', () => {
    render(
      <SupplierForm
        supplier={{
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
        }}
      />,
    );

    expect(screen.getByLabelText('Supplier name')).toHaveValue('Bridgestone Australia');
    expect(screen.getByLabelText('Email')).toHaveValue('sales@example.com');
    expect(screen.getByRole('button', { name: 'Save supplier' })).toBeInTheDocument();
  });
});
