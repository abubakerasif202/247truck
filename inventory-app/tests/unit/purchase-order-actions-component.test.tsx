import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PurchaseOrderActions } from '../../components/purchasing/purchase-order-actions';

vi.mock('../../app/(protected)/purchasing/purchase-orders/actions', () => ({
  submitPurchaseOrderAction: vi.fn(async () => ({ ok: true })),
  approvePurchaseOrderAction: vi.fn(async () => ({ ok: true })),
  rejectPurchaseOrderAction: vi.fn(async () => ({ ok: true })),
  markPurchaseOrderSentAction: vi.fn(async () => ({ ok: true })),
  cancelPurchaseOrderAction: vi.fn(async () => ({ ok: true })),
}));

describe('PurchaseOrderActions', () => {
  it('renders Manager draft actions without Admin controls', () => {
    render(
      <PurchaseOrderActions
        purchaseOrderId="po-1"
        flags={{
          canEdit: true,
          canSubmit: true,
          canApprove: false,
          canReject: false,
          canMarkSent: false,
          canCancel: false,
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Edit draft' })).toHaveAttribute(
      'href',
      '/purchasing/purchase-orders/po-1?edit=1',
    );
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('renders Admin decision controls only when flags permit them', () => {
    render(
      <PurchaseOrderActions
        purchaseOrderId="po-2"
        flags={{
          canEdit: false,
          canSubmit: false,
          canApprove: true,
          canReject: true,
          canMarkSent: false,
          canCancel: true,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getByLabelText('Rejection reason')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel PO' })).toBeInTheDocument();
    expect(screen.getByLabelText('Cancellation reason')).toBeInTheDocument();
  });

  it('renders receiving only when permitted and the PO has outstanding stock', () => {
    const { rerender } = render(
      <PurchaseOrderActions
        purchaseOrderId="po-3"
        hasOutstanding
        flags={{
          canEdit: false,
          canSubmit: false,
          canApprove: false,
          canReject: false,
          canMarkSent: false,
          canCancel: false,
          canReceive: true,
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Receive stock' })).toHaveAttribute(
      'href',
      '/purchasing/purchase-orders/po-3/receive',
    );

    rerender(
      <PurchaseOrderActions
        purchaseOrderId="po-3"
        flags={{
          canEdit: false,
          canSubmit: false,
          canApprove: false,
          canReject: false,
          canMarkSent: false,
          canCancel: false,
          canReceive: true,
        }}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Receive stock' })).not.toBeInTheDocument();
  });
});
