'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LOCATION_NAMES, type LocationCode } from '@/lib/app-config';

type Customer = { id: string; customerNumber: string; displayName: string; phone: string | null; customerType?: string; pricingTier?: 'retail' | 'wholesale'; paymentTerms?: string; poReferenceRequired?: boolean };
type Vehicle = { id: string; registration: string; fleet_number: string | null; vehicle_type: string; make: string | null; model: string | null };
type Product = { productId: string; name: string; brandName: string | null; patternName?: string | null; sizeName: string | null; tyreCondition?: string; retailPriceInclGst: number | null; wholesalePriceInclGst: number | null; sellingPriceInclGst: number | null; available: number; onHand?: number; reserved?: number };
type UsedUnit = { id: string; internal_unit_code: string; condition: string; tread_depth_mm: number; location_id: string; status: string };
type Line = { line_type: 'product' | 'labour'; product_id?: string; used_tyre_unit_id?: string; validated_location_id?: string; description: string; quantity: number; unit_price_incl_gst?: number | null };
type LocationOption = { id: string; code: string };
type BusinessOption = { brand: string; businessName: string };
type Props = { action: (formData: FormData) => void | Promise<void>; locationId?: string; locations?: LocationOption[]; requestId: string; actionLabel?: string; initialCustomerId?: string; initialCustomer?: Customer | null; initialVehicleId?: string; initialVehicle?: Vehicle | null; initialLines?: Line[]; allowWalkIn?: boolean; tenderMode?: boolean; requireBusinessSelection?: boolean };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error('Search is temporarily unavailable.');
  return response.json() as Promise<T>;
}

function SaleSubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending || disabled}>{pending ? 'Working…' : label}</Button>;
}

