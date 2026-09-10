import 'server-only';

import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

import type { InvoiceAddress, InvoiceDocumentData, InvoiceDocumentLine } from './invoice-types';

const RED = '#c91f2c';
const INK = '#20242a';
const MUTED = '#667085';
const BORDER = '#d9dde3';

const styles = StyleSheet.create({
  page: { paddingTop: 34, paddingHorizontal: 38, paddingBottom: 48, fontFamily: 'Helvetica', fontSize: 9, color: INK },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 18, borderBottomWidth: 2, borderBottomColor: RED },
  logo: { width: 150, height: 46, objectFit: 'contain', objectPosition: 'left center' },
  brandName: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: RED, maxWidth: 230 },
  title: { fontSize: 23, fontFamily: 'Helvetica-Bold', letterSpacing: 0.7, textAlign: 'right' },
  number: { marginTop: 4, fontSize: 12, color: RED, textAlign: 'right' },
  draft: { marginTop: 6, fontSize: 9, color: RED, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  metaGrid: { flexDirection: 'row', gap: 22, marginTop: 18, marginBottom: 18 },
  metaColumn: { flexGrow: 1, flexBasis: 0 },
  label: { color: MUTED, fontSize: 7.5, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 },
  partyName: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  line: { marginBottom: 2, lineHeight: 1.35 },
  dates: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  dateLabel: { color: MUTED },
  dateValue: { fontFamily: 'Helvetica-Bold' },
  jobBox: { borderWidth: 1, borderColor: BORDER, borderRadius: 3, padding: 10, marginBottom: 16 },
  jobGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  jobCell: { width: '31%' },
  jobValue: { fontFamily: 'Helvetica-Bold', marginTop: 2 },
  table: { marginTop: 2 },
  tableHeader: { flexDirection: 'row', backgroundColor: INK, color: '#ffffff', paddingVertical: 7, paddingHorizontal: 6, fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 8, paddingHorizontal: 6, minHeight: 31 },
  description: { width: '45%', paddingRight: 7 },
  qty: { width: '10%', textAlign: 'right' },
  unit: { width: '15%', textAlign: 'right' },
  discount: { width: '13%', textAlign: 'right' },
  amount: { width: '17%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  descriptionMain: { fontFamily: 'Helvetica-Bold', lineHeight: 1.35 },
  descriptionDetail: { color: MUTED, fontSize: 7.5, marginTop: 3, lineHeight: 1.3 },
  totalsWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  totals: { width: 230 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalStrong: { borderTopWidth: 1, borderTopColor: BORDER, marginTop: 2, paddingTop: 7, fontFamily: 'Helvetica-Bold', fontSize: 11 },
  balance: { marginTop: 7, padding: 10, backgroundColor: RED, color: '#ffffff', flexDirection: 'row', justifyContent: 'space-between', fontFamily: 'Helvetica-Bold', fontSize: 12 },
  payment: { marginTop: 18, paddingTop: 13, borderTopWidth: 1, borderTopColor: BORDER, flexDirection: 'row', gap: 22 },
  paymentColumn: { width: '48%' },
  notes: { marginTop: 13, color: MUTED, lineHeight: 1.4 },
  footer: { position: 'absolute', bottom: 22, left: 38, right: 38, flexDirection: 'row', justifyContent: 'space-between', color: MUTED, fontSize: 7.5 },
});

const money = (value: string | null) => value == null ? 'PRICE PENDING' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value));
const date = (value: string | null) => value ? new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Adelaide' }).format(new Date(`${value}T00:00:00+09:30`)) : '—';
const value = (source: Record<string, unknown> | null, key: string) => source?.[key] == null ? null : String(source[key]);
const addressLines = (address: InvoiceAddress) => [address.street_address, [address.suburb, address.state, address.postcode].filter(Boolean).join(' '), address.country].filter(Boolean) as string[];

function LineDescription({ line }: { line: InvoiceDocumentLine }) {
  const tyre = line.tyre;
  const details = tyre ? [tyre.brand, tyre.model, tyre.size, tyre.position && `Position: ${tyre.position}`, tyre.serial_dot && `DOT: ${tyre.serial_dot}`].filter(Boolean).join(' · ') : '';
  return <View style={styles.description}><Text style={styles.descriptionMain}>{line.description}</Text>{details ? <Text style={styles.descriptionDetail}>{details}</Text> : null}</View>;
}

