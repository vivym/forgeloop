import { DataTable, StatusPill } from '../../shared/ui';
import { cn } from '../../shared/utils/cn';
import type { ProductLaneRow } from './product-lane-view-model';

export function ProductLaneTable({
  onSelect,
  rows,
  selectedItemId,
}: {
  onSelect: (itemId: string) => void;
  rows: ProductLaneRow[];
  selectedItemId: string | undefined;
}) {
  return (
    <DataTable
      ariaLabel="Product lane items"
      columns={[
        {
          key: 'object',
          header: 'Object',
          cell: (row) => (
            <button
              aria-pressed={row.id === selectedItemId}
              className={cn(
                'inline-flex min-h-9 min-w-0 items-center justify-center gap-2 rounded-md border border-transparent px-3 text-sm font-semibold text-text-secondary transition-colors duration-base ease-standard hover:bg-surface-muted hover:text-text-primary motion-reduce:transition-none',
                row.id === selectedItemId ? 'bg-primary-soft text-primary-hover' : null,
              )}
              onClick={() => onSelect(row.id)}
              type="button"
            >
              <span className="inline-flex min-w-0 items-center gap-1.5">{row.title}</span>
            </button>
          ),
        },
        { key: 'kind', header: 'Kind', cell: (row) => row.kind },
        { key: 'state', header: 'State', cell: (row) => <StatusPill tone="info">{row.state}</StatusPill> },
        { key: 'risk', header: 'Risk', cell: (row) => row.risk },
        { key: 'updated', header: 'Updated', cell: (row) => row.updatedAge },
        { key: 'primary-action', header: 'Primary action', cell: (row) => row.primaryActionLabel },
      ]}
      emptyMessage="No product lane items match the current filters."
      getRowKey={(row) => row.id}
      rows={rows}
    />
  );
}
