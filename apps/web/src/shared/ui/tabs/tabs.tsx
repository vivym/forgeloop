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
    <RadixTabs.Root className={cn('grid min-w-0 gap-4', className)} {...rootProps}>
      <RadixTabs.List className="flex flex-wrap gap-1 border-b border-border">
        {items.map((item) => (
          <RadixTabs.Trigger
            className="border-0 border-b-2 border-transparent bg-transparent px-4 py-3 text-sm font-semibold text-text-muted transition-colors duration-base ease-standard motion-reduce:transition-none data-[state=active]:border-primary data-[state=active]:text-primary disabled:cursor-not-allowed disabled:opacity-60"
            disabled={item.disabled}
            key={item.value}
            value={item.value}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content className="min-w-0" key={item.value} value={item.value}>
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
