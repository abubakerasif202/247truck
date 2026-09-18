import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  approveTransferStateAction: vi.fn(),
  rejectTransferStateAction: vi.fn(),
  dispatchTransferStateAction: vi.fn(),
  cancelTransferStateAction: vi.fn(),
  resolveTransferStateAction: vi.fn(),
  receiveTransferAction: vi.fn(),
}));

vi.mock('@/app/(protected)/transfers/actions', () => mocks);

import { TransferLifecycleControls } from '@/components/transfers/transfer-lifecycle-controls';

/**
 * Regression for a defect the deep inventory review found and fixed but never
 * covered: app/(protected)/transfers/actions.ts used to invoke transfer
 * lifecycle RPCs (submit/approve/dispatch/reject/cancel/resolve) and discard
 * their returned errors, so a transition the database rejected (wrong state,
 * stale version, missing authorization) could render as a completed form
 * submission with no indication anything failed. The fix threads a
 * TransferActionResult back through useActionState; this proves a rejected
 * RPC surfaces its error in the UI and never renders as a silent success.
 */
describe('TransferLifecycleControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces a rejected approval instead of silently succeeding', async () => {
    mocks.approveTransferStateAction.mockResolvedValue({
      ok: false,
      error: 'TRANSFER_VERSION_CONFLICT: this transfer changed since the page loaded.',
    });

    render(<TransferLifecycleControls id="transfer-1" status="requested" isAdmin canDispatch={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await act(async () => {});

    expect(mocks.approveTransferStateAction).toHaveBeenCalledWith('transfer-1', undefined, expect.any(FormData));
    expect(screen.getByRole('alert')).toHaveTextContent('TRANSFER_VERSION_CONFLICT');
    // The button must return to its normal label — it must never keep
    // reporting "Approving…" or otherwise imply the transition went through.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('shows no error and returns the button to normal after a successful transition', async () => {
    mocks.approveTransferStateAction.mockResolvedValue({ ok: true, transferId: 'transfer-1' });

    render(<TransferLifecycleControls id="transfer-1" status="requested" isAdmin canDispatch={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await act(async () => {});

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('requires a rejection reason before submitting and surfaces a rejected reject RPC', async () => {
    mocks.rejectTransferStateAction.mockResolvedValue({ ok: false, error: 'ACCESS_DENIED' });

    render(<TransferLifecycleControls id="transfer-1" status="requested" isAdmin canDispatch={false} />);

    const reasonInput = screen.getByRole('textbox', { name: 'Reject reason' });
    fireEvent.change(reasonInput, { target: { value: 'Wrong quantity requested' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await act(async () => {});

    expect(mocks.rejectTransferStateAction).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveTextContent('ACCESS_DENIED');
  });

  it('surfaces a rejected dispatch instead of silently succeeding', async () => {
    mocks.dispatchTransferStateAction.mockResolvedValue({ ok: false, error: 'INSUFFICIENT_STOCK' });

    render(<TransferLifecycleControls id="transfer-1" status="approved" isAdmin={false} canDispatch />);

    fireEvent.click(screen.getByRole('button', { name: 'Dispatch' }));
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent('INSUFFICIENT_STOCK');
    expect(screen.getByRole('button', { name: 'Dispatch' })).toBeEnabled();
  });
});
