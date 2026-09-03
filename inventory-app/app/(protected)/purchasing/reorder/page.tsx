import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { getCurrentAccess } from '@/lib/auth/access';
import { hasPermission } from '@/lib/auth/permissions';
import { resolveLocationScope } from '@/lib/location/scope';
import {
  listPurchaseOrderLocations,
  listReorderSuggestions,
  listSuppliers,
} from '@/lib/purchasing/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

import { ReorderTable } from '@/components/purchasing/reorder-table';

export default async function ReorderPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const access = await getCurrentAccess();
  if (!hasPermission(access, 'purchasing.view')) redirect('/dashboard');

  const params = await searchParams;
  const requestedLocation = access.role === 'admin' ? params.location ?? 'LON' : null;
  const scope = resolveLocationScope(access, requestedLocation);
  const supabase = await createServerSupabaseClient();
  const [locations, suppliers] = await Promise.all([
    listPurchaseOrderLocations(supabase, access),
    listSuppliers(supabase),
  ]);
  const locationCode = scope.kind === 'location' ? scope.code : 'LON';
  const location = locations.find((item) => item.code === locationCode);
  if (!location) redirect('/purchasing/reorder');

  const suggestions = await listReorderSuggestions(supabase, location.id);
  const canEdit = hasPermission(access, 'purchasing.create_po');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Smart reorder</h1>
          <p className="text-sm text-muted-foreground">
            Review low-stock suggestions and create draft purchase orders when ready.
          </p>
        </div>
        <Badge variant="secondary">Suggestions only</Badge>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <p className="text-xs text-muted-foreground">Location</p>
          <p className="font-medium">{location.name} ({location.code})</p>
        </div>
        {access.role === 'admin' ? (
          <form method="get" className="flex items-end gap-2">
            <label className="grid gap-1 text-sm font-medium" htmlFor="reorder-location">
              View branch
              <select
                id="reorder-location"
                name="location"
                defaultValue={location.code}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                {locations.map((item) => (
                  <option key={item.id} value={item.code}>{item.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" className={cn(buttonVariants({ variant: 'outline' }), 'h-11')}>
              View
            </button>
          </form>
        ) : null}
      </div>

      <ReorderTable
        locationId={location.id}
        suggestions={suggestions}
        suppliers={suppliers}
        canEdit={canEdit}
      />
    </div>
  );
}
