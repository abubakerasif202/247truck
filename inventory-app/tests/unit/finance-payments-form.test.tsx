import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PaymentPanel } from '../../components/finance/payment-panel';

describe('PaymentPanel', () => {
  it('fails closed when payment permissions are omitted', () => {
    render(<PaymentPanel invoiceId="11111111-1111-4111-8111-111111111111" version={2} balance="50.00" payments={[]} recordAction={vi.fn()} reverseAction={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByText('Correct this payment')).not.toBeInTheDocument();
  });

  it('keeps entered values and the client request id when the action returns a stale error', async () => {
    const action = vi.fn(async (_previous: unknown, form: FormData) => ({ ok: false as const, error: 'This invoice changed. Please reload and review your changes.', requestId: String(form.get('request_id')) }));
    render(<PaymentPanel invoiceId="11111111-1111-4111-8111-111111111111" version={2} balance="50.00" payments={[]} recordAction={action} reverseAction={vi.fn()} canRecord canReverse />);
    await userEvent.type(screen.getByLabelText('Payment amount'), '20.25');
    const key = (screen.getByTestId('payment-request-id') as HTMLInputElement).value;
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('reload');
    expect(screen.getByLabelText('Payment amount')).toHaveValue(20.25);
    expect((screen.getByTestId('payment-request-id') as HTMLInputElement).value).toBe(key);
  });
});
