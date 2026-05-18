import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  iconLeading?: ReactNode;
  iconTrailing?: ReactNode;
}

export function Button({
  variant = 'secondary',
  loading = false,
  iconLeading,
  iconTrailing,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button className={cn('fl-button', `fl-button--${variant}`, className)} disabled={loading || disabled} type={type} {...props}>
      {iconLeading !== undefined ? <span className="fl-button__slot">{iconLeading}</span> : null}
      <span className="fl-button__label">{loading ? 'Loading' : children}</span>
      {iconTrailing !== undefined ? <span className="fl-button__slot">{iconTrailing}</span> : null}
    </button>
  );
}
