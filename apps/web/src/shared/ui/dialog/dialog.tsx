import * as RadixDialog from '@radix-ui/react-dialog';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface DialogProps {
  children?: ReactNode;
  content: ReactNode;
  description?: ReactNode;
  open?: boolean;
  title: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

export function Dialog({ children, content, description, open, title, onOpenChange }: DialogProps) {
  const rootProps = {
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
    ...(open === undefined ? {} : { open }),
  };

  return (
    <RadixDialog.Root {...rootProps}>
      {children ? <RadixDialog.Trigger asChild>{children}</RadixDialog.Trigger> : null}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-overlay bg-text-primary/40" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-modal max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-card bg-surface p-6 text-text-primary shadow-overlay">
          <RadixDialog.Title className="m-0 text-xl font-bold leading-tight">{title}</RadixDialog.Title>
          {description ? <RadixDialog.Description className="mt-2 text-text-secondary">{description}</RadixDialog.Description> : null}
          <div className="mt-5">{content}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function DialogPanel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('grid gap-4', className)}>{children}</div>;
}

export interface DialogCloseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
}

export function DialogClose({ children = 'Close', className, label, type = 'button', ...props }: DialogCloseProps) {
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
