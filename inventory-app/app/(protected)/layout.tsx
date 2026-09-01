import type { ReactNode } from 'react';

import { getCurrentAccess } from '@/lib/auth/access';
import { getCurrentLocationScope } from '@/lib/location/resolve-scope';

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await getCurrentAccess();
  // Resolving here guarantees a Manager with a broken location assignment is
  // bounced to /login before any protected page renders.
  await getCurrentLocationScope(access);

  return <div data-role={access.role}>{children}</div>;
}
