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
    <nav aria-label="Primary" className={cn('fl-sidebar-nav', className)}>
      {title ? <div className="fl-sidebar-nav__title">{title}</div> : null}
      <div className="fl-sidebar-nav__items">
        {items.map(({ active = false, className: itemClassName, label, to, ...item }) => (
          <Link aria-current={active ? 'page' : undefined} className={cn('fl-sidebar-nav__item', active && 'is-active', itemClassName)} key={`${String(to)}-${String(label)}`} to={to} {...item}>
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
