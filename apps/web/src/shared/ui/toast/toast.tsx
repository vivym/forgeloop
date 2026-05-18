import * as RadixToast from '@radix-ui/react-toast';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  return (
    <RadixToast.Provider swipeDirection="right">
      {children}
      <RadixToast.Viewport className="fl-toast__viewport" />
    </RadixToast.Provider>
  );
}

export interface ToastProps {
  action?: ReactNode;
  close?: ReactNode;
  description?: ReactNode;
  open?: boolean;
  title: ReactNode;
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  onOpenChange?: (open: boolean) => void;
}

export function Toast({ action, close, description, open, title, variant = 'neutral', onOpenChange }: ToastProps) {
  const rootProps = {
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
    ...(open === undefined ? {} : { open }),
  };

  return (
    <RadixToast.Root className={`fl-toast fl-toast--${variant}`} {...rootProps}>
      <RadixToast.Title className="fl-toast__title">{title}</RadixToast.Title>
      {description ? <RadixToast.Description className="fl-toast__description">{description}</RadixToast.Description> : null}
      {action}
      {close}
    </RadixToast.Root>
  );
}

export interface ToastActionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  altText: string;
}

export function ToastAction({ altText, children, className, type = 'button', ...props }: ToastActionProps) {
  return (
    <RadixToast.Action {...props} altText={altText} aria-label={altText} className={cn('fl-toast__action', className)} type={type}>
      {children}
    </RadixToast.Action>
  );
}

export interface ToastCloseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
}

export function ToastClose({ children = 'Close', className, label, type = 'button', ...props }: ToastCloseProps) {
  return (
    <RadixToast.Close {...props} aria-label={label} className={cn('fl-toast__close', className)} type={type}>
      {children}
    </RadixToast.Close>
  );
}
