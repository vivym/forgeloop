import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../utils/cn';

type IconButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const iconButtonStyles = cva(
  'inline-flex shrink-0 items-center justify-center rounded-md border text-sm font-semibold transition-colors duration-base ease-standard motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'border-primary bg-primary text-white hover:bg-primary-hover',
        secondary: 'border-border bg-surface text-text-primary hover:border-border-strong hover:bg-surface-muted',
        ghost: 'border-transparent bg-transparent text-text-secondary hover:bg-surface-muted hover:text-text-primary',
        danger: 'border-danger bg-danger text-white hover:bg-danger/90',
      },
      size: {
        sm: 'size-9',
        md: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>, VariantProps<typeof iconButtonStyles> {
  label: string;
  variant?: IconButtonVariant;
  children: ReactNode;
}

export function IconButton({ label, variant = 'secondary', size, className, children, type = 'button', ...props }: IconButtonProps) {
  return (
    <button {...props} aria-label={label} className={cn(iconButtonStyles({ variant, size }), className)} type={type}>
      {children}
    </button>
  );
}
