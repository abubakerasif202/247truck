import { redirect } from 'next/navigation';

import { InviteManagerForm } from '@/components/settings/invite-manager-form';
import { ManagerAccessToggle } from '@/components/settings/manager-access-toggle';
import { getCurrentAccess } from '@/lib/auth/access';
import { PERMISSION_LABELS } from '@/lib/auth/permission-keys';
import type { PermissionKey } from '@/lib/auth/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type ManagerListRow = {
  user_id: string;
  display_name: string;
  active: boolean;
  role: string;
  locations: { code: string; name: string } | null;
};

type PermissionRow = {
  user_id: string;
  permission_key: string;
  enabled: boolean;
};

export default async function UsersPage() {
  const access = await getCurrentAccess();
  if (access.role !== 'admin') {
    redirect('/dashboard');
  }

  const supabase = await createServerSupabaseClient();
  const [{ data: profiles, error: profilesError }, { data: permissionRows, error: permissionsError }] =
    await Promise.all([
      supabase
        .from('user_profiles')
        .select('user_id, display_name, active, role, locations(code, name)')
        .eq('role', 'manager')
        .order('display_name')
        .returns<ManagerListRow[]>(),
      supabase
        .from('manager_permissions')
        .select('user_id, permission_key, enabled')
        .returns<PermissionRow[]>(),
    ]);

  if (profilesError || permissionsError) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <h1 className="text-lg font-semibold">Users</h1>
        <p className="mt-2 text-sm text-destructive">
          Could not load the Manager list. Please refresh.
        </p>
      </div>
    );
  }

  const permissionsByUser = new Map<string, PermissionKey[]>();
  for (const row of permissionRows ?? []) {
    if (!row.enabled) continue;
    const list = permissionsByUser.get(row.user_id) ?? [];
    list.push(row.permission_key as PermissionKey);
    permissionsByUser.set(row.user_id, list);
  }

  const managers = profiles ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-lg font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Invite Managers and set their branch and permissions.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Invite a Manager</h2>
        <InviteManagerForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Managers</h2>
        {managers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Managers yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {managers.map((manager) => (
              <li
                key={manager.user_id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="font-medium">{manager.display_name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {manager.locations?.name ?? '—'}
                      {manager.active ? '' : ' · disabled'}
                    </span>
                  </div>
                  <ManagerAccessToggle
                    userId={manager.user_id}
                    active={manager.active}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {(permissionsByUser.get(manager.user_id) ?? [])
                    .map((key) => PERMISSION_LABELS[key])
                    .join(', ') || 'No operational permissions'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
