import { Link, useSearchParams } from 'react-router';

import { useWorkItemsQuery } from '../../shared/api/hooks';
import type { WorkItem } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { DataTable, StatusPill } from '../../shared/ui';
import { formatValue } from './work-item-view-model';

export function WorkItemsList() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const query = useWorkItemsQuery(projectId);
  const filters = parseWorkItemFilters(searchParams);
  const items = filterWorkItems(query.data ?? [], filters);

  return (
    <>
      <PageHeader
        actions={
          <Link className="fl-button fl-button--primary" to="/work-items/new">
            New Work Item
          </Link>
        }
        subtitle="Track product work from brief through validation, evidence, and release readiness."
        title="Work Items"
      />
      <Section title="Active work">
        {query.status === 'pending' ? <p className="empty">Loading work items.</p> : null}
        {query.isError ? <p className="empty">Work item data is temporarily unavailable.</p> : null}
        {query.status !== 'pending' && !query.isError ? (
          <DataTable
            columns={[
              {
                key: 'title',
                header: 'Work item',
                cell: (item) => (
                  <div className="entity-summary">
                    <Link to={`/work-items/${encodeURIComponent(item.id)}`}>{item.title}</Link>
                    <span>{item.goal}</span>
                  </div>
                ),
              },
              { key: 'kind', header: 'Kind', cell: (item) => formatValue(item.kind) },
              { key: 'priority', header: 'Priority', cell: (item) => item.priority },
              { key: 'risk', header: 'Risk', cell: (item) => formatValue(item.risk) },
              { key: 'state', header: 'State', cell: (item) => <StatusPill tone="info">{formatValue(item.phase)}</StatusPill> },
            ]}
            emptyMessage="No work items match the current product filters."
            getRowKey={(item) => item.id}
            rows={items}
          />
        ) : null}
      </Section>
    </>
  );
}

interface WorkItemFilters {
  kind?: string;
  risk?: string;
  phase?: string;
  status?: string;
}

function parseWorkItemFilters(searchParams: URLSearchParams): WorkItemFilters {
  return {
    ...optionalSearchFilter(searchParams, 'kind'),
    ...optionalSearchFilter(searchParams, 'risk'),
    ...optionalSearchFilter(searchParams, 'phase'),
    ...optionalSearchFilter(searchParams, 'status'),
  };
}

function optionalSearchFilter(searchParams: URLSearchParams, key: keyof WorkItemFilters) {
  const value = searchParams.get(key)?.trim();
  return value ? { [key]: value } : {};
}

function filterWorkItems(items: WorkItem[], filters: WorkItemFilters) {
  return items.filter((item) => {
    if (filters.kind !== undefined && item.kind !== filters.kind) return false;
    if (filters.risk !== undefined && item.risk !== filters.risk) return false;
    if (filters.phase !== undefined && item.phase !== filters.phase) return false;
    if (filters.status !== undefined && !matchesWorkItemStatus(item, filters.status)) return false;
    return true;
  });
}

function matchesWorkItemStatus(item: WorkItem, status: string) {
  return item.activity_state === status || item.gate_state === status || item.resolution === status;
}
