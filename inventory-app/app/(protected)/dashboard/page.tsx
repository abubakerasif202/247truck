import { getCurrentAccess } from '@/lib/auth/access';

export default async function DashboardPage() {
  const access = await getCurrentAccess();

  return (
    <main className="p-6">
      <h1 className="text-lg font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {access.role}
        {access.locationCode ? ` · ${access.locationCode}` : ''}.
      </p>
    </main>
  );
}
