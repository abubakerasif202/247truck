import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFFont,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFTextField,
  StandardFonts,
  rgb,
} from 'pdf-lib';

import type { InvoiceAddress, InvoiceDocumentData, InvoiceDocumentLine } from './invoice-types';

export const AWT_INVOICE_TEMPLATE_PATH = 'public/invoice-templates/awt-invoice-template.pdf';
export const AWT_TEMPLATE_LINE_CAPACITY = 6;
const AWT_NAME = 'Adelaide Wholesale Tyres';
const AUTHORING_FOOTER = 'Fillable PDF invoice template';
const RED = rgb(0.937, 0.114, 0.153);
const INK = rgb(0.09, 0.098, 0.11);
const MUTED = rgb(0.439, 0.459, 0.482);
const BORDER = rgb(0.843, 0.855, 0.875);

const value = (source: Record<string, unknown> | null, ...keys: string[]) => {
  for (const key of keys) if (source?.[key] != null && String(source[key]).trim()) return String(source[key]).trim();
  return '';
};
const address = (source: InvoiceAddress) => [source.street_address, [source.suburb, source.state, source.postcode].filter(Boolean).join(' '), source.country].filter(Boolean).join(', ');
const customerName = (invoice: InvoiceDocumentData) => invoice.customer.display_name ?? invoice.customer.company_name ?? invoice.customer.legal_name ?? invoice.customer.label ?? 'Walk-In Customer';
const date = (source: string | null) => source ? source.split('-').reverse().join('/') : '';
const money = (source: string | null) => source == null ? '' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(source));

function decimalCents(source: string | null): bigint | null {
  if (source == null) return null;
  const match = source.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const result = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -result : result;
}

export function awtPaymentStatus(invoice: InvoiceDocumentData): 'Unpaid' | 'Part Paid' | 'Paid' {
  const total = decimalCents(invoice.total);
  const paid = decimalCents(invoice.amountPaid) ?? 0n;
  const balance = decimalCents(invoice.balanceDue);
  if (total !== null && total > 0n && balance !== null && balance <= 0n && paid >= total) return 'Paid';
  return paid > 0n ? 'Part Paid' : 'Unpaid';
}

function lineDescription(line: InvoiceDocumentLine): string {
  const tyre = line.tyre;
  const metadata = tyre ? [tyre.size, tyre.model].filter((item) => item && !line.description.toLowerCase().includes(String(item).toLowerCase())) : [];
  return [line.description, ...metadata].filter(Boolean).join(' · ');
}

export function awtInvoiceFieldValues(invoice: InvoiceDocumentData): Record<string, string> {
  const bank = invoice.business.bank_instructions ?? {};
  const customerEmail = invoice.customer.email ?? invoice.billingContact?.email ?? '';
  const customerPhone = invoice.customer.phone ?? invoice.billingContact?.phone ?? '';
  const fields: Record<string, string> = {
    invoice_number: invoice.invoiceNumber,
    invoice_date: date(invoice.issueDate),
    due_date: date(invoice.dueDate),
    payment_status: awtPaymentStatus(invoice),
    business_abn: invoice.business.abn ?? '',
    business_email: invoice.business.shared_email ?? invoice.business.email ?? '',
    business_address: address(invoice.business),
    customer_name: customerName(invoice),
    customer_address: address(invoice.customer),
    customer_phone: customerPhone,
    customer_email: customerEmail,
    po_number: invoice.customerReference ?? '',
    vehicle_rego: value(invoice.vehicle, 'registration', 'rego'),
    salesperson: value(invoice.job, 'salesperson', 'salesperson_name', 'responsible_staff_name'),
    account_name: value(bank, 'account_name') || AWT_NAME,
    bank_name: value(bank, 'bank_name', 'bank'),
    bsb: value(bank, 'bsb'),
    account_number: value(bank, 'account_number', 'account_no'),
    notes: [value(bank, 'instructions', 'notes'), invoice.business.invoice_footer].filter(Boolean).join('\n'),
    subtotal: money(invoice.subtotal),
    discount: money(invoice.discount),
    gst_total: money(invoice.gst),
    invoice_total: money(invoice.total),
    amount_paid: money(invoice.amountPaid),
    balance_due: money(invoice.balanceDue),
  };
  invoice.lines.slice(0, AWT_TEMPLATE_LINE_CAPACITY).forEach((line, index) => {
    const row = index + 1;
    fields[`item_${row}_description`] = lineDescription(line);
    fields[`item_${row}_qty`] = line.quantity;
    fields[`item_${row}_unit_price`] = money(line.unitPrice);
    fields[`item_${row}_gst`] = money(line.gstAmount);
    fields[`item_${row}_amount`] = money(line.total ?? line.amount);
  });
  return fields;
}

