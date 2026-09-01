import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { getCurrentAccess } from '@/lib/auth/access';
import { toAccessSnapshot } from '@/lib/auth/permissions';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await getCurrentAccess();
  const scope = await getCurrentLocationScope(access);

  return (
    <AppShell access={toAccessSnapshot(access)} scope={scope}>
      {children}
    </AppShell>
  );
}
