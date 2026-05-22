import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface MetadataItem {
  label: ReactNode;
  value: ReactNode;
}

export interface MetadataGridProps {
  items: MetadataItem[];
  className?: string;
}

export function MetadataGrid({ className, items }: MetadataGridProps) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map((item, index) => (
        <div className="min-w-0" key={index}>
          <dt className="text-xs font-medium uppercase text-text-secondary">{item.label}</dt>
          <dd className="mt-1 truncate text-sm text-text-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
