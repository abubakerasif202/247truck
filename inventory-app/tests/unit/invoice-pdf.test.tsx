// @vitest-environment node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';

import { awtInvoiceFieldValues, awtPaymentStatus, AWT_INVOICE_TEMPLATE_PATH, AWT_TEMPLATE_LINE_CAPACITY } from '@/lib/documents/awt-invoice-pdf';
import { invoice10602Fixture } from '@/lib/documents/invoice-fixture-10602';
import { renderInvoicePdf } from '@/lib/documents/render-invoice-pdf';
import type { InvoiceDocumentData } from '@/lib/documents/invoice-types';

const awtBase: InvoiceDocumentData = {
  ...invoice10602Fixture,
  brand: 'awt', invoiceNumber: 'AWT-00010602', issueDate: '2026-09-16', dueDate: '2026-09-30', customerReference: 'PO-7788',
  business: {
    brand: 'awt', business_name: 'Adelaide Wholesale Tyres', abn: '12345678901', street_address: '10 Test Road', suburb: 'Lonsdale', state: 'SA', postcode: '5160',
    phone: '+61 478 827 017', shared_email: 'accounts@awt.example', website: 'adelaidewholesaletyres.com.au',
    bank_instructions: { account_name: 'Adelaide Wholesale Tyres', bank_name: 'Configured Bank', bsb: '111-222', account_number: '12345678', instructions: 'Use invoice number as reference.' },
  },
  customer: { display_name: 'Snapshot Fleet Pty Ltd', street_address: '20 Frozen Street', suburb: 'Adelaide', state: 'SA', postcode: '5000', phone: '0400000000', email: 'frozen@example.test' },
  vehicle: { registration: 'AWT123' }, job: { salesperson_name: 'Stored Staff' },
};

async function pdfText(pdf: Buffer): Promise<{ text: string; pages: number }> {
  const fontsDir = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/') + '/';
  const document = await getDocument({
    data: new Uint8Array(pdf),
    standardFontDataUrl: fontsDir,
  }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const content = await (await document.getPage(index)).getTextContent();
    pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
  }
  return { text: pages.join('\n'), pages: document.numPages };
}

const rendered: Record<string, Buffer> = {};

beforeAll(async () => {
  const variants: Record<string, InvoiceDocumentData> = {
    'awt-unpaid': awtBase,
    'awt-part-paid': { ...awtBase, amountPaid: '1000.00', balanceDue: '2476.00' },
    'awt-paid': { ...awtBase, amountPaid: '3476.00', balanceDue: '0.00' },
    'awt-continuation': { ...awtBase, lines: Array.from({ length: 19 }, (_, index) => ({ ...awtBase.lines[index % awtBase.lines.length]!, id: `awt-line-${index + 1}`, description: `Immutable invoice line ${index + 1}` })) },
    '247-existing-template': invoice10602Fixture,
  };
  const output = path.resolve(process.cwd(), '.test-results/invoice-pdfs');
  await mkdir(output, { recursive: true });
  await Promise.all(Object.entries(variants).map(async ([name, invoice]) => {
    const pdf = await renderInvoicePdf(invoice);
    rendered[name] = pdf;
    await writeFile(path.join(output, `${name}.pdf`), pdf);
  }));
}, 30_000);

