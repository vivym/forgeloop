import { DataTable, StatusPill } from '../../shared/ui';
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
              className="fl-button fl-button--ghost"
              onClick={() => onSelect(row.id)}
              type="button"
            >
              <span className="fl-button__label">{row.title}</span>
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
