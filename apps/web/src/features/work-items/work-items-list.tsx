import { Link } from 'react-router';

import { usePipelineQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { DataTable, StatusPill } from '../../shared/ui';
import { formatValue } from './work-item-view-model';

export function WorkItemsList() {
  const { projectId } = useProjectContext();
  const query = usePipelineQuery(projectId);
  const items = query.data ?? [];

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