describe('invoice PDF brand routing', () => {
  it('keeps bytes stable for an unchanged issued revision so email retries reuse their payload fingerprint', async () => {
    const first = await renderInvoicePdf(invoice10602Fixture);
    const second = await renderInvoicePdf(invoice10602Fixture);

    expect(second).toEqual(first);
  }, 15_000);

  it('paginates a long 24/7 item list without failing', async () => {
    const invoice = {
      ...invoice10602Fixture,
      lines: Array.from({ length: 70 }, (_, index) => ({
        ...invoice10602Fixture.lines[0],
        id: String(index),
        description: `Tyre service line ${index + 1} with a long description that must remain readable`,
      })),
    };
    const parsed = await pdfText(await renderInvoicePdf(invoice));

    expect(parsed.pages).toBeGreaterThan(1);
    expect(parsed.text).toContain('Tyre service line 1');
    expect(parsed.text).toContain('Tyre service line 70');
  }, 15_000);

  it('keeps the existing 24/7 renderer for 24/7 invoices', async () => {
    const parsed = await pdfText(rendered['247-existing-template']!);
    expect(rendered['247-existing-template']!.subarray(0, 5).toString()).toBe('%PDF-');
    expect(parsed.text).toContain('24/7 Truck Tyre Services');
    expect(parsed.text).not.toContain('adelaidewholesaletyres.com.au');
  });

  it('uses the controlled AWT template and flattens editable fields', async () => {
    const pdf = await PDFDocument.load(rendered['awt-unpaid']!);
    expect(AWT_INVOICE_TEMPLATE_PATH).toBe('public/invoice-templates/awt-invoice-template.pdf');
    expect(pdf.getPages()[0]!.getSize()).toEqual({ width: 595.2756, height: 841.8898 });
    expect(pdf.getForm().getFields()).toHaveLength(0);
  });

  it('preserves AWT identity artwork and removes template-authoring text', async () => {
    const parsed = await pdfText(rendered['awt-unpaid']!);
    expect(parsed.text).toContain('ADELAIDE WHOLESALE TYRES');
    expect(parsed.text).toContain('adelaidewholesaletyres.com.au');
    expect(parsed.text).toContain('+61 478 827 017');
    expect(parsed.text).toContain('TAX INVOICE');
    expect(parsed.text).not.toContain('Fillable PDF invoice template');
  });
});

describe('AWT invoice template mapping', () => {
  it('maps immutable customer, reference, vehicle, dates, lines, totals and configured payment details', () => {
    const fields = awtInvoiceFieldValues(awtBase);
    expect(fields).toMatchObject({
      invoice_number: 'AWT-00010602', invoice_date: '16/09/2026', due_date: '30/09/2026', payment_status: 'Unpaid',
      customer_name: 'Snapshot Fleet Pty Ltd', customer_address: '20 Frozen Street, Adelaide SA 5000', customer_phone: '0400000000', customer_email: 'frozen@example.test',
      po_number: 'PO-7788', vehicle_rego: 'AWT123', salesperson: 'Stored Staff',
      item_1_qty: '8', item_1_unit_price: '$390.00', item_1_gst: '$312.00', item_1_amount: '$3,432.00',
      subtotal: '$3,160.00', discount: '$0.00', gst_total: '$316.00', invoice_total: '$3,476.00', amount_paid: '$0.00', balance_due: '$3,476.00',
      account_name: 'Adelaide Wholesale Tyres', bank_name: 'Configured Bank', bsb: '111-222', account_number: '12345678', notes: 'Use invoice number as reference.',
    });
    expect(fields.item_1_description).toContain('Greforce HD02 11R 22.5 Drive');
  });

  it('leaves absent optional values blank and preserves the template account identity', () => {
    const fields = awtInvoiceFieldValues({ ...awtBase, customerReference: null, vehicle: null, job: null, business: { ...awtBase.business, bank_instructions: null } });
    expect(fields).toMatchObject({ po_number: '', vehicle_rego: '', salesperson: '', bank_name: '', bsb: '', account_number: '', notes: '', account_name: 'Adelaide Wholesale Tyres' });
  });

  it('derives payment status only from canonical financial projections', () => {
    expect(awtPaymentStatus(awtBase)).toBe('Unpaid');
    expect(awtPaymentStatus({ ...awtBase, amountPaid: '1000.00', balanceDue: '2476.00' })).toBe('Part Paid');
    expect(awtPaymentStatus({ ...awtBase, amountPaid: '3476.00', balanceDue: '0.00' })).toBe('Paid');
    expect(awtPaymentStatus({ ...awtBase, amountPaid: '1000.00', balanceDue: '0.00' })).not.toBe('Paid');
  });

  it('uses the snapshotted AWT brand even when current workspace data is unavailable', async () => {
    const parsed = await pdfText(await renderInvoicePdf({ ...awtBase, brand: undefined, business: { ...awtBase.business, brand: 'awt' } }));
    expect(parsed.text).toContain('ADELAIDE WHOLESALE TYRES');
  });

  it('creates continuation pages without dropping items', async () => {
    const parsed = await pdfText(rendered['awt-continuation']!);
    expect(parsed.pages).toBe(3);
    expect(AWT_TEMPLATE_LINE_CAPACITY).toBe(6);
    for (let index = 1; index <= 19; index += 1) expect(parsed.text).toContain(`Immutable invoice line ${index}`);
    expect(parsed.text).toContain('INVOICE CONTINUED');
    expect(parsed.text).not.toContain('Fillable PDF invoice template');
  });
});
