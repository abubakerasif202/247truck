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
    <main className="grid min-h-dvh bg-white lg:grid-cols-[minmax(24rem,0.9fr)_1.1fr]">
      <section className="relative hidden overflow-hidden bg-brand-near-black p-12 text-white lg:flex lg:flex-col lg:justify-between" aria-label="24/7 Truck Tyre Services inventory operations">
        <div className="absolute inset-0 opacity-[0.07]" aria-hidden="true" style={{ backgroundImage: 'repeating-linear-gradient(115deg, transparent 0 34px, #fff 34px 40px, transparent 40px 72px)' }} />
        <div className="relative z-10 w-fit rounded-md bg-white p-3">
          <Image src="/brand/logo-real-horizontal.png" alt="24/7 Truck Tyre Services" width={260} height={86} priority />
        </div>
        <div className="relative z-10 max-w-md before:mb-5 before:block before:h-1 before:w-14 before:bg-brand-red">
          <p className="font-display text-sm uppercase tracking-[0.2em] text-brand-red-on-dark">24/7 Operations</p>
          <h1 className="mt-3 text-5xl uppercase leading-[0.96]">Inventory &amp; Purchasing System</h1>
          <p className="mt-5 text-sm leading-6 text-white/65">Purpose-built stock control for Lonsdale and Regency Park workshop operations.</p>
        </div>
        <p className="relative z-10 text-xs uppercase tracking-[0.15em] text-white/40">24/7 Truck Tyre Services · Adelaide</p>
      </section>

      <section className="mx-auto flex w-full max-w-md flex-col justify-center gap-8 px-6 py-12 sm:px-10">
      <div className="flex flex-col items-center gap-4 text-center lg:items-start lg:text-left">
        <Image
          src="/brand/logo-real-horizontal.png"
          alt="24/7 Truck Tyre Services"
          width={220}
          height={64}
          priority
          className="lg:hidden"
        />
        <div><p className="operations-eyebrow">Secure staff access</p><h2 className="font-display text-3xl uppercase">Inventory sign in</h2><p className="mt-2 text-sm text-muted-foreground">Sign in to 24/7 Inventory Operations.</p></div>
      </div>

      {showReset ? (
        <form action={resetAction} className="form-surface flex flex-col gap-4 rounded-xl border border-border p-6" noValidate>
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
        <form action={formAction} className="form-surface flex flex-col gap-4 rounded-xl border border-border p-6" noValidate>
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
      </section>
    </main>
  );
}
