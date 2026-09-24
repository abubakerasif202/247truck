// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { quoteDocumentFromDetail } from '@/lib/documents/quote-types';
import { renderQuotePdf } from '@/lib/documents/render-quote-pdf';

const detail = {
  id: '00000000-0000-4000-8000-000000000001', quote_number: 'REG-QUO-000001', status: 'draft', created_at: '2026-09-14T00:00:00Z', expiry_date: '2026-09-30', location_name: 'Regency Park',
  customer_snapshot: { display_name: 'Walk-in customer' }, contact_snapshot: { name: 'Alex', email: null, phone: '0400000000' },
  business_snapshot: { business_name: '24/7 Truck Tyre Services' }, branch_snapshot: { branch_name: 'Regency Park' },
  lines: [{ id: 'line-1', description: 'Greforce G-ARMOR 11R22.5', quantity: 2, unit_price_incl_gst: '230.00', line_total_incl_gst: '460.00', pricing_tier: 'retail', product_snapshot: { brand_name: 'Greforce', pattern_name: 'G-ARMOR', size_name: '11R22.5' } }], subtotal_ex_gst: '418.18', gst_amount: '41.82', total_incl_gst: '460.00', customer_notes: 'Please call when ready',
};

describe('quote PDF', () => {
  it('embeds the supplied 24/7 logo for branded quotes', async () => {
    const quote = quoteDocumentFromDetail({ ...detail, business_snapshot: { ...detail.business_snapshot, logo_asset_path: '/brand/logo-real-horizontal.png' } });
    const pdf = await renderQuotePdf(quote);
    expect(pdf.length).toBeGreaterThan(50_000);
  }, 15_000);

  it('renders a customer quote without internal pricing fields', async () => {
    const quote = quoteDocumentFromDetail(detail);
    const pdf = await renderQuotePdf(quote);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(3_000);
    expect(quote.lines[0]).toMatchObject({ unitPrice: '230.00', amount: '460.00', pricingTier: 'retail' });
    expect(JSON.stringify(quote)).not.toContain('weighted_average_cost');
    expect(JSON.stringify(quote)).not.toContain('wholesale_price');
  }, 15_000);

  it('uses immutable quoted line prices after a master price change', () => {
    const quote = quoteDocumentFromDetail({ ...detail, lines: [{ ...detail.lines[0], unit_price_incl_gst: '230.00', product_snapshot: { brand_name: 'Greforce', size_name: '11R22.5', current_retail_price: '999.00' } }] });
    expect(quote.lines[0].unitPrice).toBe('230.00');
    expect(quote.lines[0].amount).toBe('460.00');
  });
  it('renders optional multiline service details and recorded torque, omitting absent torque', async () => {
    const quote = quoteDocumentFromDetail({
      ...detail, extra_description: 'Additional service detail\nSecond line',
      lines: [{ ...detail.lines[0], torque_nm: '650.25' }, { ...detail.lines[0], id: 'line-2', description: 'Inspection', torque_nm: null }, { ...detail.lines[0], id: 'line-3', description: 'No torque', torque_nm: '0' }],
    });
    expect(quote.lines.map((line) => line.torqueNm)).toEqual(['650.25', null, null]);
    expect(quote.extraDescription).toContain('\n');
    const pdf = await renderQuotePdf(quote);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(3_000);
  }, 15_000);
});