function removeAuthoringFooter(pdf: PDFDocument): void {
  const page = pdf.getPage(0);
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const replacements = refs.map((item) => {
    const raw = pdf.context.lookup(item as PDFRef) as PDFRawStream;
    const decoded = Buffer.from(decodePDFRawStream(raw).decode()).toString('latin1');
    const cleaned = decoded.replace(`(${AUTHORING_FOOTER}) Tj`, '() Tj');
    return pdf.context.register(pdf.context.flateStream(Buffer.from(cleaned, 'latin1')));
  });
  page.node.set(PDFName.of('Contents'), replacements.length === 1 ? replacements[0] : pdf.context.obj(replacements));
}

function fitField(field: PDFTextField, text: string, font: PDFFont): void {
  const width = field.acroField.getWidgets()[0]?.getRectangle().width ?? 100;
  let size = 9;
  while (size > 6 && font.widthOfTextAtSize(text, size) > width - 7) size -= 0.5;
  let fitted = text;
  while (fitted.length > 1 && font.widthOfTextAtSize(fitted, size) > width - 7) fitted = `${fitted.slice(0, -2)}…`;
  field.setFontSize(size);
  field.setText(fitted);
}

function drawTextFit(page: ReturnType<PDFDocument['addPage']>, text: string, font: PDFFont, options: { x: number; y: number; width: number; size?: number; color?: ReturnType<typeof rgb>; bold?: PDFFont }): void {
  const drawFont = options.bold ?? font;
  let size = options.size ?? 8;
  let fitted = text;
  while (size > 6 && drawFont.widthOfTextAtSize(fitted, size) > options.width) size -= 0.5;
  while (fitted.length > 1 && drawFont.widthOfTextAtSize(fitted, size) > options.width) fitted = `${fitted.slice(0, -2)}…`;
  page.drawText(fitted, { x: options.x, y: options.y, size, font: drawFont, color: options.color ?? INK });
}

function drawContinuationTable(page: ReturnType<PDFDocument['addPage']>, lines: InvoiceDocumentLine[], font: PDFFont, bold: PDFFont, startY: number): number {
  const columns = [35, 283, 329, 407, 469, 560];
  page.drawRectangle({ x: 35, y: startY, width: 525, height: 25, color: INK });
  [['DESCRIPTION / TYRE SIZE / PATTERN', 42], ['QTY', 292], ['UNIT PRICE', 337], ['GST', 424], ['AMOUNT', 487]].forEach(([label, x]) => page.drawText(String(label), { x: Number(x), y: startY + 8, size: 7.5, font: bold, color: rgb(1, 1, 1) }));
  lines.forEach((line, index) => {
    const y = startY - 29 - index * 29;
    page.drawRectangle({ x: 35, y, width: 525, height: 25, borderColor: BORDER, borderWidth: 0.8 });
    for (const x of columns.slice(1, -1)) page.drawLine({ start: { x, y }, end: { x, y: y + 25 }, color: BORDER, thickness: 0.8 });
    drawTextFit(page, lineDescription(line), font, { x: 41, y: y + 9, width: 236 });
    drawTextFit(page, line.quantity, font, { x: 290, y: y + 9, width: 32 });
    drawTextFit(page, money(line.unitPrice), font, { x: 335, y: y + 9, width: 66 });
    drawTextFit(page, money(line.gstAmount), font, { x: 413, y: y + 9, width: 50 });
    drawTextFit(page, money(line.total ?? line.amount), font, { x: 475, y: y + 9, width: 78, bold });
  });
  return startY - 29 - lines.length * 29;
}

