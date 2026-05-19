import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface PageHeaderProps {
  actions?: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
  className?: string;
}

export function PageHeader({ actions, className, eyebrow, subtitle, title }: PageHeaderProps) {
  return (
    <div className={cn('fl-page-header', className)}>
      <div>
        {eyebrow ? <p className="fl-page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="fl-page-header__title">{title}</h1>
        {subtitle ? <p className="fl-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="fl-page-header__actions">{actions}</div> : null}
    </div>
  );
}
