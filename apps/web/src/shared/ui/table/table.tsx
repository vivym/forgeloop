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
  density?: 'compact' | 'normal';
  emptyMessage?: ReactNode;
  selectedRowKey?: string;
  onSelectRow?: (row: T) => void;
  stickyHeader?: boolean;
  containedScroll?: boolean;
}

export function DataTable<T>({
  ariaLabel,
  columns,
  rows,
  getRowKey,
  density = 'normal',
  emptyMessage = 'No data',
  selectedRowKey,
  onSelectRow,
  stickyHeader = false,
  containedScroll = true,
}: DataTableProps<T>) {
  const renderResponsiveCards = useResponsiveCards();
  const compact = density === 'compact';

  return (
    <div
      className={cn('grid min-w-0 max-w-full gap-3', containedScroll ? 'overflow-x-auto' : undefined)}
      data-table-scroll-container=""
    >
      <Table aria-label={ariaLabel} className="hidden md:table">
        <TableHeader className={stickyHeader ? 'sticky top-0 z-sticky' : undefined}>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                className={cn(compact ? 'px-3 py-2.5 text-xs' : undefined, stickyHeader ? 'sticky top-0 z-sticky bg-surface-muted' : undefined)}
                key={column.key}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row, index) => {
              const key = getRowKey(row, index);
              const isSelected = selectedRowKey === key;

              return (
                <TableRow
                  aria-selected={isSelected ? 'true' : undefined}
                  className={cn(
                    onSelectRow ? 'cursor-pointer transition-colors duration-fast ease-standard motion-reduce:transition-none hover:bg-surface-muted/70' : undefined,
                    isSelected ? 'bg-primary-soft/70' : undefined,
                  )}
                  key={key}
                  onClick={onSelectRow ? () => onSelectRow(row) : undefined}
                >
                  {columns.map((column) => (
                    <TableCell className={compact ? 'px-3 py-2.5' : undefined} key={column.key}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell className={compact ? 'px-3 py-2.5' : undefined} colSpan={columns.length}>
                {emptyMessage}
              </TableCell>
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
          rows.map((row, index) => {
            const key = getRowKey(row, index);
            const isSelected = selectedRowKey === key;

            return (
              <article
                className={cn(
                  'grid gap-3 rounded-card border border-border bg-surface p-4',
                  compact ? 'gap-2 p-3' : undefined,
                  onSelectRow ? 'cursor-pointer transition-colors duration-fast ease-standard motion-reduce:transition-none hover:bg-surface-raised' : undefined,
                  isSelected ? 'border-primary/40 bg-primary-soft/50' : undefined,
                )}
                data-selected-row={isSelected ? 'true' : undefined}
                key={key}
                onClick={onSelectRow ? () => onSelectRow(row) : undefined}
                role="listitem"
              >
                {columns.map((column) => (
                  <div className="grid min-w-0 gap-1" key={column.key}>
                    <span className="text-xs font-semibold uppercase text-text-muted">{column.header}</span>
                    <span className="min-w-0 [overflow-wrap:anywhere] text-text-primary">{column.cell(row)}</span>
                  </div>
                ))}
              </article>
            );
          })
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
