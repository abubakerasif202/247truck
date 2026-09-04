'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createTransferAction } from '@/app/(protected)/transfers/actions';

type Location = { id: string; name: string };
type Product = { id: string; name: string; part_reference: string | null };

export function TransferRequestForm({ locations, products, managerLocationId }: { locations: Location[]; products: Product[]; managerLocationId: string | null }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createTransferAction, undefined);
  const [lineKeys, setLineKeys] = useState([0]);
  useEffect(() => { if (state?.ok && state.transferId) router.push(`/transfers/${state.transferId}`); }, [router, state]);
  const own = locations.find(location => location.id === managerLocationId);
  const other = locations.find(location => location.id !== managerLocationId);
  return <form action={action} className="grid gap-5 rounded-xl border bg-card p-5">
    <div className="grid gap-2"><Label htmlFor="source">Source branch</Label><select id="source" name="source_location_id" required defaultValue={own?.id ?? locations[0]?.id} className="h-10 rounded-md border bg-background px-3">{locations.map(location => <option key={location.id} value={location.id}>{location.name}{managerLocationId && location.id !== managerLocationId ? ' (request from branch)' : ''}</option>)}</select></div>
    <div className="grid gap-2"><Label htmlFor="destination">Destination branch</Label><select id="destination" name="destination_location_id" required defaultValue={other?.id ?? locations[1]?.id} className="h-10 rounded-md border bg-background px-3">{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
    <fieldset className="grid gap-3"><legend className="font-medium">Products</legend>{lineKeys.map((key, index) => <div key={key} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_8rem_auto]"><div className="grid gap-2"><Label htmlFor={`product-${key}`}>Product {index + 1}</Label><select id={`product-${key}`} name="product_id" required className="h-10 rounded-md border bg-background px-3"><option value="">Choose a product</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}{product.part_reference ? ` · ${product.part_reference}` : ''}</option>)}</select></div><div className="grid gap-2"><Label htmlFor={`quantity-${key}`}>Quantity {index + 1}</Label><Input id={`quantity-${key}`} name="requested_quantity" type="number" min="1" step="1" required /></div><Button type="button" variant="outline" className="self-end" disabled={lineKeys.length === 1} onClick={() => setLineKeys(keys => keys.filter(item => item !== key))}>Remove</Button></div>)}</fieldset>
    <Button type="button" variant="outline" onClick={() => setLineKeys(keys => [...keys, Math.max(...keys) + 1])}>Add product line</Button>
    <div className="grid gap-2"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" placeholder="Reason or handling notes" /></div>
    {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    <Button type="submit" disabled={pending}>{pending ? 'Submitting…' : 'Submit transfer request'}</Button>
  </form>;
}
