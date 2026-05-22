import type { InputHTMLAttributes } from 'react';

import { resolveAriaInvalid } from '../form-control-state';
import { cn } from '../../utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ className, invalid = false, ...props }: InputProps) {
  const ariaInvalid = resolveAriaInvalid(invalid, props['aria-invalid']);

  return (
    <input
      aria-invalid={ariaInvalid.value}
      className={cn(
        'min-h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary transition-colors duration-base ease-standard placeholder:text-text-muted motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60',
        ariaInvalid.isInvalid ? 'border-danger' : null,
        className,
      )}
      {...props}
    />
  );
}
