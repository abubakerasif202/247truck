import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OpeningStockImportPanel } from '../../components/inventory/opening-stock-import-panel';
import type { OpeningStockImportActionState } from '../../app/(protected)/inventory/import/actions';
import type { OpeningStockPreview } from '../../lib/opening-stock/repository';

function preview(): OpeningStockPreview {
  return {
    createCount: 53,
    matchCount: 0,
    ambiguousCount: 0,
    rows: Array.from({ length: 53 }, (_, index) => ({
      rowNumber: index + 2,
      brand: index === 0 ? 'Ralson' : `Brand ${index + 1}`,
      pattern: index === 0 ? 'RMR61' : `P${index + 1}`,
      size: index === 0 ? '295/80r22.5' : '11r22.5',
      quantity: index === 0 ? 51 : 1,
      condition: 'new' as const,
      category: 'truck_tyre' as const,
      location: 'REG' as const,
      costPrice: null,
      sellingPrice: null,
      rowKey: `ROW-${index + 1}`,
      requestId: `00000000-0000-5000-8000-${String(index + 1).padStart(12, '0')}`,
      matchStatus: 'create' as const,
      matchedProductId: null,
    })),
  };
}

const idleAction = async (): Promise<OpeningStockImportActionState> => ({
  ok: false,
  error: 'not run',
});

describe('OpeningStockImportPanel', () => {
  it('shows the fixed 53-line / 725-tyre Regency Park contract and pending financial states', () => {
    render(
      <OpeningStockImportPanel
        preview={preview()}
        sourceQuantity={725}
        sha256={'a'.repeat(64)}
        action={idleAction}
      />,
    );

    expect(screen.getByText('53 product lines')).toBeInTheDocument();
    expect(screen.getByText('725 tyres')).toBeInTheDocument();
    expect(screen.getByText('Regency Park')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Cost pending')).toBeInTheDocument();
    expect(screen.getByText('Selling price pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make 725 tyres live' })).toBeEnabled();
    expect(screen.getByText(/not treated as \$0/)).toBeInTheDocument();
  });

  it('surfaces created, matched, posted, replayed and error report counts', async () => {
    const action = async (): Promise<OpeningStockImportActionState> => ({
      ok: false,
      error: '1 opening-stock row(s) failed.',
      report: {
        sourceRows: 53,
        sourceQuantity: 725,
        createdProducts: 40,
        matchedProducts: 12,
        postedRows: 52,
        postedQuantity: 724,
        replayedRows: 3,
        errors: [{ rowNumber: 54, rowKey: 'ROW-53', message: 'Example failure' }],
      },
    });

    render(
      <OpeningStockImportPanel
        preview={preview()}
        sourceQuantity={725}
        sha256={'b'.repeat(64)}
        action={action}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Make 725 tyres live' }));

    await waitFor(() => {
      expect(screen.getByText('Opening stock import needs attention')).toBeInTheDocument();
    });
    expect(screen.getByText('Created').parentElement).toHaveTextContent('Created40');
    expect(screen.getByText('Matched').parentElement).toHaveTextContent('Matched12');
    expect(screen.getByText('Posted rows').parentElement).toHaveTextContent('Posted rows52');
    expect(screen.getByText('Posted qty').parentElement).toHaveTextContent('Posted qty724');
    expect(screen.getByText('Replayed').parentElement).toHaveTextContent('Replayed3');
    expect(screen.getByText(/Example failure/)).toBeInTheDocument();
  });

  it('blocks Make Live when preview contains an ambiguous product identity', () => {
    const data = preview();
    data.ambiguousCount = 1;
    data.createCount = 52;
    data.rows[0] = { ...data.rows[0]!, matchStatus: 'ambiguous' };

    render(
      <OpeningStockImportPanel
        preview={data}
        sourceQuantity={725}
        sha256={'c'.repeat(64)}
        action={idleAction}
      />,
    );

    expect(screen.getByRole('button', { name: 'Make 725 tyres live' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Import is blocked/);
  });
});
