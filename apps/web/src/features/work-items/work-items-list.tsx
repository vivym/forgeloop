import { Link } from 'react-router';

import { usePipelineQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { Button, DataTable, StatusPill } from '../../shared/ui';
import { fallbackWorkItem, formatValue } from './work-item-view-model';

export function WorkItemsList() {
  const { projectId } = useProjectContext();
  const query = usePipelineQuery(projectId);
  const items = query.data?.length ? query.data : [fallbackWorkItem('wi-1')];

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
        {query.isError ? <p className="status-line">Work item data is temporarily unavailable.</p> : null}
        <Button variant="ghost">Refresh work items</Button>
      </Section>
    </>
  );
}
