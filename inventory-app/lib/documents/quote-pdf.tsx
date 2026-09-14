import 'server-only';

import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { QuoteDocumentData, QuoteDocumentLine, QuoteDocumentParty } from './quote-types';

/* React PDF's Image component does not accept the DOM alt prop. */
/* eslint-disable jsx-a11y/alt-text */

const RED = '#c91f2c';
const INK = '#20242a';
const MUTED = '#667085';
const BORDER = '#d9dde3';
const styles = StyleSheet.create({
  page: { paddingTop: 34, paddingHorizontal: 38, paddingBottom: 44, fontFamily: 'Helvetica', fontSize: 9, color: INK },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 18, borderBottomWidth: 2, borderBottomColor: RED },
  logo: { width: 150, height: 46, objectFit: 'contain', objectPosition: 'left center' },
  brand: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: RED, maxWidth: 230 },
  title: { fontSize: 23, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  number: { marginTop: 4, fontSize: 12, color: RED, textAlign: 'right' },
  meta: { flexDirection: 'row', gap: 22, marginTop: 18, marginBottom: 18 },
  column: { flexGrow: 1, flexBasis: 0 },
  label: { color: MUTED, fontSize: 7.5, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 },
  party: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  line: { marginBottom: 2, lineHeight: 1.35 },
  dates: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  dateLabel: { color: MUTED },
  dateValue: { fontFamily: 'Helvetica-Bold' },
  tableHeader: { flexDirection: 'row', backgroundColor: INK, color: '#fff', paddingVertical: 7, paddingHorizontal: 6, fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 8, paddingHorizontal: 6, minHeight: 31 },
  description: { width: '53%', paddingRight: 7 }, qty: { width: '10%', textAlign: 'right' }, unit: { width: '18%', textAlign: 'right' }, amount: { width: '19%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  main: { fontFamily: 'Helvetica-Bold', lineHeight: 1.35 }, detail: { color: MUTED, fontSize: 7.5, marginTop: 3 },
  totalsWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 }, totals: { width: 230 }, totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }, strong: { borderTopWidth: 1, borderTopColor: BORDER, marginTop: 2, paddingTop: 7, fontFamily: 'Helvetica-Bold', fontSize: 11 },
  total: { marginTop: 7, padding: 10, backgroundColor: RED, color: '#fff', flexDirection: 'row', justifyContent: 'space-between', fontFamily: 'Helvetica-Bold', fontSize: 12 },
  notes: { marginTop: 18, paddingTop: 13, borderTopWidth: 1, borderTopColor: BORDER, color: MUTED, lineHeight: 1.4 },
  footer: { position: 'absolute', bottom: 22, left: 38, right: 38, flexDirection: 'row', justifyContent: 'space-between', color: MUTED, fontSize: 7.5 },
});
const money = (value: string | null) => value == null ? 'PRICE PENDING' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value));
const date = (value: string | null) => value ? new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Adelaide' }).format(new Date(value)) : '—';
const address = (party: QuoteDocumentParty) => [party.street_address, [party.suburb, party.state, party.postcode].filter(Boolean).join(' '), party.country].filter(Boolean) as string[];
function Line({ line }: { line: QuoteDocumentLine }) { const detail = line.tyre ? [line.tyre.brand, line.tyre.model, line.tyre.size].filter(Boolean).join(' · ') : ''; return <View style={styles.description}><Text style={styles.main}>{line.description}</Text>{detail ? <Text style={styles.detail}>{detail}</Text> : null}</View>; }

export function QuotePdfDocument({ quote, logoSource }: { quote: QuoteDocumentData; logoSource?: string | null }) {
  const business = quote.business.business_name ?? quote.business.display_name ?? '24/7 Truck Tyre Services';
  const customer = quote.customer.display_name ?? quote.customer.company_name ?? quote.customer.legal_name ?? quote.customer.label ?? 'Walk-in customer';
  return <Document title={`Quote ${quote.quoteNumber}`} author={business} subject="Customer quote">
    <Page size="A4" style={styles.page} wrap>
      <View style={styles.header} fixed><View>{logoSource ? <Image src={logoSource} style={styles.logo} /> : <Text style={styles.brand}>{business}</Text>}</View><View><Text style={styles.title}>QUOTE</Text><Text style={styles.number}>#{quote.quoteNumber}</Text></View></View>
      <View style={styles.meta}><View style={styles.column}><Text style={styles.label}>From</Text><Text style={styles.party}>{business}</Text>{quote.business.abn ? <Text style={styles.line}>ABN {quote.business.abn}</Text> : null}{address(quote.business).map((item) => <Text key={item} style={styles.line}>{item}</Text>)}{quote.business.phone ?? quote.branch.phone ? <Text style={styles.line}>{quote.business.phone ?? quote.branch.phone}</Text> : null}{quote.business.shared_email ?? quote.branch.contact_email ? <Text style={styles.line}>{quote.business.shared_email ?? quote.branch.contact_email}</Text> : null}</View><View style={styles.column}><Text style={styles.label}>Prepared for</Text><Text style={styles.party}>{customer}</Text>{address(quote.customer).map((item) => <Text key={item} style={styles.line}>{item}</Text>)}{quote.customer.email ? <Text style={styles.line}>{quote.customer.email}</Text> : null}{quote.customer.phone ? <Text style={styles.line}>{quote.customer.phone}</Text> : null}{quote.customerReference ? <Text style={styles.line}>Reference: {quote.customerReference}</Text> : null}</View><View style={styles.column}><View style={styles.dates}><Text style={styles.dateLabel}>Quote date</Text><Text style={styles.dateValue}>{date(quote.quoteDate)}</Text></View><View style={styles.dates}><Text style={styles.dateLabel}>Expiry date</Text><Text style={styles.dateValue}>{date(quote.expiryDate)}</Text></View><View style={styles.dates}><Text style={styles.dateLabel}>Location</Text><Text style={styles.dateValue}>{quote.locationName ?? '—'}</Text></View></View></View>
      <View><View style={styles.tableHeader} fixed><Text style={styles.description}>Description</Text><Text style={styles.qty}>Qty</Text><Text style={styles.unit}>Unit price</Text><Text style={styles.amount}>Amount</Text></View>{quote.lines.map((line) => <View key={line.id} style={styles.row} wrap={false}><Line line={line}/><Text style={styles.qty}>{line.quantity}</Text><Text style={styles.unit}>{money(line.unitPrice)}</Text><Text style={styles.amount}>{money(line.amount)}</Text></View>)}</View>
      <View style={styles.totalsWrap} wrap={false}><View style={styles.totals}><View style={styles.totalRow}><Text>Subtotal (ex GST)</Text><Text>{money(quote.subtotal)}</Text></View><View style={styles.totalRow}><Text>GST</Text><Text>{money(quote.gst)}</Text></View><View style={[styles.totalRow, styles.strong]}><Text>Total</Text><Text>{money(quote.total)}</Text></View><View style={styles.total}><Text>TOTAL incl GST</Text><Text>{money(quote.total)}</Text></View></View></View>
      {quote.customerNotes ? <View style={styles.notes} wrap={false}><Text style={styles.label}>Notes</Text><Text>{quote.customerNotes}</Text></View> : null}{quote.business.invoice_footer || quote.branch.document_footer ? <View style={styles.notes} wrap={false}><Text>{quote.business.invoice_footer ?? quote.branch.document_footer}</Text></View> : null}
      <View style={styles.footer} fixed><Text>{business} · Quote #{quote.quoteNumber}</Text><Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} /></View>
    </Page>
  </Document>;
}
/* eslint-enable jsx-a11y/alt-text */