function drawTotals(page: ReturnType<PDFDocument['addPage']>, invoice: InvoiceDocumentData, font: PDFFont, bold: PDFFont): void {
  const rows: [string, string][] = [['SUBTOTAL', money(invoice.subtotal)], ['DISCOUNT', money(invoice.discount)], ['GST', money(invoice.gst)], ['TOTAL', money(invoice.total)], ['AMOUNT PAID', money(invoice.amountPaid)], ['BALANCE DUE', money(invoice.balanceDue)]];
  page.drawRectangle({ x: 365, y: 72, width: 195, height: 155, color: rgb(0.961, 0.965, 0.969) });
  rows.forEach(([label, amount], index) => {
    const y = 205 - index * 23;
    const isStrong = label === 'TOTAL' || label === 'BALANCE DUE';
    page.drawText(label, { x: 378, y, size: isStrong ? 9 : 8, font: bold, color: isStrong ? RED : INK });
    drawTextFit(page, amount, font, { x: 472, y, width: 78, size: 8, bold: isStrong ? bold : undefined });
  });
}

function wrappedLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) result.push(line);
      line = '';
      let fragment = '';
      for (const character of word) {
        if (font.widthOfTextAtSize(fragment + character, size) > width && fragment) { result.push(fragment); fragment = character; }
        else fragment += character;
      }
      line = fragment;
    }
    result.push(line);
  }
  return result;
}

function addServiceDetailsPages(pdf: PDFDocument, invoice: InvoiceDocumentData, font: PDFFont, bold: PDFFont): void {
  const rows = [
    ...(invoice.extraDescription?.trim() ? [['Extra Description', invoice.extraDescription.trim()] as const] : []),
    ...(invoice.lines.some((line) => line.torqueNm && Number(line.torqueNm) > 0)
      ? [['Torque by service line', invoice.lines.filter((line) => line.torqueNm && Number(line.torqueNm) > 0).map((line) => `${line.description}: ${line.torqueNm} Nm`).join('\n')] as const] : []),
    ...(invoice.customerNotes?.trim() ? [['Notes', invoice.customerNotes.trim()] as const] : []),
  ];
  if (!rows.length) return;

  const pageWidth = 595.2756;
  let page = pdf.addPage([pageWidth, 841.8898]);
  let y = 790;
  const newPage = () => {
    page.drawLine({ start: { x: 35, y: 31 }, end: { x: 560, y: 31 }, color: BORDER, thickness: 1 });
    page.drawText('Adelaide Wholesale Tyres', { x: 35, y: 18, size: 7.2, font, color: MUTED });
    page = pdf.addPage([pageWidth, 841.8898]);
    y = 790;
    page.drawText('SERVICE DETAILS / NOTES', { x: 35, y, size: 16, font: bold, color: INK });
    page.drawText(`Invoice no. ${invoice.invoiceNumber}`, { x: 35, y: y - 24, size: 9, font: bold, color: RED });
    y -= 54;
  };
  page.drawText('SERVICE DETAILS / NOTES', { x: 35, y, size: 16, font: bold, color: INK });
  page.drawText(`Invoice no. ${invoice.invoiceNumber}`, { x: 35, y: y - 24, size: 9, font: bold, color: RED });
  y -= 54;
  for (const [label, content] of rows) {
    const lines = wrappedLines(content, font, 9, 520);
    if (y < 65) newPage();
    page.drawRectangle({ x: 35, y: y - 22, width: 525, height: 22, color: rgb(0.961, 0.965, 0.969) });
    page.drawText(label.toUpperCase(), { x: 43, y: y - 15, size: 8, font: bold, color: INK });
    y -= 34;
    for (const line of lines) {
      if (y < 48) newPage();
      page.drawText(line, { x: 43, y, size: 9, font, color: INK });
      y -= 13;
    }
    y -= 12;
  }
  page.drawLine({ start: { x: 35, y: 31 }, end: { x: 560, y: 31 }, color: BORDER, thickness: 1 });
  page.drawText('Adelaide Wholesale Tyres', { x: 35, y: 18, size: 7.2, font, color: MUTED });
}