export function SaleDraftForm({ action, locationId = '', locations = [], requestId, actionLabel = 'Save draft', initialCustomerId = '', initialCustomer = null, initialVehicleId = '', initialVehicle = null, initialLines = [], allowWalkIn = false, tenderMode = false, requireBusinessSelection = false }: Props) {
  // `locationId` is fixed (manager's own branch, or an admin's single-branch
  // scope selection) when non-empty. When empty — an admin viewing "All
  // locations" — the branch must be chosen explicitly here; it is never
  // silently defaulted, since a wrong guess deducts stock from the wrong
  // branch with no way for the database to detect it.
  const hasFixedLocation = locationId !== '';
  const [selectedLocationId, setSelectedLocationId] = useState(locationId);
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInEmail, setWalkInEmail] = useState('');
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
  const [tenderMethod, setTenderMethod] = useState<'cash' | 'eftpos' | 'bank_transfer'>('cash');
  const [tenderAmount, setTenderAmount] = useState('');
  const [businesses, setBusinesses] = useState<BusinessOption[] | null>(null);
  const [businessError, setBusinessError] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const customerSequence = useRef(0);
  const productSequence = useRef(0);
  const hasInventoryLines = lines.some(line => line.line_type === 'product');

  const changeLocation = (nextLocationId: string) => {
    if (nextLocationId === selectedLocationId || hasInventoryLines) return;
    // Invalidate any in-flight branch search before clearing its results. A
    // late response from the old branch must never repopulate this form.
    productSequence.current += 1;
    setSelectedLocationId(nextLocationId);
    setSelectedProduct(null);
    setProductResults([]);
    setUsedUnits([]);
    setUsedUnitId('');
    setProductQuery('');
    setQuantity('1');
    // A stale business selection from the previous branch must never remain
    // usable while the new branch's authorised businesses are still
    // loading: clear it now so businessSelectionBlocked disables submit
    // until the effect below resolves the new branch's real options.
    setBusinesses(null);
    setSelectedBrand('');
    setBusinessError('');
  };

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
    if (productQuery.trim().length < 2 || !selectedLocationId) return;
    const sequence = ++productSequence.current;
    const controller = new AbortController();
    const tier = customer?.pricingTier ?? (customer?.customerType === 'business' ? 'wholesale' : 'retail');
    const timer = window.setTimeout(() => { getJson<{ products: Product[] }>(`/api/sales/products?q=${encodeURIComponent(productQuery)}&location_id=${encodeURIComponent(selectedLocationId)}&pricing_tier=${tier}`, controller.signal).then(result => { if (sequence === productSequence.current) setProductResults(result.products); }).catch(error => { if (error.name !== 'AbortError') setSearchError('Product search is temporarily unavailable.'); }); }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [productQuery, selectedLocationId, customer]);

  useEffect(() => {
    // The render below only shows the business selector when
    // requireBusinessSelection && selectedLocationId, so no reset is needed
    // here when that condition is false - stale state simply never renders.
    if (!requireBusinessSelection || !selectedLocationId) return;
    const controller = new AbortController();
    getJson<{ defaultBrand: string | null; canOverride: boolean; businesses: BusinessOption[] }>(
      `/api/sales/business-options?location_id=${encodeURIComponent(selectedLocationId)}`, controller.signal,
    ).then((result) => {
      setBusinesses(result.businesses);
      setBusinessError(result.businesses.length === 0 ? 'No business is authorised to sell from this location.' : '');
      // Preselect only when the location has exactly one authorised
      // business; otherwise the staff member must choose explicitly.
      setSelectedBrand(result.businesses.length === 1 ? result.businesses[0]!.brand : '');
    }).catch((error) => {
      if (error.name === 'AbortError') return;
      setBusinesses([]);
      setBusinessError('Could not load authorised businesses for this location.');
      setSelectedBrand('');
    });
    return () => controller.abort();
  }, [requireBusinessSelection, selectedLocationId]);

  useEffect(() => {
    if (!selectedProduct || selectedProduct.tyreCondition !== 'used') return;
    const controller = new AbortController();
    getJson<{ units: UsedUnit[] }>(`/api/sales/used-units?product_id=${encodeURIComponent(selectedProduct.productId)}&location_id=${encodeURIComponent(selectedLocationId)}`, controller.signal).then(result => setUsedUnits(result.units)).catch(error => { if (error.name !== 'AbortError') setSearchError('Used tyre search is temporarily unavailable.'); });
    return () => controller.abort();
  }, [selectedProduct, selectedLocationId]);

  const selectCustomer = (value: Customer) => { setCustomer(value); setCustomerQuery(''); setCustomerResults([]); setVehicleId(''); };
  const selectProduct = (value: Product) => { setSelectedProduct(value); setProductQuery(''); setProductResults([]); setUsedUnitId(''); setUsedUnits([]); };
  const addProduct = () => {
    if (!selectedProduct) return;
    const isUsed = selectedProduct.tyreCondition === 'used';
    const parsedQuantity = isUsed ? 1 : Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || (isUsed && parsedQuantity !== 1) || (selectedProduct.available < parsedQuantity)) return;
    if (isUsed && !usedUnitId) return;
    const tier = customer?.pricingTier ?? (customer?.customerType === 'business' ? 'wholesale' : 'retail');
    const selectedPrice = tier === 'wholesale' ? selectedProduct.wholesalePriceInclGst : selectedProduct.retailPriceInclGst;
    setLines([...lines, { line_type: 'product', product_id: selectedProduct.productId, used_tyre_unit_id: isUsed ? usedUnitId : undefined, validated_location_id: selectedLocationId, description: `${selectedProduct.name}${isUsed ? ` · ${usedUnits.find(unit => unit.id === usedUnitId)?.internal_unit_code ?? 'used unit'}` : ''}`, quantity: parsedQuantity, unit_price_incl_gst: selectedPrice }]);
    setSelectedProduct(null); setUsedUnits([]); setUsedUnitId(''); setQuantity('1');
  };
  const addLabour = () => { const price = Number(labourPrice); if (!labourDescription.trim() || !Number.isFinite(price) || price < 0) return; setLines([...lines, { line_type: 'labour', description: labourDescription.trim(), quantity: 1, unit_price_incl_gst: price }]); setLabourDescription(''); setLabourPrice(''); };
  const pricingTier = customer?.pricingTier ?? (customer?.customerType === 'business' ? 'wholesale' : 'retail');
  const priceFor = (product: Product) => pricingTier === 'wholesale' ? product.wholesalePriceInclGst : product.retailPriceInclGst;

  const tenders = tenderAmount.trim() ? [{ method: tenderMethod, amount: tenderAmount.trim(), reference: null, notes: null }] : [];
  const businessSelectionBlocked = requireBusinessSelection && (!businesses || businesses.length === 0 || !selectedBrand);
  return <form action={action} className="grid gap-5 rounded-xl border bg-card p-5">
    <input type="hidden" name="request_id" value={requestId} /><input type="hidden" name="location_id" value={selectedLocationId} /><input type="hidden" name="customer_id" value={customer?.id ?? initialCustomerId} /><input type="hidden" name="customer_vehicle_id" value={vehicleId} /><input type="hidden" name="lines" value={JSON.stringify(lines)} /><input type="hidden" name="tenders" value={JSON.stringify(tenders)} /><input type="hidden" name="walk_in_name" value={walkInName} /><input type="hidden" name="walk_in_phone" value={walkInPhone} /><input type="hidden" name="walk_in_email" value={walkInEmail} />{requireBusinessSelection ? <input type="hidden" name="business_brand" value={selectedBrand} /> : null}
    {!hasFixedLocation ? <div className="grid gap-2"><Label htmlFor="location_picker">Branch</Label><select id="location_picker" aria-label="Branch" aria-describedby={hasInventoryLines ? 'location_picker_help' : undefined} value={selectedLocationId} onChange={event => changeLocation(event.target.value)} className="h-11 rounded-md border border-input bg-background px-3" required disabled={hasInventoryLines}><option value="">Select branch</option>{locations.map(loc => <option key={loc.id} value={loc.id}>{LOCATION_NAMES[loc.code as LocationCode] ?? loc.code}</option>)}</select>{!selectedLocationId ? <p role="alert" className="text-xs text-destructive">Select the branch this sale is for before adding lines.</p> : null}{hasInventoryLines ? <p id="location_picker_help" className="text-xs text-muted-foreground">Remove all inventory lines before changing branch.</p> : null}</div> : null}
    {requireBusinessSelection && selectedLocationId ? <div className="grid gap-2"><Label htmlFor="business_picker">Business</Label>{businessError ? <p role="alert" className="text-xs text-destructive">{businessError}</p> : businesses === null ? <p className="text-xs text-muted-foreground">Loading authorised businesses…</p> : businesses.length === 1 ? <div className="flex items-center rounded-md border bg-secondary/50 px-3 py-2 text-sm">{businesses[0]!.businessName}</div> : <select id="business_picker" aria-label="Business" value={selectedBrand} onChange={event => setSelectedBrand(event.target.value)} className="h-11 rounded-md border border-input bg-background px-3" required><option value="">Select business</option>{businesses.map(item => <option key={item.brand} value={item.brand}>{item.businessName}</option>)}</select>}{businesses && businesses.length > 1 && !selectedBrand ? <p role="alert" className="text-xs text-destructive">Select which business this sale is for.</p> : null}</div> : null}
    <div className="grid gap-2"><Label htmlFor="customer_search">Customer</Label>{customer ? <div className="flex items-center justify-between rounded-md border p-3"><span><strong>{customer.customerNumber}</strong> · {customer.displayName} · {customer.pricingTier === 'wholesale' || customer.customerType === 'business' ? 'Wholesale' : 'Retail'}{customer.poReferenceRequired ? ' · PO Required' : ''}</span><Button type="button" variant="ghost" onClick={() => { setCustomer(null); setVehicleId(''); }}>Change</Button></div> : <div className="grid gap-2"><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { setCustomer(null); setCustomerQuery(''); setCustomerResults([]); }}>Walk-in customer</Button><Input id="customer_search" aria-label="Search customer" value={customerQuery} onChange={event => setCustomerQuery(event.target.value)} placeholder="Search customer number, name, phone, ABN or registration" required={!allowWalkIn} /></div>{allowWalkIn ? <div className="grid gap-2 sm:grid-cols-3"><Input aria-label="Walk-in customer name" placeholder="Walk-in name" value={walkInName} onChange={event => setWalkInName(event.target.value)} required={!customer && !tenderMode} /><Input aria-label="Walk-in phone" placeholder="Phone (optional)" value={walkInPhone} onChange={event => setWalkInPhone(event.target.value)} /><Input aria-label="Walk-in email" type="email" placeholder="Email (optional)" value={walkInEmail} onChange={event => setWalkInEmail(event.target.value)} /></div> : null}</div>}{customerResults.length > 0 && customerQuery.trim().length >= 2 ? <div role="listbox" aria-label="Customer results" className="grid gap-1 rounded-md border p-2">{customerResults.map(result => <button type="button" role="option" aria-selected="false" key={result.id} className="rounded px-3 py-2 text-left hover:bg-secondary" onClick={() => selectCustomer(result)}>{result.customerNumber} · {result.displayName} · {result.customerType === 'business' ? 'Wholesale' : 'Retail'}</button>)}</div> : null}{searchError ? <p role="alert" className="text-sm text-destructive">{searchError}</p> : null}{allowWalkIn && !customer ? <input type="hidden" name="walk_in_label" value={walkInName || 'Walk-in customer'} /> : null}</div>
    <div className="grid gap-2"><Label htmlFor="customer_vehicle_id_picker">Vehicle (optional)</Label>{customer ? <select id="customer_vehicle_id_picker" aria-label="Vehicle" value={vehicleId} onChange={event => setVehicleId(event.target.value)} className="h-11 rounded-md border border-input bg-background px-3"><option value="">No vehicle selected</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration}{vehicle.fleet_number ? ` · Fleet ${vehicle.fleet_number}` : ''}{vehicle.make || vehicle.model ? ` · ${[vehicle.make, vehicle.model].filter(Boolean).join(' ')}` : ''}</option>)}</select> : <p className="text-sm text-muted-foreground">Select a customer to choose one of their active vehicles.</p>}</div>
    <div className="grid gap-3 rounded-lg border p-4"><p className="text-sm font-semibold">Inventory line · {pricingTier === 'wholesale' ? 'Wholesale' : 'Retail'}</p><Input aria-label="Search product" value={productQuery} onChange={event => setProductQuery(event.target.value)} placeholder="Search product, reference, brand, pattern or size" />{productResults.length > 0 && productQuery.trim().length >= 2 ? <div role="listbox" aria-label="Product results" className="grid gap-1 rounded-md border p-2">{productResults.map(product => { const price = priceFor(product); return <button type="button" role="option" aria-selected="false" key={product.productId} className="rounded px-3 py-2 text-left hover:bg-secondary" onClick={() => selectProduct(product)}>{product.name} · {product.brandName ?? 'No brand'} · {product.sizeName ?? 'No size'} · {price == null ? `${pricingTier === 'wholesale' ? 'Wholesale' : 'Retail'} Pending` : `$${price.toFixed(2)}`} · {product.available} available</button>; })}</div> : null}{selectedProduct ? <div className="grid gap-3 rounded-md bg-secondary/50 p-3"><p>{selectedProduct.name}{priceFor(selectedProduct) == null ? ` · ${pricingTier === 'wholesale' ? 'Wholesale' : 'Retail'} Pending` : ` · $${priceFor(selectedProduct)?.toFixed(2)} incl GST`}</p>{selectedProduct.tyreCondition === 'used' ? <select aria-label="Used tyre unit" value={usedUnitId} onChange={event => setUsedUnitId(event.target.value)} className="h-11 rounded-md border border-input bg-background px-3"><option value="">Select exact available used tyre</option>{usedUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.internal_unit_code} · {unit.condition} · {unit.tread_depth_mm} mm</option>)}</select> : null}<div className="grid gap-3 sm:grid-cols-[1fr_auto]"> <Input aria-label="Quantity" type="number" min="1" step="1" value={selectedProduct.tyreCondition === 'used' ? '1' : quantity} disabled={selectedProduct.tyreCondition === 'used'} onChange={event => setQuantity(event.target.value)} /><Button type="button" aria-label="Add product" onClick={addProduct} variant="outline">Add product</Button></div></div> : null}</div>
    <div className="grid gap-3 rounded-lg border p-4"><p className="text-sm font-semibold">Free-text labour / service</p><div className="grid gap-3 sm:grid-cols-[1fr_8rem_auto]"><Input aria-label="Labour description" value={labourDescription} onChange={event => setLabourDescription(event.target.value)} placeholder="Description" /><Input aria-label="Labour price" type="number" min="0" step="0.01" value={labourPrice} onChange={event => setLabourPrice(event.target.value)} placeholder="Price incl GST" /><Button type="button" aria-label="Add labour" onClick={addLabour} variant="outline">Add labour</Button></div></div>
    <div className="grid gap-2">{lines.length === 0 ? <p className="text-sm text-muted-foreground">No lines added yet.</p> : lines.map((line, index) => <div key={`${line.description}-${index}`} className="flex items-center justify-between gap-3 rounded-md bg-secondary/50 px-3 py-2 text-sm"><span>{line.description} · {line.quantity} × {line.unit_price_incl_gst == null ? 'PRICE PENDING' : `$${line.unit_price_incl_gst.toFixed(2)}`}</span><button type="button" className="text-destructive underline" onClick={() => setLines(lines.filter((_, i) => i !== index))}>Remove</button></div>)}</div>
    {tenderMode ? <div className="grid gap-3 rounded-lg border p-4"><p className="text-sm font-semibold">Manual tender</p><p className="text-xs text-muted-foreground">Leave the amount empty for an approved business on-account sale. The server validates settlement and balance.</p><div className="grid gap-3 sm:grid-cols-2"><select aria-label="Tender method" value={tenderMethod} onChange={event => setTenderMethod(event.target.value as typeof tenderMethod)} className="h-11 rounded-md border border-input bg-background px-3"><option value="cash">Cash</option><option value="eftpos">EFTPOS</option><option value="bank_transfer">Bank transfer</option></select><Input aria-label="Tender amount" inputMode="decimal" value={tenderAmount} onChange={event => setTenderAmount(event.target.value)} placeholder="Amount incl GST" /></div></div> : null}
    <SaleSubmitButton label={actionLabel} disabled={lines.length === 0 || !selectedLocationId || businessSelectionBlocked} />
  </form>;
}
