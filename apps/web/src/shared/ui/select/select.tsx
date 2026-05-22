import type { SelectHTMLAttributes } from 'react';

import { resolveAriaInvalid } from '../form-control-state';
import { cn } from '../../utils/cn';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
}

export function Select({ className, options, placeholder, invalid = false, ...props }: SelectProps) {
  const ariaInvalid = resolveAriaInvalid(invalid, props['aria-invalid']);

  return (
    <select
      aria-invalid={ariaInvalid.value}
      className={cn(
        'min-h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary transition-colors duration-base ease-standard motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60',
        ariaInvalid.isInvalid ? 'border-danger' : null,
        className,
      )}
      {...props}
    >
      {placeholder ? (
        <option value="" disabled={props.required}>
          {placeholder}
        </option>
      ) : null}
      {options.map((option) => (
        <option disabled={option.disabled} key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