async function addContinuationPages(pdf: PDFDocument, source: PDFDocument, invoice: InvoiceDocumentData, font: PDFFont, bold: PDFFont): Promise<void> {
  const remaining = invoice.lines.slice(AWT_TEMPLATE_LINE_CAPACITY);
  if (!remaining.length) return;
  const header = await pdf.embedPage(source.getPage(0), { left: 0, bottom: 650, right: 595.2756, top: 841.8898 });
  const chunks = Array.from({ length: Math.ceil(remaining.length / 12) }, (_, index) => remaining.slice(index * 12, index * 12 + 12));
  chunks.forEach((lines, index) => {
    const page = pdf.addPage([595.2756, 841.8898]);
    page.drawPage(header, { x: 0, y: 650, width: 595.2756, height: 191.8898 });
    page.drawRectangle({ x: 320, y: 650, width: 245, height: 150, color: rgb(1, 1, 1) });
    page.drawText('INVOICE CONTINUED', { x: 365, y: 720, size: 16, font: bold, color: INK });
    page.drawText(`Invoice no. ${invoice.invoiceNumber}`, { x: 365, y: 698, size: 9, font: bold, color: RED });
    page.drawText(`Customer: ${customerName(invoice)}`, { x: 35, y: 635, size: 10, font: bold, color: INK });
    page.drawText(`Page ${index + 2} of ${chunks.length + 1}`, { x: 475, y: 635, size: 8, font, color: MUTED });
    drawContinuationTable(page, lines, font, bold, 595);
    if (index === chunks.length - 1) drawTotals(page, invoice, font, bold);
    page.drawLine({ start: { x: 35, y: 31 }, end: { x: 560, y: 31 }, color: BORDER, thickness: 1 });
    page.drawText('Thank you for choosing Adelaide Wholesale Tyres. Please quote the invoice number with payment.', { x: 35, y: 18, size: 7.2, font, color: MUTED });
  });
}

export async function renderAwtInvoicePdf(invoice: InvoiceDocumentData): Promise<Buffer> {
  const templateBytes = await readFile(path.resolve(process.cwd(), AWT_INVOICE_TEMPLATE_PATH));
  const [pdf, source] = await Promise.all([PDFDocument.load(templateBytes), PDFDocument.load(templateBytes)]);
  removeAuthoringFooter(pdf);
  removeAuthoringFooter(source);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();
  const values = awtInvoiceFieldValues(invoice);
  for (const [name, text] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) continue;
    if (name === 'payment_status') form.getDropdown(name).select(text);
    else fitField(form.getTextField(name), text, font);
  }
  form.updateFieldAppearances(font);
  form.flatten();
  const firstPage = pdf.getPage(0);
  firstPage.drawRectangle({ x: 458, y: 10, width: 110, height: 18, color: rgb(1, 1, 1) });
  if (invoice.lines.length > AWT_TEMPLATE_LINE_CAPACITY) {
    firstPage.drawRectangle({ x: 365, y: 78, width: 201, height: 171, color: rgb(1, 1, 1) });
    firstPage.drawText('CONTINUED ON NEXT PAGE', { x: 395, y: 155, size: 10, font: bold, color: RED });
  }
  if (invoice.status === 'draft') firstPage.drawText('DRAFT — NOT ISSUED', { x: 390, y: 680, size: 10, font: bold, color: RED });
  await addContinuationPages(pdf, source, invoice, font, bold);
  addServiceDetailsPages(pdf, invoice, font, bold);
  pdf.setTitle(`Tax Invoice ${invoice.invoiceNumber}`);
  pdf.setAuthor(AWT_NAME);
  pdf.setSubject('Customer tax invoice');
  pdf.setCreator('247 Truck Tyre Services inventory application');
  pdf.setProducer('pdf-lib');
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
