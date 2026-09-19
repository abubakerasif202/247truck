'use client';

import { useState, useTransition } from 'react';

import { setProductActiveAction } from '@/app/(protected)/inventory/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function ArchiveToggle({
  productId,
  active,
}: {
  productId: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function run() {
    startTransition(async () => {
      setError(null);
      const result = await setProductActiveAction(productId, !active);
      if (!result.ok) setError(result.error ?? 'Could not update.');
      else setOpen(false);
    });
  }

  // Un-archiving just restores visibility — not destructive, so it stays a
  // direct one-click action. Archiving hides the product from active
  // inventory views, so it gets a confirmation step first.
  if (!active) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="outline" className="h-9" disabled={pending} onClick={run}>
          {pending ? '…' : 'Unarchive'}
        </Button>
        {error ? (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button type="button" variant="outline" className="h-9" />}>
          Archive
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive product?</DialogTitle>
            <DialogDescription>
              This product will no longer appear in active inventory views. Existing stock records and history are kept, and it can be unarchived at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {/* "Archive product", not "Archive" — the trigger button above already
                uses that exact text, and getByRole('button', {name}) matches by
                substring, so both would resolve if this said "Archive" too. */}
            <Button type="button" variant="destructive" disabled={pending} onClick={run}>
              {pending ? 'Archiving…' : 'Archive product'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
