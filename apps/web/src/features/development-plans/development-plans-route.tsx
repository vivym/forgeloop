import { Link } from 'react-router';

import { useDevelopmentPlansQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { Badge, DataTable, EmptyState, InlineNotice, StatusPill, type DataTableColumn } from '../../shared/ui';
import { SurfaceStateIndicator } from '../project-management/surface-state';
import { formatValue } from './development-plan-table';

type DevelopmentPlanListRow = {
  id: string;
  title: string;
  status?: string;
  source_refs?: Array<{ type: string; id: string; title?: string }>;
  item_count?: number;
  blocked_count?: number;
  updated_at?: string;
};

export function DevelopmentPlansRoute() {
  const { projectId } = useProjectContext();
  const query = useDevelopmentPlansQuery({ project_id: projectId });
  const rows = (query.data?.items ?? []) as DevelopmentPlanListRow[];

  return (
    <div className="grid gap-6">
      <PageHeader
        actions={<Link className="inline-flex min-h-10 items-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white" to="/development-plans/new">New Development Plan</Link>}
        subtitle="Plan source-object delivery as governed rows before Spec and Execution Plan authoring."
        title="Development Plans"
      />
      <SurfaceStateIndicator label="Development Plans" state={query.isLoading ? 'loading' : query.isError ? 'error' : rows.length === 0 ? 'empty' : undefined} />
      {query.isError ? <InlineNotice title="Development Plans could not be loaded." tone="danger" /> : null}
      <Section title="Planning table">
        <DataTable
          ariaLabel="Development Plans"
          columns={columns}
          emptyMessage={<EmptyState title="No Development Plans yet." />}
          getRowKey={(row) => row.id}
          rows={rows}
        />
      </Section>
    </div>
  );
}

export function DevelopmentPlanNewRoute() {
  return (
    <div className="grid gap-6">
      <PageHeader
        subtitle="Create from a source object workspace, or start from an approved product initiative."
        title="New Development Plan"
      />
      <Section title="Create from source context">
        <EmptyState
          actions={<Link className="font-semibold text-primary hover:underline" to="/requirements">Choose a Requirement</Link>}
          description="Manual creation is available from each source object action rail so the plan keeps its source link."
          title="Pick a source object first."
        />
      </Section>
    </div>
  );
}

const columns: DataTableColumn<DevelopmentPlanListRow>[] = [
  {
    key: 'title',
    header: 'Development Plan',
    cell: (row) => (
      <Link className="font-semibold text-primary hover:underline" to={`/development-plans/${encodeURIComponent(row.id)}`}>
        {row.title}
      </Link>
    ),
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusPill tone={row.status === 'active' ? 'info' : 'neutral'}>{formatValue(row.status)}</StatusPill> },
  { key: 'source', header: 'Source objects', cell: (row) => row.source_refs?.map((ref) => ref.title ?? ref.id).join(', ') || 'Not linked' },
  { key: 'items', header: 'Rows', cell: (row) => row.item_count ?? 0 },
  { key: 'blocked', header: 'Blocked', cell: (row) => <Badge tone={row.blocked_count ? 'warning' : 'success'}>{row.blocked_count ?? 0}</Badge> },
  { key: 'updated', header: 'Updated', cell: (row) => formatDate(row.updated_at) },
];

function formatDate(value: string | undefined): string {
  if (value === undefined) return 'Not recorded';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
