import type { ReactNode } from 'react';

import { ProductPage, type ProductPageProps } from '../../shared/layout';

type ObjectListWorkspaceProps = {
  inspector?: ReactNode;
  table: ReactNode;
  toolbar: ReactNode;
};

export interface ObjectListProps {
  ariaLabel?: string | undefined;
  className?: string | undefined;
  family: ProductPageProps['family'];
  heading: string;
  inspector?: ReactNode;
  table: ReactNode;
  toolbar: ReactNode;
  Workspace: (props: ObjectListWorkspaceProps) => ReactNode;
}

export function ObjectList({
  ariaLabel,
  className,
  family,
  heading,
  inspector,
  table,
  toolbar,
  Workspace,
}: ObjectListProps) {
  return (
    <ProductPage className={className} family={family} ariaLabel={ariaLabel ?? heading}>
      <h1 className="mb-3 text-xl font-semibold text-text-primary">{heading}</h1>
      <Workspace toolbar={toolbar} table={table} inspector={inspector} />
    </ProductPage>
  );
}
