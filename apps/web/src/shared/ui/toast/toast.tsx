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
      <RadixToast.Viewport className="fixed bottom-4 right-4 z-toast m-0 grid w-[min(24rem,calc(100vw-2rem))] list-none gap-3 p-0" />
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

const toastToneClasses = {
  neutral: 'border-border bg-surface text-text-primary',
  success: 'border-success/30 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-warning',
  danger: 'border-danger/30 bg-danger-soft text-danger',
  info: 'border-info/30 bg-info-soft text-info',
} as const;

export function Toast({ action, close, description, open, title, variant = 'neutral', onOpenChange }: ToastProps) {
  const rootProps = {
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
    ...(open === undefined ? {} : { open }),
  };

  return (
    <RadixToast.Root className={cn('rounded-card border p-4 shadow-elevated', toastToneClasses[variant])} {...rootProps}>
      <RadixToast.Title className="font-semibold">{title}</RadixToast.Title>
      {description ? <RadixToast.Description className="mt-1 text-sm text-current/80">{description}</RadixToast.Description> : null}
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
    <RadixToast.Action
      {...props}
      altText={altText}
      aria-label={altText}
      className={cn('mr-2 mt-3 inline-flex min-h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-secondary transition-colors duration-base ease-standard hover:border-border-strong hover:text-text-primary motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60', className)}
      type={type}
    >
      {children}
    </RadixToast.Action>
  );
}

export interface ToastCloseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
}

export function ToastClose({ children = 'Close', className, label, type = 'button', ...props }: ToastCloseProps) {
  return (
    <RadixToast.Close
      {...props}
      aria-label={label}
      className={cn('mr-2 mt-3 inline-flex min-h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text-secondary transition-colors duration-base ease-standard hover:border-border-strong hover:text-text-primary motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60', className)}
      type={type}
    >
      {children}
    </RadixToast.Close>
  );
}
