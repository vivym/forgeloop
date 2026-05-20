import { useEffect, useState, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';

import { cn } from '../../utils/cn';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('fl-table', className)} {...props} />;
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('fl-table__head', className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('fl-table__body', className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('fl-table__row', className)} {...props} />;
}

export function TableHead({ className, scope = 'col', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('fl-table__cell', 'fl-table__cell--head', className)} scope={scope} {...props} />;
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('fl-table__cell', className)} {...props} />;
}

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  ariaLabel?: string;
  emptyMessage?: ReactNode;
}

export function DataTable<T>({ ariaLabel, columns, rows, getRowKey, emptyMessage = 'No data' }: DataTableProps<T>) {
  const renderResponsiveCards = useResponsiveCards();

  return (
    <div className="fl-responsive-table">
      <Table aria-label={ariaLabel}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key}>{column.header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row, index) => (
              <TableRow key={getRowKey(row, index)}>
                {columns.map((column) => (
                  <TableCell key={column.key}>{column.cell(row)}</TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length}>{emptyMessage}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div
        aria-label={ariaLabel ? `${ariaLabel} cards` : undefined}
        className="fl-responsive-card-list"
        data-responsive-card-list=""
        role="list"
      >
        {renderResponsiveCards && rows.length ? (
          rows.map((row, index) => (
            <article className="fl-responsive-card-list__item" key={getRowKey(row, index)} role="listitem">
              {columns.map((column) => (
                <div className="fl-responsive-card-list__field" key={column.key}>
                  <span className="fl-responsive-card-list__label">{column.header}</span>
                  <span className="fl-responsive-card-list__value">{column.cell(row)}</span>
                </div>
              ))}
            </article>
          ))
        ) : renderResponsiveCards ? (
          <p className="empty">{emptyMessage}</p>
        ) : null}
      </div>
    </div>
  );
}

function useResponsiveCards() {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia('(max-width: 767px)');
    setMatches(query.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return matches;
}
