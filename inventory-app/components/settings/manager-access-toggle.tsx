'use client';

import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { setManagerActiveAction } from '@/app/(protected)/settings/users/actions';

export function ManagerAccessToggle({
  userId,
  active,
}: {
  userId: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={active ? 'outline' : 'default'}
      className="h-9"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setManagerActiveAction(userId, !active);
        })
      }
    >
      {pending ? '…' : active ? 'Disable' : 'Enable'}
    </Button>
  );
}
