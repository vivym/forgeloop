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
        <RadixDialog.Overlay className="fl-dialog__overlay" />
        <RadixDialog.Content className="fl-dialog">
          <RadixDialog.Title className="fl-dialog__title">{title}</RadixDialog.Title>
          {description ? <RadixDialog.Description className="fl-dialog__description">{description}</RadixDialog.Description> : null}
          <div className="fl-dialog__content">{content}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function DialogPanel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('fl-dialog__panel', className)}>{children}</div>;
}

export interface DialogCloseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
}

export function DialogClose({ children = 'Close', className, label, type = 'button', ...props }: DialogCloseProps) {
  return (
    <RadixDialog.Close {...props} aria-label={label} className={cn('fl-dialog__close', className)} type={type}>
      {children}
    </RadixDialog.Close>
  );
}
