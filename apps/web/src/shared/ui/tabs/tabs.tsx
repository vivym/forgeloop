import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface TabItem {
  content: ReactNode;
  label: ReactNode;
  value: string;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function Tabs({ items, defaultValue, value, onValueChange, className }: TabsProps) {
  const initialValue = defaultValue ?? items[0]?.value;
  const rootProps = {
    ...(initialValue === undefined ? {} : { defaultValue: initialValue }),
    ...(onValueChange === undefined ? {} : { onValueChange }),
    ...(value === undefined ? {} : { value }),
  };

  return (
    <RadixTabs.Root className={cn('fl-tabs', className)} {...rootProps}>
      <RadixTabs.List className="fl-tabs__list">
        {items.map((item) => (
          <RadixTabs.Trigger className="fl-tabs__trigger" disabled={item.disabled} key={item.value} value={item.value}>
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content className="fl-tabs__content" key={item.value} value={item.value}>
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