export function InvoicePdfDocument({ invoice, logoSource }: { invoice: InvoiceDocumentData; logoSource?: string | null }) {
  const businessName = invoice.business.business_name ?? invoice.business.display_name ?? '24/7 Truck Tyre Services';
  const customerName = invoice.customer.display_name ?? invoice.customer.company_name ?? invoice.customer.legal_name ?? invoice.customer.label ?? 'Walk-In Customer';
  const bank = invoice.business.bank_instructions ?? {};
  const vehicleFields = [
    ['Registration', value(invoice.vehicle, 'registration')], ['Fleet / vehicle', value(invoice.vehicle, 'fleet_number') ?? value(invoice.vehicle, 'fleet_identifier')],
    ['Odometer', (value(invoice.job, 'odometer_km') ?? value(invoice.vehicle, 'odometer_km')) ? `${value(invoice.job, 'odometer_km') ?? value(invoice.vehicle, 'odometer_km')} km` : null], ['Service date', date(value(invoice.job, 'service_date') ?? value(invoice.vehicle, 'service_date'))],
    ['Tyre position', value(invoice.job, 'tyre_position') ?? value(invoice.vehicle, 'tyre_position') ?? value(invoice.vehicle, 'position')], ['Job / technician ref', value(invoice.job, 'job_number') ?? value(invoice.job, 'technician_reference')],
  ].filter((entry) => entry[1] && entry[1] !== '—');

  return <Document title={`Tax Invoice ${invoice.invoiceNumber}`} author={businessName} subject="Tax invoice">
    <Page size="A4" style={styles.page} wrap>
      <View style={styles.header} fixed>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- React PDF Image has no HTML alt prop. */}
        <View>{logoSource ? <Image src={logoSource} style={styles.logo} /> : <Text style={styles.brandName}>{businessName}</Text>}</View>
        <View><Text style={styles.title}>TAX INVOICE</Text><Text style={styles.number}>#{invoice.invoiceNumber}{invoice.revisionNumber > 1 ? ` · Revision ${invoice.revisionNumber}` : ''}</Text>{invoice.status === 'draft' ? <Text style={styles.draft}>DRAFT — NOT ISSUED</Text> : null}</View>
      </View>

      <View style={styles.metaGrid}>
        <View style={styles.metaColumn}><Text style={styles.label}>From</Text><Text style={styles.partyName}>{businessName}</Text>{invoice.business.abn ? <Text style={styles.line}>ABN {invoice.business.abn}</Text> : null}{addressLines(invoice.business).map((item) => <Text key={item} style={styles.line}>{item}</Text>)}<Text style={styles.line}>{invoice.business.phone ?? invoice.branch.phone ?? ''}</Text><Text style={styles.line}>{invoice.business.shared_email ?? invoice.branch.contact_email ?? ''}</Text></View>
        <View style={styles.metaColumn}><Text style={styles.label}>Bill to</Text><Text style={styles.partyName}>{customerName}</Text>{invoice.customer.abn ? <Text style={styles.line}>ABN {invoice.customer.abn}</Text> : null}{addressLines(invoice.customer).map((item) => <Text key={item} style={styles.line}>{item}</Text>)}{invoice.billingContact ? <Text style={styles.line}>{[invoice.billingContact.display_name, invoice.billingContact.email, invoice.billingContact.phone].filter(Boolean).join(' · ')}</Text> : null}{invoice.customerReference ? <Text style={styles.line}>Reference: {invoice.customerReference}</Text> : null}</View>
        <View style={styles.metaColumn}><View style={styles.dates}><Text style={styles.dateLabel}>Issue date</Text><Text style={styles.dateValue}>{date(invoice.issueDate)}</Text></View><View style={styles.dates}><Text style={styles.dateLabel}>Due date</Text><Text style={styles.dateValue}>{date(invoice.dueDate)}</Text></View><View style={styles.dates}><Text style={styles.dateLabel}>Terms</Text><Text style={styles.dateValue}>{invoice.paymentTerms?.replaceAll('_', ' ') ?? '—'}</Text></View><View style={styles.dates}><Text style={styles.dateLabel}>Payment method</Text><Text style={styles.dateValue}>{invoice.paymentMethod?.replaceAll('_', ' ') ?? '—'}</Text></View></View>
      </View>

      {vehicleFields.length ? <View style={styles.jobBox} wrap={false}><Text style={styles.label}>Vehicle & job details</Text><View style={styles.jobGrid}>{vehicleFields.map(([label, item]) => <View key={label} style={styles.jobCell}><Text style={styles.dateLabel}>{label}</Text><Text style={styles.jobValue}>{item}</Text></View>)}</View></View> : null}

      <View style={styles.table}>
        <View style={styles.tableHeader} fixed><Text style={styles.description}>Description</Text><Text style={styles.qty}>Qty</Text><Text style={styles.unit}>Unit price</Text><Text style={styles.discount}>Discount</Text><Text style={styles.amount}>Amount</Text></View>
        {invoice.lines.map((line) => <View key={line.id} style={styles.tableRow} wrap={false}><LineDescription line={line}/><Text style={styles.qty}>{line.quantity}</Text><Text style={styles.unit}>{money(line.unitPrice)}</Text><Text style={styles.discount}>{Number(line.discountPercent) ? `${line.discountPercent}%` : '—'}</Text><Text style={styles.amount}>{money(line.amount)}</Text></View>)}
      </View>

      <View style={styles.totalsWrap} wrap={false}><View style={styles.totals}><View style={styles.totalRow}><Text>Subtotal (ex GST)</Text><Text>{money(invoice.subtotal)}</Text></View><View style={styles.totalRow}><Text>GST</Text><Text>{money(invoice.gst)}</Text></View><View style={[styles.totalRow, styles.totalStrong]}><Text>Total</Text><Text>{money(invoice.total)}</Text></View><View style={styles.totalRow}><Text>Amount paid</Text><Text>{money(invoice.amountPaid)}</Text></View><View style={styles.balance}><Text>BALANCE DUE</Text><Text>{money(invoice.balanceDue)}</Text></View></View></View>

      <View style={styles.payment} wrap={false}><View style={styles.paymentColumn}><Text style={styles.label}>Payment instructions</Text>{Object.entries(bank).filter(([, item]) => item).map(([key, item]) => <Text key={key} style={styles.line}>{key.replaceAll('_', ' ')}: {String(item)}</Text>)}</View><View style={styles.paymentColumn}><Text style={styles.label}>Notes & terms</Text>{invoice.customerNotes ? <Text style={styles.line}>{invoice.customerNotes}</Text> : null}{invoice.business.invoice_footer ? <Text style={styles.notes}>{invoice.business.invoice_footer}</Text> : null}{invoice.branch.document_footer ? <Text style={styles.notes}>{invoice.branch.document_footer}</Text> : null}</View></View>

      <View style={styles.footer} fixed><Text>{businessName} · Tax Invoice #{invoice.invoiceNumber}</Text><Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} /></View>
    </Page>
  </Document>;
}
