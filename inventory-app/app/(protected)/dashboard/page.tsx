import { getCurrentAccess } from '@/lib/auth/access';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';
import { LOCATION_NAMES } from '@/lib/app-config';

export default async function DashboardPage() {
  const access = await getCurrentAccess();
  const scope = await getCurrentLocationScope(access);

  const scopeLabel =
    scope.kind === 'all' ? 'All Locations' : LOCATION_NAMES[scope.code];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Dashboard</h1>
      <p className="text-sm text-muted-foreground">
        Signed in as {access.role} · {scopeLabel}
      </p>
      <p className="text-sm text-muted-foreground">
        Inventory metrics arrive in a later task.
      </p>
    </div>
  );
}
