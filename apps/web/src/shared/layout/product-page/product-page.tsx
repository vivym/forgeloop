import type { ReactNode } from 'react';

import type { ProductPageFamily } from '../../../features/product-surfaces/route-contract';
import { cn } from '../../utils/cn';

export interface ProductPageProps {
  ariaLabel: string;
  children: ReactNode;
  className?: string | undefined;
  family: ProductPageFamily;
}

export function ProductPage({ ariaLabel, children, className, family }: ProductPageProps) {
  return (
    <section
      aria-label={ariaLabel}
      className={cn('min-w-0', className)}
      data-page-family={family}
    >
      {children}
    </section>
  );
}
