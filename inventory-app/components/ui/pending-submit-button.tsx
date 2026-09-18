'use client';

import type { ComponentProps, ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from './button';

type PendingSubmitButtonProps = ComponentProps<typeof Button> & {
  pendingChildren?: ReactNode;
};

/**
 * Keeps a server-action submit from being dispatched twice while it is in flight.
 * It must be rendered inside the form it submits.
 */
export function PendingSubmitButton({
  children,
  disabled,
  pendingChildren = children,
  ...props
}: PendingSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={disabled || pending} {...props}>
      {pending ? pendingChildren : children}
    </Button>
  );
}
