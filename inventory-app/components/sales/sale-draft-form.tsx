'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Customer = { id: string; customerNumber: string; displayName: string; phone: string | null; customerType?: string; paymentTerms?: string; poReferenceRequired?: boolean };
type Vehicle = { id: string; registration: string; fleet_number: string | null; vehicle_type: string; make: string | null; model: string | null };
type Product = { productId: string; name: string; brandName: string | null; patternName?: string | null; sizeName: string | null; tyreCondition?: string; sellingPriceInclGst: number | null; available: number; onHand?: number; reserved?: number };
type UsedUnit = { id: string; internal_unit_code: string; condition: string; tread_depth_mm: number; location_id: string; status: string };
type Line = { line_type: 'product' | 'labour'; product_id?: string; used_tyre_unit_id?: string; description: string; quantity: number; unit_price_incl_gst?: number | null };
type Props = { action: (formData: FormData) => void; locationId?: string; actionLabel?: string; initialCustomerId?: string; initialCustomer?: Customer | null; initialVehicleId?: string; initialVehicle?: Vehicle | null; initialLines?: Line[]; allowWalkIn?: boolean };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('Search is temporarily unavailable.');
  return response.json() as Promise<T>;
}

export function SaleDraftForm({ action, locationId = '', actionLabel = 'Save draft', initialCustomerId = '', initialCustomer = null, initialVehicleId = '', initialVehicle = null, initialLines = [], allowWalkIn = false }: Props) {
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>(initialVehicle ? [initialVehicle] : []);
  const [vehicleId, setVehicleId] = useState(initialVehicleId);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [usedUnits, setUsedUnits] = useState<UsedUnit[]>([]);
  const [usedUnitId, setUsedUnitId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [labourDescription, setLabourDescription] = useState('');
  const [labourPrice, setLabourPrice] = useState('');
  const [searchError, setSearchError] = useState('');
  const customerSequence = useRef(0);
  const productSequence = useRef(0);

  useEffect(() => {
    if (customerQuery.trim().length < 2) return;
    const sequence = ++customerSequence.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { getJson<{ customers: Customer[] }>(`/api/sales/customers?q=${encodeURIComponent(customerQuery)}`, controller.signal).then(result => { if (sequence === customerSequence.current) setCustomerResults(result.customers); }).catch(error => { if (error.name !== 'AbortError') setSearchError('Customer search is temporarily unavailable.'); }); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [customerQuery]);

  useEffect(() => {
    if (!customer?.id) return;
    const controller = new AbortController();
    getJson<{ vehicles: Vehicle[] }>(`/api/sales/vehicles?customer_id=${encodeURIComponent(customer.id)}`, controller.signal).then(result => setVehicles(result.vehicles)).catch(error => { if (error.name !== 'AbortError') setSearchError('Vehicle search is temporarily unavailable.'); });
    return () => controller.abort();
  }, [customer?.id]);

  useEffect(() => {
    if (productQuery.trim().length < 2 || !locationId) return;
    const sequence = ++productSequence.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { getJson<{ products: Product[] }>(`/api/sales/products?q=${encodeURIComponent(productQuery)}&location_id=${encodeURIComponent(locationId)}`, controller.signal).then(result => { if (sequence === productSequence.current) setProductResults(result.products); }).catch(error => { if (error.name !== 'AbortError') setSearchError('Product search is temporarily unavailable.'); }); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [productQuery, locationId]);

  useEffect(() => {
    if (!selectedProduct || selectedProduct.tyreCondition !== 'used') return;
    const controller = new AbortController();
    getJson<{ units: UsedUnit[] }>(`/api/sales/used-units?product_id=${encodeURIComponent(selectedProduct.productId)}&location_id=${encodeURIComponent(locationId)}`, controller.signal).then(result => setUsedUnits(result.units)).catch(error => { if (error.name !== 'AbortError') setSearchError('Used tyre search is temporarily unavailable.'); });
    return () => controller.abort();
  }, [selectedProduct, locationId]);

  const selectCustomer = (value: Customer) => { setCustomer(value); setCustomerQuery(''); setCustomerResults([]); setVehicleId(''); };
  const selectProduct = (value: Product) => { setSelectedProduct(value); setProductQuery(''); setProductResults([]); setUsedUnitId(''); setUsedUnits([]); };
  const addProduct = () => {
    if (!selectedProduct) return;
    const isUsed = selectedProduct.tyreCondition === 'used';
    const parsedQuantity = isUsed ? 1 : Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || (isUsed && parsedQuantity !== 1) || (selectedProduct.available < parsedQuantity)) return;
    if (isUsed && !usedUnitId) return;
    setLines([...lines, { line_type: 'product', product_id: selectedProduct.productId, used_tyre_unit_id: isUsed ? usedUnitId : undefined, description: `${selectedProduct.name}${isUsed ? ` · ${usedUnits.find(unit => unit.id === usedUnitId)?.internal_unit_code ?? 'used unit'}` : ''}`, quantity: parsedQuantity, unit_price_incl_gst: selectedProduct.sellingPriceInclGst }]);
    setSelectedProduct(null); setUsedUnits([]); setUsedUnitId(''); setQuantity('1');
  };
  const addLabour = () => { const price = Number(labourPrice); if (!labourDescription.trim() || !Number.isFinite(price) || price < 0) return; setLines([...lines, { line_type: 'labour', description: labourDescription.trim(), quantity: 1, unit_price_incl_gst: price }]); setLabourDescription(''); setLabourPrice(''); };

  return <form action={action} className="grid gap-5 rounded-xl border bg-card p-5">
    <input type="hidden" name="request_id" value={typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : ''} /><input type="hidden" name="location_id" value={locationId} /><input type="hidden" name="customer_id" value={customer?.id ?? initialCustomerId} /><input type="hidden" name="customer_vehicle_id" value={vehicleId} /><input type="hidden" name="lines" value={JSON.stringify(lines)} />
    <div className="grid gap-2"><Label htmlFor="customer_search">Customer</Label>{customer ? <div className="flex items-center justify-between rounded-md border p-3"><span><strong>{customer.customerNumber}</strong> · {customer.displayName}{customer.poReferenceRequired ? ' · PO Required' : ''}</span><Button type="button" variant="ghost" onClick={() => { setCustomer(null); setVehicleId(''); }}>Change</Button></div> : <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { setCustomer(null); setCustomerQuery(''); setCustomerResults([]); }}>Walk-in customer</Button><Input id="customer_search" aria-label="Search customer" value={customerQuery} onChange={event => setCustomerQuery(event.target.value)} placeholder="Search customer number, name, phone, ABN or registration" required={!allowWalkIn} /></div>}{customerResults.length > 0 && customerQuery.trim().length >= 2 ? <div role="listbox" aria-label="Customer results" className="grid gap-1 rounded-md border p-2">{customerResults.map(result => <button type="button" role="option" aria-selected="false" key={result.id} className="rounded px-3 py-2 text-left hover:bg-secondary" onClick={() => selectCustomer(result)}>{result.customerNumber} · {result.displayName}{result.poReferenceRequired ? ' · PO Required' : ''}</button>)}</div> : null}{searchError ? <p role="alert" className="text-sm text-destructive">{searchError}</p> : null}{allowWalkIn && !customer ? <input type="hidden" name="walk_in_label" value="Walk-in customer" /> : null}</div>
    <div className="grid gap-2"><Label htmlFor="customer_vehicle_id_picker">Vehicle (optional)</Label>{customer ? <select id="customer_vehicle_id_picker" aria-label="Vehicle" value={vehicleId} onChange={event => setVehicleId(event.target.value)} className="h-11 rounded-md border border-input bg-background px-3"><option value="">No vehicle selected</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration}{vehicle.fleet_number ? ` · Fleet ${vehicle.fleet_number}` : ''}{vehicle.make || vehicle.model ? ` · ${[vehicle.make, vehicle.model].filter(Boolean).join(' ')}` : ''}</option>)}</select> : <p className="text-sm text-muted-foreground">Select a customer to choose one of their active vehicles.</p>}</div>
    <div className="grid gap-3 rounded-lg border p-4"><p className="text-sm font-semibold">Inventory line</p><Input aria-label="Search product" value={productQuery} onChange={event => setProductQuery(event.target.value)} placeholder="Search product, reference, brand, pattern or size" />{productResults.length > 0 && productQuery.trim().length >= 2 ? <div role="listbox" aria-label="Product results" className="grid gap-1 rounded-md border p-2">{productResults.map(product => <button type="button" role="option" aria-selected="false" key={product.productId} className="rounded px-3 py-2 text-left hover:bg-secondary" onClick={() => selectProduct(product)}>{product.name} · {product.brandName ?? 'No brand'} · {product.sizeName ?? 'No size'} · {product.sellingPriceInclGst == null ? 'PRICE PENDING' : `$${product.sellingPriceInclGst.toFixed(2)}`} · {product.available} available</button>)}</div> : null}{selectedProduct ? <div className="grid gap-3 rounded-md bg-secondary/50 p-3"><p>{selectedProduct.name}{selectedProduct.sellingPriceInclGst == null ? ' · PRICE PENDING' : ` · $${selectedProduct.sellingPriceInclGst.toFixed(2)} incl GST`}</p>{selectedProduct.tyreCondition === 'used' ? <select aria-label="Used tyre unit" value={usedUnitId} onChange={event => setUsedUnitId(event.target.value)} className="h-11 rounded-md border border-input bg-background px-3"><option value="">Select exact available used tyre</option>{usedUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.internal_unit_code} · {unit.condition} · {unit.tread_depth_mm} mm</option>)}</select> : null}<div className="grid gap-3 sm:grid-cols-[1fr_auto]"> <Input aria-label="Quantity" type="number" min="1" step="1" value={selectedProduct.tyreCondition === 'used' ? '1' : quantity} disabled={selectedProduct.tyreCondition === 'used'} onChange={event => setQuantity(event.target.value)} /><Button type="button" aria-label="Add product" onClick={addProduct} variant="outline">Add product</Button></div></div> : null}</div>
    <div className="grid gap-3 rounded-lg border p-4"><p className="text-sm font-semibold">Free-text labour / service</p><div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]"><Input aria-label="Labour description" value={labourDescription} onChange={event => setLabourDescription(event.target.value)} placeholder="Description" /><Input aria-label="Labour price" type="number" min="0" step="0.01" value={labourPrice} onChange={event => setLabourPrice(event.target.value)} placeholder="Price incl GST" /><Button type="button" aria-label="Add labour" onClick={addLabour} variant="outline">Add labour</Button></div></div>
    <div className="grid gap-2">{lines.length === 0 ? <p className="text-sm text-muted-foreground">No lines added yet.</p> : lines.map((line, index) => <div key={`${line.description}-${index}`} className="flex items-center justify-between gap-3 rounded-md bg-secondary/50 px-3 py-2 text-sm"><span>{line.description} · {line.quantity} × {line.unit_price_incl_gst == null ? 'PRICE PENDING' : `$${line.unit_price_incl_gst.toFixed(2)}`}</span><button type="button" className="text-destructive underline" onClick={() => setLines(lines.filter((_, i) => i !== index))}>Remove</button></div>)}</div>
    <Button type="submit" disabled={lines.length === 0}>{actionLabel}</Button>
  </form>;
}
