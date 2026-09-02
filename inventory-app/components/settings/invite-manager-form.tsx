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

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Permissions</legend>
        {MANAGER_GRANTABLE_PERMISSIONS.map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="permissions"
              value={key}
              defaultChecked={key === 'inventory.view'}
              className="size-4"
            />
            {PERMISSION_LABELS[key]}
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
