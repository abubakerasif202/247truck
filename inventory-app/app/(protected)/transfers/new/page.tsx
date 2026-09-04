import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createTransferFormAction } from '../actions';

export default async function NewTransferPage() {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'inventory.transfer_request')) redirect('/transfers');
  const supabase = await createServerSupabaseClient();
  const [{ data: locations }, { data: products }] = await Promise.all([
    supabase.from('locations').select('id,code,name').eq('active', true).order('code'),
    supabase.from('products').select('id,name,part_reference').eq('active', true).order('name'),
  ]);
  const availableLocations = locations ?? [];
  return <div className="grid max-w-2xl gap-6"><PageHeader title="New stock transfer" subtitle="Request a controlled transfer between the two branches." />
    <form action={createTransferFormAction} className="grid gap-5 rounded-xl border bg-card p-5">
      <div className="grid gap-2"><Label htmlFor="source">Source branch</Label><select id="source" name="source_location_id" required className="h-10 rounded-md border bg-background px-3">{availableLocations.map(l => <option key={l.id} value={l.id}>{l.name}{access.role === 'manager' && l.id !== access.locationId ? ' (request from branch)' : ''}</option>)}</select></div>
      <div className="grid gap-2"><Label htmlFor="destination">Destination branch</Label><select id="destination" name="destination_location_id" required className="h-10 rounded-md border bg-background px-3">{availableLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
      <div className="grid gap-2"><Label htmlFor="product">Product</Label><select id="product" name="product_id" required className="h-10 rounded-md border bg-background px-3"><option value="">Choose a product</option>{(products ?? []).map(p => <option key={p.id} value={p.id}>{p.name}{p.part_reference ? ` · ${p.part_reference}` : ''}</option>)}</select></div>
      <div className="grid gap-2"><Label htmlFor="quantity">Requested quantity</Label><Input id="quantity" name="requested_quantity" type="number" min="1" step="1" required /></div>
      <div className="grid gap-2"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" placeholder="Reason or handling notes" /></div>
      <Button type="submit">Submit transfer request</Button>
    </form>
  </div>;
}
