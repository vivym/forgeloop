import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

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
        <RadixDialog.Overlay className="fl-drawer__overlay" />
        <RadixDialog.Content className={cn('fl-drawer', `fl-drawer--${side}`)}>
          <RadixDialog.Title className="fl-drawer__title">{title}</RadixDialog.Title>
          {description ? <RadixDialog.Description className="fl-drawer__description">{description}</RadixDialog.Description> : null}
          <div className="fl-drawer__content">{content}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
