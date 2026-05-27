import { useId, type ReactNode } from 'react';

import type { ProductPageFamily } from '../../../features/product-surfaces/route-contract';
import { cn } from '../../utils/cn';

export interface ProductPageProps {
  children: ReactNode;
  className?: string | undefined;
  family: ProductPageFamily;
  heading: ReactNode;
  headingClassName?: string | undefined;
  toolbar?: ReactNode;
}

export function ProductPage({ children, className, family, heading, headingClassName, toolbar }: ProductPageProps) {
  const headingId = useId();
  const label = typeof heading === 'string' ? heading : undefined;

  return (
    <section
      aria-label={label}
      aria-labelledby={label ? undefined : headingId}
      className={cn('grid min-w-0 gap-4 px-4 py-4 md:px-6 md:py-5', className)}
      data-page-family={family}
    >
      <header className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className={cn('m-0 text-lg font-semibold leading-tight text-text-primary', headingClassName)} id={headingId}>
          {heading}
        </h1>
        {toolbar ? <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div> : null}
      </header>
      {children}
    </section>
  );
}
