import { useEffect, useState, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';

import { cn } from '../../utils/cn';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn('w-full border-collapse overflow-hidden rounded-card border border-border bg-surface text-sm', className)}
      {...props}
    />
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-surface-muted text-text-secondary', className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={className} {...props} />;
}

export function TableHead({ className, scope = 'col', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('border-b border-border px-4 py-3 text-left align-top font-semibold', className)} scope={scope} {...props} />;
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-border px-4 py-3 text-left align-top', className)} {...props} />;
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
    <div className="grid min-w-0 max-w-full gap-3 overflow-x-auto">
      <Table aria-label={ariaLabel} className="hidden md:table">
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
        className="grid gap-3 md:hidden"
        data-responsive-card-list=""
        role="list"
      >
        {renderResponsiveCards && rows.length ? (
          rows.map((row, index) => (
            <article className="grid gap-3 rounded-card border border-border bg-surface p-4" key={getRowKey(row, index)} role="listitem">
              {columns.map((column) => (
                <div className="grid min-w-0 gap-1" key={column.key}>
                  <span className="text-xs font-semibold uppercase text-text-muted">{column.header}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere] text-text-primary">{column.cell(row)}</span>
                </div>
              ))}
            </article>
          ))
        ) : renderResponsiveCards ? (
          <p className="m-0 text-sm text-text-secondary">{emptyMessage}</p>
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
