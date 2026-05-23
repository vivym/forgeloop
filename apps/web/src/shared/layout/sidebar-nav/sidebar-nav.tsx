import type { ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';

import { cn } from '../../utils/cn';

export interface SidebarNavItem extends Omit<LinkProps, 'children' | 'className'> {
  label: ReactNode;
  active?: boolean;
  className?: string;
}

export interface SidebarNavProps {
  items: SidebarNavItem[];
  title?: ReactNode;
  className?: string;
}

export function SidebarNav({ items, title, className }: SidebarNavProps) {
  return (
    <nav aria-label="Primary navigation" className={cn('grid gap-5', className)}>
      {title ? <div className="px-2 text-base font-semibold text-text-primary">{title}</div> : null}
      <div className="grid gap-1">
        {items.map(({ active = false, className: itemClassName, label, to, ...item }) => (
          <Link
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors duration-base ease-standard hover:bg-surface-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none',
              active && 'bg-primary-soft text-primary',
              itemClassName,
            )}
            key={`${String(to)}-${String(label)}`}
            to={to}
            {...item}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
