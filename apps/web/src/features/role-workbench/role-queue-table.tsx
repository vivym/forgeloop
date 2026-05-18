import { DataTable, StatusPill } from '../../shared/ui';
import type { RoleQueueItemViewModel } from './role-workbench-view-model';

export function RoleQueueTable({ items }: { items: RoleQueueItemViewModel[] }) {
  return (
    <DataTable
      columns={[
        {
          key: 'work-item',
          header: 'Work item',
          cell: (item) => (
            <div className="entity-summary">
              <strong>{item.title}</strong>
              <span>{item.objectId}</span>
            </div>
          ),
        },
        { key: 'object-type', header: 'Object type', cell: (item) => item.objectType },
        { key: 'kind', header: 'Kind', cell: (item) => item.kind },
        { key: 'surface', header: 'Surface', cell: (item) => item.surface },
        { key: 'state', header: 'State', cell: (item) => <StatusPill tone="info">{item.state}</StatusPill> },
        { key: 'risk', header: 'Risk', cell: (item) => item.risk },
      ]}
      emptyMessage="No owned work items match the current product filters."
      getRowKey={(item) => item.id}
      rows={items}
    />
  );
}
