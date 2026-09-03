'use client';

import { useState, useTransition } from 'react';

import { setLocationScopeAction } from '@/app/(protected)/actions';
import { LOCATION_CODES, LOCATION_NAMES } from '@/lib/app-config';
import type { AccessSnapshot } from '@/lib/auth/permissions';
import type { LocationScope } from '@/lib/location/scope';

type Props = {
  access: AccessSnapshot;
  scope: LocationScope;
};

function currentValue(scope: LocationScope): string {
  return scope.kind === 'all' ? 'ALL' : scope.code;
}

export function LocationScopeSelect({ access, scope }: Props) {
  const initial = currentValue(scope);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (access.role === 'manager') {
    return (
      <p className="location-chip" data-location={access.locationCode ?? 'ALL'}>
        {access.locationCode ? LOCATION_NAMES[access.locationCode] : '—'}
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <label className="flex items-center gap-2 text-sm">
        <span className="sr-only">Location scope</span>
        <select
          className="h-9 rounded-md border border-white/20 bg-brand-graphite px-2 text-sm text-white focus-visible:border-brand-red-on-dark"
          value={value}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value;
            const previous = value;
            setValue(next);
            setError(null);
            startTransition(async () => {
              try {
                await setLocationScopeAction(next);
              } catch {
                setValue(previous);
                setError('Could not change the location. Try again.');
              }
            });
          }}
        >
          <option value="ALL">All Locations</option>
          {LOCATION_CODES.map((code) => (
            <option key={code} value={code}>
              {LOCATION_NAMES[code]}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
