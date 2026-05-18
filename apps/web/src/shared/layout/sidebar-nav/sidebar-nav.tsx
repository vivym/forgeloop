import type { AnchorHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface SidebarNavItem extends AnchorHTMLAttributes<HTMLAnchorElement> {
  label: ReactNode;
  active?: boolean;
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
        {items.map(({ active = false, className: itemClassName, label, ...item }) => (
          <a aria-current={active ? 'page' : undefined} className={cn('fl-sidebar-nav__item', active && 'is-active', itemClassName)} key={`${item.href}-${String(label)}`} {...item}>
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}
