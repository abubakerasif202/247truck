'use client';

import { useState, useTransition } from 'react';

import { setManagerDiscountCapAction } from '@/app/(protected)/settings/users/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ManagerDiscountCap({
  userId,
  current,
}: {
  userId: string;
  current: number | null;
}) {
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      action={() => {
        startTransition(async () => {
          const result = await setManagerDiscountCapAction(userId, value);
          setMessage(
            result.ok
              ? { ok: true, text: result.message }
              : { ok: false, text: result.error },
          );
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`cap-${userId}`} className="text-xs">
          Discount cap %
        </Label>
        <Input
          id={`cap-${userId}`}
          name="percent"
          type="number"
          min={0}
          max={100}
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-9 w-28"
        />
      </div>
      <Button type="submit" variant="outline" className="h-9" disabled={pending}>
        {pending ? 'Saving…' : 'Save cap'}
      </Button>
      {message ? (
        <span
          role="status"
          className={`text-xs ${message.ok ? 'text-emerald-700' : 'text-destructive'}`}
        >
          {message.text}
        </span>
      ) : null}
    </form>
  );
}
