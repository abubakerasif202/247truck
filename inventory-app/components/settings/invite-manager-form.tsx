'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LOCATION_CODES, LOCATION_NAMES } from '@/lib/app-config';
import {
  MANAGER_GRANTABLE_PERMISSIONS,
  PERMISSION_LABELS,
} from '@/lib/auth/permission-keys';
import {
  inviteManagerAction,
  type UsersActionResult,
} from '@/app/(protected)/settings/users/actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11" disabled={pending}>
      {pending ? 'Sending…' : 'Send invitation'}
    </Button>
  );
}

export function InviteManagerForm() {
  const [state, formAction] = useActionState<
    UsersActionResult | undefined,
    FormData
  >(inviteManagerAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required className="h-11" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" name="displayName" required className="h-11" />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Location</legend>
        {LOCATION_CODES.map((code) => (
          <label key={code} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="locationCode"
              value={code}
              defaultChecked={code === 'LON'}
              className="size-4"
            />
            {LOCATION_NAMES[code]}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="financeDiscountLimitPercent">
          Discount cap % (optional)
        </Label>
        <Input
          id="financeDiscountLimitPercent"
          name="financeDiscountLimitPercent"
          type="number"
          min={0}
          max={100}
          step="0.01"
          inputMode="decimal"
          className="h-11"
        />
        <p className="text-xs text-muted-foreground">
          Blank or 0 means no positive discount authority. This is a cap only — the
          Manager also needs the &ldquo;Apply line discounts&rdquo; permission.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Permissions</legend>
        {MANAGER_GRANTABLE_PERMISSIONS.map((key) => (
          <label key={key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="permissions"
              value={key}
              defaultChecked={key === 'inventory.view'}
              className="mt-0.5 size-4"
            />
            <span>
              {PERMISSION_LABELS[key]}
              {key === 'refunds.create' ? (
                <span className="mt-0.5 block text-xs text-amber-700">
                  In v1 this lets the same Manager both approve and confirm an
                  eligible branch refund within mathematical limits. There is no
                  automatic second approver.
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>

      {state?.ok === false ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state?.ok === true ? (
        <p role="status" className="text-sm text-emerald-700">
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
