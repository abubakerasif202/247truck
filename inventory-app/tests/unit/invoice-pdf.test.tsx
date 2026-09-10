// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { invoice10602Fixture } from '@/lib/documents/invoice-fixture-10602';
import { renderInvoicePdf } from '@/lib/documents/render-invoice-pdf';

describe('invoice PDF', () => {
  it('renders the Invoice 10602 fixture as a valid A4 PDF', async () => {
    const pdf = await renderInvoicePdf(invoice10602Fixture);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
    expect(invoice10602Fixture.lines.map((line) => Number(line.quantity) * Number(line.unitPrice))).toEqual([3120, 40]);
    expect(invoice10602Fixture.subtotal).toBe('3160.00');
    expect(invoice10602Fixture.gst).toBe('316.00');
    expect(invoice10602Fixture.total).toBe('3476.00');
  }, 15_000);

  it('paginates a long item list without failing', async () => {
    const invoice = {
      ...invoice10602Fixture,
      lines: Array.from({ length: 70 }, (_, index) => ({
        ...invoice10602Fixture.lines[0], id: String(index), description: `Tyre service line ${index + 1} with a long description that must remain readable`,
      })),
    };
    const pdf = await renderInvoicePdf(invoice);
    const source = pdf.toString('latin1');
    expect(source.match(/\/Type \/Page\b/g)?.length ?? 0).toBeGreaterThan(1);
  }, 15_000);
});
