import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

type IconButtonVariant = 'secondary' | 'ghost' | 'danger';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  variant?: IconButtonVariant;
  children: ReactNode;
}

export function IconButton({ label, variant = 'secondary', className, children, type = 'button', ...props }: IconButtonProps) {
  return (
    <button aria-label={label} className={cn('fl-icon-button', `fl-icon-button--${variant}`, className)} type={type} {...props}>
      {children}
    </button>
  );
}
