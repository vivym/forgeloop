import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../../utils/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonStyles = cva(
  'inline-flex min-w-0 items-center justify-center gap-2 rounded-md border text-sm font-semibold transition-colors duration-base ease-standard motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'border-primary bg-primary text-white hover:bg-primary-hover',
        secondary: 'border-border bg-surface text-text-primary hover:border-border-strong hover:bg-surface-muted',
        ghost: 'border-transparent bg-transparent text-text-secondary hover:bg-surface-muted hover:text-text-primary',
        danger: 'border-danger bg-danger text-white hover:bg-danger/90',
      },
      size: {
        sm: 'min-h-9 px-3',
        md: 'min-h-10 px-4',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  variant?: ButtonVariant;
  loading?: boolean;
  iconLeading?: ReactNode;
  iconTrailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    loading = false,
    iconLeading,
    iconTrailing,
    size,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      aria-busy={loading || props['aria-busy'] || undefined}
      className={cn(buttonStyles({ variant, size }), className)}
      disabled={loading || disabled}
      ref={ref}
      type={type}
    >
      {iconLeading !== undefined ? <span className="inline-flex min-w-0 shrink-0 items-center">{iconLeading}</span> : null}
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {loading ? (
          <>
            <span>Loading</span>
            {' '}
            <span>{children}</span>
          </>
        ) : (
          children
        )}
      </span>
      {iconTrailing !== undefined ? <span className="inline-flex min-w-0 shrink-0 items-center">{iconTrailing}</span> : null}
    </button>
  );
});
