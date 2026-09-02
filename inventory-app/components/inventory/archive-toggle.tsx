'use client';

import { useState, useTransition } from 'react';

import { setProductActiveAction } from '@/app/(protected)/inventory/actions';
import { Button } from '@/components/ui/button';

export function ArchiveToggle({
  productId,
  active,
}: {
  productId: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        className="h-9"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await setProductActiveAction(productId, !active);
            if (!result.ok) setError(result.error ?? 'Could not update.');
          })
        }
      >
        {pending ? '…' : active ? 'Archive' : 'Unarchive'}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
