'use client';

import Image from 'next/image';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  loginAction,
  requestPasswordResetAction,
  type LoginState,
  type ResetState,
} from './actions';

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11 w-full" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useActionState<LoginState | undefined, FormData>(
    loginAction,
    undefined,
  );
  const [resetState, resetAction] = useActionState<
    ResetState | undefined,
    FormData
  >(requestPasswordResetAction, undefined);
  const [showReset, setShowReset] = useState(false);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col items-center gap-4 text-center">
        <Image
          src="/brand/logo-real-horizontal.png"
          alt="24/7 Truck Tyre Services"
          width={220}
          height={64}
          priority
          className="h-auto w-[220px]"
        />
        <h1 className="text-lg font-semibold">Inventory sign in</h1>
      </div>

      {showReset ? (
        <form action={resetAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-11"
            />
          </div>
          {resetState ? (
            <p role="status" className="text-sm text-muted-foreground">
              {resetState.ok ? resetState.message : resetState.error}
            </p>
          ) : null}
          <SubmitButton label="Send reset link" pendingLabel="Sending…" />
          <button
            type="button"
            className="text-sm text-muted-foreground underline"
            onClick={() => setShowReset(false)}
          >
            Back to sign in
          </button>
        </form>
      ) : (
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-11"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-11"
            />
          </div>

          {state?.ok === false ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <SubmitButton label="Sign in" pendingLabel="Signing in…" />
          <button
            type="button"
            className="text-sm text-muted-foreground underline"
            onClick={() => setShowReset(true)}
          >
            Forgot password?
          </button>
        </form>
      )}
    </main>
  );
}
