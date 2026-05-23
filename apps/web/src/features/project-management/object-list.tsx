import { Link } from 'react-router';

import { PageHeader, Section } from '../../shared/layout';
import { DataTable, InlineNotice, Input, StatusPill, type DataTableColumn } from '../../shared/ui';

export interface ProjectObjectListItem {
  id: string;
  ref: { type: string; id: string };
  title: string;
  status: string;
  priority?: string | undefined;
  risk?: string | undefined;
  driver_actor_id?: string | undefined;
  updated_at?: string | undefined;
}

export interface ObjectListProps<T extends ProjectObjectListItem> {
  createHref: string;
  detailHref: (item: T) => string;
  emptyMessage: string;
  error?: Error | null;
  isLoading: boolean;
  items: T[];
  subtitle: string;
  title: string;
}

export function ObjectList<T extends ProjectObjectListItem>({
  createHref,
  detailHref,
  emptyMessage,
  error,
  isLoading,
  items,
  subtitle,
  title,
}: ObjectListProps<T>) {
  const columns: DataTableColumn<T>[] = [
    {
      key: 'title',
      header: title,
      cell: (item) => (
        <Link className="font-semibold text-primary hover:underline" to={detailHref(item)}>
          {item.title}
        </Link>
      ),
    },
    { key: 'status', header: 'Status', cell: (item) => <StatusPill tone="neutral">{item.status}</StatusPill> },
    { key: 'priority', header: 'Priority', cell: (item) => item.priority ?? 'Unscored' },
    { key: 'risk', header: 'Risk', cell: (item) => item.risk ?? 'Unscored' },
    { key: 'driver', header: 'Driver', cell: (item) => item.driver_actor_id ?? 'Unassigned' },
  ];

  return (
    <>
      <PageHeader
        actions={
          <Link className="inline-flex min-h-10 items-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white" to={createHref}>
            New
          </Link>
        }
        subtitle={subtitle}
        title={title}
      />
      <Section title={`${title} backlog`}>
        <div className="grid gap-4">
          <div className="grid gap-2 sm:max-w-sm">
            <label className="text-sm font-semibold text-text-secondary" htmlFor={`${title.toLowerCase().replace(/\s+/g, '-')}-filter`}>
              Filter
            </label>
            <Input id={`${title.toLowerCase().replace(/\s+/g, '-')}-filter`} placeholder={`Filter ${title.toLowerCase()}`} />
          </div>
          {isLoading ? <InlineNotice title={`Loading ${title.toLowerCase()}.`} tone="info" /> : null}
          {error ? <InlineNotice title={`${title} could not be loaded.`} tone="danger" /> : null}
          <DataTable ariaLabel={`${title} list`} columns={columns} emptyMessage={emptyMessage} getRowKey={(item) => item.id} rows={items} />
        </div>
      </Section>
    </>
  );
}
