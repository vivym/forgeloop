import type { InputHTMLAttributes } from 'react';

import { cn } from '../../utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ className, invalid = false, ...props }: InputProps) {
  return <input aria-invalid={invalid || props['aria-invalid']} className={cn('fl-input', className)} {...props} />;
}
