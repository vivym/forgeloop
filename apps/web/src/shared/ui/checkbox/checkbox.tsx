import type { InputHTMLAttributes, ReactNode } from 'react';

import { resolveAriaInvalid } from '../form-control-state';
import { cn } from '../../utils/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  invalid?: boolean;
}

export function Checkbox({ className, label, invalid = false, ...props }: CheckboxProps) {
  const ariaInvalid = resolveAriaInvalid(invalid, props['aria-invalid']);

  return (
    <label className={cn('inline-flex items-center gap-2 text-sm font-semibold text-text-secondary', className)}>
      <input
        aria-invalid={ariaInvalid.value}
        className="size-4 accent-primary disabled:cursor-not-allowed disabled:opacity-60"
        type="checkbox"
        {...props}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}
