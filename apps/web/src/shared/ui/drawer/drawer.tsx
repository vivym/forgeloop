import * as RadixDialog from '@radix-ui/react-dialog';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface DrawerProps {
  children?: ReactNode;
  content: ReactNode;
  description?: ReactNode;
  open?: boolean;
  side?: 'left' | 'right';
  title: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

export function Drawer({ children, content, description, open, side = 'right', title, onOpenChange }: DrawerProps) {
  const rootProps = {
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
    ...(open === undefined ? {} : { open }),
  };

  return (
    <RadixDialog.Root {...rootProps}>
      {children ? <RadixDialog.Trigger asChild>{children}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-overlay bg-text-primary/40" />
        <RadixDialog.Content
          className={cn(
            'fixed bottom-0 top-0 z-drawer w-[min(28rem,100vw)] overflow-auto bg-surface p-6 text-text-primary shadow-overlay',
            side === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <RadixDialog.Title className="m-0 text-xl font-bold leading-tight">{title}</RadixDialog.Title>
          {description ? <RadixDialog.Description className="mt-2 text-text-secondary">{description}</RadixDialog.Description> : null}
          <div className="mt-5">{content}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface DrawerCloseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
}

export function DrawerClose({ children = 'Close', className, label, type = 'button', ...props }: DrawerCloseProps) {
  return (
    <RadixDialog.Close
      {...props}
      aria-label={label}
      className={cn('inline-flex min-h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-secondary transition-colors duration-base ease-standard hover:border-border-strong hover:text-text-primary motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60', className)}
      type={type}
    >
      {children}
    </RadixDialog.Close>
  );
}
