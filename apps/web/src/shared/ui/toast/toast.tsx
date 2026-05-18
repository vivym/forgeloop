import * as RadixToast from '@radix-ui/react-toast';
import type { ReactNode } from 'react';

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
  description?: ReactNode;
  open?: boolean;
  title: ReactNode;
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  onOpenChange?: (open: boolean) => void;
}

export function Toast({ action, description, open, title, variant = 'neutral', onOpenChange }: ToastProps) {
  const rootProps = {
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
    ...(open === undefined ? {} : { open }),
  };

  return (
    <RadixToast.Root className={`fl-toast fl-toast--${variant}`} {...rootProps}>
      <RadixToast.Title className="fl-toast__title">{title}</RadixToast.Title>
      {description ? <RadixToast.Description className="fl-toast__description">{description}</RadixToast.Description> : null}
      {action ? <div className="fl-toast__action">{action}</div> : null}
    </RadixToast.Root>
  );
}
