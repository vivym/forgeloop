import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  actions?: ReactNode;
  description?: ReactNode;
  title?: ReactNode;
}

export function Section({ actions, children, className, description, title, ...props }: SectionProps) {
  return (
    <section className={cn('fl-section', className)} {...props}>
      {title || description || actions ? (
        <header className="fl-section__header">
          <div>
            {title ? <h2 className="fl-section__title">{title}</h2> : null}
            {description ? <p className="fl-section__description">{description}</p> : null}
          </div>
          {actions ? <div className="fl-section__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="fl-section__body">{children}</div>
    </section>
  );
}
