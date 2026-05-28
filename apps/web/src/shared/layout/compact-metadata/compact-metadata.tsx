import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface CompactMetadataItem {
  label: ReactNode;
  value: ReactNode;
}

export interface CompactMetadataProps {
  items: CompactMetadataItem[];
  className?: string;
}

export function CompactMetadata({ className, items }: CompactMetadataProps) {
  return (
    <dl className={cn('m-0 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3', className)} data-compact-metadata="">
      {items.map((item, index) => (
        <div className="min-w-0" key={index}>
          <dt className="truncate text-xs font-medium uppercase text-text-secondary">{item.label}</dt>
          <dd className="m-0 mt-1 text-sm text-text-primary [overflow-wrap:anywhere]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
