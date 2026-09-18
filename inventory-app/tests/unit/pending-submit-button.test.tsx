import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return { ...actual, useFormStatus: vi.fn() };
});

import { useFormStatus } from 'react-dom';

import { PendingSubmitButton } from '@/components/ui/pending-submit-button';

const mockedUseFormStatus = vi.mocked(useFormStatus);

describe('PendingSubmitButton', () => {
  beforeEach(() => {
    mockedUseFormStatus.mockReset();
  });

  it('renders its normal label while the surrounding form is idle', () => {
    mockedUseFormStatus.mockReturnValue({ pending: false, data: null, method: null, action: null });

    render(<form><PendingSubmitButton pendingChildren="Saving…">Save transfer</PendingSubmitButton></form>);

    expect(screen.getByRole('button', { name: 'Save transfer' })).toBeEnabled();
  });

  it('locks the submit control and announces its pending label during submission', () => {
    mockedUseFormStatus.mockReturnValue({ pending: true, data: new FormData(), method: 'post', action: '' });

    render(<form><PendingSubmitButton pendingChildren="Saving…">Save transfer</PendingSubmitButton></form>);

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });
});
