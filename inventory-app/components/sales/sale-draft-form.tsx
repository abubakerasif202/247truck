'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Product = { productId: string; name: string; brandName: string | null; sizeName: string | null; sellingPriceInclGst: number | null; available: number };
type Customer = { id: string; customerNumber: string; displayName: string; phone: string | null };
type Line = { line_type: 'product' | 'labour'; product_id?: string; description: string; quantity: number; unit_price_incl_gst?: number | null };

export function SaleDraftForm({ customers, products, action, locationId = '', actionLabel = 'Save draft', initialCustomerId = '', initialVehicleId = '', initialLines = [] }: { customers: Customer[]; products: Product[]; action: (formData: FormData) => void; locationId?: string; actionLabel?: string; initialCustomerId?: string; initialVehicleId?: string; initialLines?: Line[] }) {
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [labourDescription, setLabourDescription] = useState('');
  const [labourPrice, setLabourPrice] = useState('');
  const addProduct = () => { const p = products.find(row => row.productId === productId); if (!p) return; setLines([...lines, { line_type: 'product', product_id: p.productId, description: p.name, quantity: Number(quantity), unit_price_incl_gst: p.sellingPriceInclGst }]); setProductId(''); };
  const addLabour = () => { if (!labourDescription.trim() || !labourPrice) return; setLines([...lines, { line_type: 'labour', description: labourDescription.trim(), quantity: 1, unit_price_incl_gst: Number(labourPrice) }]); setLabourDescription(''); setLabourPrice(''); };
  return <form action={action} className="grid gap-5 rounded-xl border bg-card p-5">
    <input type="hidden" name="request_id" value={typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : ''} /><input type="hidden" name="location_id" value={locationId} />
    <input type="hidden" name="lines" value={JSON.stringify(lines)} />
    <div className="grid gap-2"><Label htmlFor="customer_id">Customer</Label><select id="customer_id" name="customer_id" defaultValue={initialCustomerId} required className="h-11 rounded-md border border-input bg-background px-3"><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.customerNumber} · {c.displayName}{c.phone ? ` · ${c.phone}` : ''}</option>)}</select></div>
    <div className="grid gap-2"><Label htmlFor="customer_vehicle_id">Vehicle ID (optional)</Label><Input id="customer_vehicle_id" name="customer_vehicle_id" defaultValue={initialVehicleId} placeholder="Select a vehicle from the customer record" /></div>
    <div className="grid gap-3 rounded-lg border p-4"><p className="text-sm font-semibold">Inventory line</p><div className="grid gap-3 sm:grid-cols-[1fr_7rem_auto]"><select aria-label="Product" value={productId} onChange={e => setProductId(e.target.value)} className="h-11 rounded-md border border-input bg-background px-3"><option value="">Select product</option>{products.map(p => <option key={p.productId} value={p.productId}>{p.name} · {p.brandName ?? 'No brand'} · {p.sizeName ?? 'No size'} · {p.sellingPriceInclGst == null ? 'PRICE PENDING' : `$${p.sellingPriceInclGst.toFixed(2)}`} · ${p.available} available</option>)}</select><Input aria-label="Quantity" type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} /><Button type="button" onClick={addProduct} variant="outline">Add</Button></div></div>
    <div className="grid gap-3 rounded-lg border p-4"><p className="text-sm font-semibold">Free-text labour / service</p><div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]"><Input aria-label="Labour description" value={labourDescription} onChange={e => setLabourDescription(e.target.value)} placeholder="Description" /><Input aria-label="Labour price" type="number" min="0" step="0.01" value={labourPrice} onChange={e => setLabourPrice(e.target.value)} placeholder="Price incl GST" /><Button type="button" onClick={addLabour} variant="outline">Add</Button></div></div>
    <div className="grid gap-2">{lines.length === 0 ? <p className="text-sm text-muted-foreground">No lines added yet.</p> : lines.map((line, index) => <div key={`${line.description}-${index}`} className="flex items-center justify-between gap-3 rounded-md bg-secondary/50 px-3 py-2 text-sm"><span>{line.description} · {line.quantity} × {line.unit_price_incl_gst == null ? 'PRICE PENDING' : `$${line.unit_price_incl_gst.toFixed(2)}`}</span><button type="button" className="text-destructive underline" onClick={() => setLines(lines.filter((_, i) => i !== index))}>Remove</button></div>)}</div>
    <Button type="submit" disabled={lines.length === 0}>{actionLabel}</Button>
  </form>;
}
