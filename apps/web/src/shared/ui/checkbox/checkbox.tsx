import type { InputHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
}

export function Checkbox({ className, label, ...props }: CheckboxProps) {
  return (
    <label className={cn('fl-checkbox', className)}>
      <input className="fl-checkbox__control" type="checkbox" {...props} />
      {label ? <span className="fl-checkbox__label">{label}</span> : null}
    </label>
  );
}
