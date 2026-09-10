'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { calculateInvoice } from '@/lib/finance/money';

export type EditableLine = {
  id?: string; line_type: 'product' | 'labour'; product_id?: string | null; description: string; quantity: string;
  unit_price: string; pricing_basis: 'exclusive' | 'inclusive'; gst_treatment: 'taxable' | 'gst_free';
  discount_type: 'percent' | 'fixed'; discount_value: string; locked?: boolean;
  discount_reason?: string | null;
  tyre_details?: { brand?: string | null; model?: string | null; size?: string | null; position?: string | null; quantity_fitted?: string | null; serial_dot?: string | null };
};

const blank = (): EditableLine => ({ line_type: 'labour', description: '', quantity: '1', unit_price: '', pricing_basis: 'exclusive', gst_treatment: 'taxable', discount_type: 'percent', discount_value: '0' });
const dollars = (value: bigint) => `$${(Number(value) / 100).toFixed(2)}`;

export function InvoiceLineEditor({ name = 'lines', initial, allowAddRemove = true }: { name?: string; initial: EditableLine[]; allowAddRemove?: boolean }) {
  const [lines, setLines] = useState(initial.length ? initial : [blank()]);
  const total = useMemo(() => {
    try { return calculateInvoice(lines.map((line) => ({ quantity: line.quantity, price: line.unit_price.trim() || null, pricingBasis: line.pricing_basis, gstTreatment: line.gst_treatment, discountType: line.discount_type, discountValue: line.discount_value || '0' }))); }
    catch { return undefined; }
  }, [lines]);
  const serialized = JSON.stringify(lines.map((editable) => { const line = { ...editable }; delete line.locked; return { ...line, unit_price: line.unit_price.trim() || null, product_id: line.product_id || null, tyre_details: line.tyre_details && Object.values(line.tyre_details).some(Boolean) ? line.tyre_details : undefined }; }));
  function patch(index: number, patchValue: Partial<EditableLine>) { setLines((current) => current.map((line, i) => i === index ? { ...line, ...patchValue } : line)); }
  function tyre(index: number, key: NonNullable<EditableLine['tyre_details']> extends infer T ? keyof T : never, value: string) { const line = lines[index]; patch(index, { tyre_details: { ...line.tyre_details, [key]: value } }); }

  return <div className="flex flex-col gap-4">
    <input type="hidden" name={name} value={serialized} />
    {lines.map((line, index) => <fieldset key={line.id ?? index} className="rounded-xl border bg-card p-4">
      <legend className="px-1 text-sm font-semibold">Item {index + 1}</legend>
      <div className="grid gap-3 md:grid-cols-12">
        <div className="md:col-span-2"><Label htmlFor={`type-${index}`}>Type</Label><select id={`type-${index}`} value={line.line_type} onChange={(e) => patch(index, { line_type: e.target.value as EditableLine['line_type'] })} className="h-11 w-full rounded-md border bg-background px-3"><option value="product">Tyre / product</option><option value="labour">Service / labour</option></select></div>
        <div className="md:col-span-4"><Label htmlFor={`desc-${index}`}>Description</Label><Input id={`desc-${index}`} value={line.description} onChange={(e) => patch(index, { description: e.target.value })} required /></div>
        <div className="md:col-span-2"><Label htmlFor={`qty-${index}`}>Quantity</Label><Input id={`qty-${index}`} inputMode="decimal" value={line.quantity} disabled={line.locked} onChange={(e) => patch(index, { quantity: e.target.value })} /></div>
        <div className="md:col-span-2"><Label htmlFor={`price-${index}`}>Unit price</Label><Input id={`price-${index}`} inputMode="decimal" value={line.unit_price} disabled={line.locked} onChange={(e) => patch(index, { unit_price: e.target.value })} placeholder="0.00" /></div>
        <div className="md:col-span-2"><Label htmlFor={`basis-${index}`}>Price basis</Label><select id={`basis-${index}`} value={line.pricing_basis} onChange={(e) => patch(index, { pricing_basis: e.target.value as EditableLine['pricing_basis'] })} className="h-11 w-full rounded-md border bg-background px-2"><option value="exclusive">Ex GST</option><option value="inclusive">Incl GST</option></select></div>
        <div className="md:col-span-3"><Label htmlFor={`gst-${index}`}>GST treatment</Label><select id={`gst-${index}`} value={line.gst_treatment} onChange={(e) => patch(index, { gst_treatment: e.target.value as EditableLine['gst_treatment'] })} className="h-11 w-full rounded-md border bg-background px-3"><option value="taxable">Taxable (10%)</option><option value="gst_free">GST-free</option></select></div>
        <div className="md:col-span-3"><Label htmlFor={`discount-type-${index}`}>Discount</Label><select id={`discount-type-${index}`} value={line.discount_type} onChange={(e) => patch(index, { discount_type: e.target.value as EditableLine['discount_type'] })} className="h-11 w-full rounded-md border bg-background px-3"><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></div>
        <div className="md:col-span-2"><Label htmlFor={`discount-${index}`}>{line.discount_type === 'percent' ? 'Discount %' : 'Discount $'}</Label><Input id={`discount-${index}`} inputMode="decimal" value={line.discount_value} onChange={(e) => patch(index, { discount_value: e.target.value })} /></div>
      </div>
      {Number(line.discount_value) > 0 ? <div className="mt-3"><Label htmlFor={`discount-reason-${index}`}>Discount reason</Label><Input id={`discount-reason-${index}`} value={line.discount_reason ?? ''} onChange={(e) => patch(index, { discount_reason: e.target.value })} required /></div> : null}
      {line.line_type === 'product' ? <details className="mt-4 rounded-md bg-muted/40 p-3"><summary className="cursor-pointer text-sm font-medium">Tyre details</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {([['brand','Brand'],['model','Model'],['size','Size'],['position','Position'],['quantity_fitted','Quantity fitted'],['serial_dot','Serial / DOT']] as const).map(([key,label]) => <div key={key}><Label htmlFor={`${key}-${index}`}>{label}</Label><Input id={`${key}-${index}`} value={line.tyre_details?.[key] ?? ''} onChange={(e) => tyre(index,key,e.target.value)} /></div>)}
      </div></details> : null}
      <div className="mt-3 flex justify-end">{allowAddRemove && !line.locked && lines.length > 1 ? <Button type="button" variant="ghost" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Remove item</Button> : null}</div>
    </fieldset>)}
    {allowAddRemove ? <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, blank()])}>Add line item</Button> : null}
    <div aria-live="polite" className="rounded-lg bg-muted p-4 text-right text-sm tabular-nums">{total === null ? 'A price is still required.' : total === undefined ? 'Check quantities, prices and discounts.' : <><p>Subtotal: {dollars(total.subtotal)}</p><p>Discounts: {dollars(total.discountTotal)}</p><p>GST: {dollars(total.gst)}</p><p className="text-lg font-bold">Total: {dollars(total.total)}</p></>}</div>
  </div>;
}
