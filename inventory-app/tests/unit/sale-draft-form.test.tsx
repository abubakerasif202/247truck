import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SaleDraftForm } from '../../components/sales/sale-draft-form';

const locations = [
  { id: 'loc-lon', code: 'LON' },
  { id: 'loc-reg', code: 'REG' },
];

describe('SaleDraftForm', () => {
  it('renders no branch selector and posts the fixed branch when locationId is pinned', () => {
    const { container } = render(
      <SaleDraftForm action={() => {}} locationId="loc-lon" requestId="req-1" />,
    );
    expect(screen.queryByLabelText('Branch')).not.toBeInTheDocument();
    const hidden = container.querySelector('input[name="location_id"]') as HTMLInputElement;
    expect(hidden.value).toBe('loc-lon');
  });

  it('requires an explicit branch choice — and disables submit until one is made — when no branch is pinned', () => {
    // This is the regression case for the bug where an Admin's sale always
    // silently defaulted to Lonsdale regardless of their selected branch
    // scope: when the page cannot resolve a single fixed branch, the form
    // must force an explicit choice rather than guess one.
    render(
      <SaleDraftForm
        action={() => {}}
        locationId=""
        locations={locations}
        requestId="req-2"
        actionLabel="Finalise POS sale"
      />,
    );
    const select = screen.getByLabelText('Branch') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByRole('button', { name: 'Finalise POS sale' })).toBeDisabled();

    fireEvent.change(select, { target: { value: 'loc-reg' } });
    expect(select.value).toBe('loc-reg');
    // Still disabled: no lines added yet.
    expect(screen.getByRole('button', { name: 'Finalise POS sale' })).toBeDisabled();
  });

  it('never falls back to an empty idempotency key', () => {
    const { container } = render(
      <SaleDraftForm action={() => {}} locationId="loc-lon" requestId="req-3" />,
    );
    const hidden = container.querySelector('input[name="request_id"]') as HTMLInputElement;
    expect(hidden.value).toBe('req-3');
  });
});
