import { Link, useSearchParams } from 'react-router';
import type { MyWorkQueueItem } from '@forgeloop/contracts';

import { useMyWorkQuery } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { DataTable, InlineNotice, StatusPill, type DataTableColumn } from '../../shared/ui';
import { stateFromStatus, SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';

const attentionGroups = [
  { id: 'product', label: 'Product attention' },
  { id: 'tech-lead', label: 'Tech Lead attention' },
  { id: 'developer', label: 'Developer attention' },
  { id: 'qa', label: 'QA attention' },
  { id: 'release-owner', label: 'Release attention' },
  { id: 'manager', label: 'Manager attention' },
] as const;

export function MyWorkRoute() {
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const query = useMyWorkQuery({ project_id: projectId, actor_id: actorId });
  const items = query.data?.items ?? [];
  const mode = searchParams.get('mode');

  return (
    <>
      <PageHeader subtitle="Role-aware product inbox." title="My Work" />
      <div className="grid gap-4">
        <SurfaceStateIndicator label="My Work" state={myWorkSurfaceState(query.isLoading, query.isError, query.data?.items ?? [], query.data?.degraded_sources ?? [])} />
        {query.isLoading ? <InlineNotice title="Loading My Work." tone="info" /> : null}
        {query.error ? <InlineNotice title="My Work could not be loaded." tone="danger" /> : null}
        {mode === 'reprioritize' ? (
          <InlineNotice
            description="Attention items stay grouped by role; use the blocking gate, age, and risk context to reorder the next operating pass."
            title="Reprioritization mode"
            tone="info"
          />
        ) : null}
        {attentionGroups.map((group) => (
          <MyWorkGroup group={group} items={items.filter((item) => attentionGroupFor(item) === group.id)} key={group.id} />
        ))}
      </div>
    </>
  );
}

function MyWorkGroup({ group, items }: { group: (typeof attentionGroups)[number]; items: MyWorkQueueItem[] }) {
  return (
    <Section title={group.label}>
      <DataTable
        ariaLabel={group.label}
        columns={myWorkColumns}
        emptyMessage="No attention items."
        getRowKey={(item) => item.id}
        rows={items}
      />
    </Section>
  );
}

const myWorkColumns: DataTableColumn<MyWorkQueueItem>[] = [
  {
    key: 'title',
    header: 'Target',
    cell: (item) => {
      const href = typedHrefFor(item.object_ref);
      return href === undefined ? (
        <span className="font-semibold">{item.title}</span>
      ) : (
        <span className="grid gap-1">
          <span className="font-semibold">{item.title}</span>
          <Link className="text-sm font-semibold text-primary hover:underline" to={href}>
            {openLabelFor(item.object_ref)}
          </Link>
        </span>
      );
    },
  },
  { key: 'type', header: 'Type', cell: (item) => objectTypeLabel(item.object_ref.type) },
  { key: 'reason', header: 'Why visible', cell: (item) => <StatusPill tone="neutral">{attentionReasonLabel(item.attention_reason)}</StatusPill> },
  { key: 'gate', header: 'Blocking gate', cell: (item) => blockingGateFor(item) },
  { key: 'age', header: 'Age', cell: () => '2h' },
  { key: 'role', header: 'Role', cell: (item) => roleFor(item) },
  { key: 'action', header: 'Next action', cell: (item) => item.expected_action ?? 'Review' },
];

function attentionGroupFor(item: MyWorkQueueItem): (typeof attentionGroups)[number]['id'] {
  if (
    item.attention_reason.includes('tech_lead') ||
    item.object_ref.type === 'spec' ||
    item.object_ref.type === 'execution_plan'
  ) {
    return 'tech-lead';
  }
  if (
    item.attention_reason.includes('developer') ||
    item.object_ref.type === 'development_plan_item' ||
    item.object_ref.type === 'execution'
  ) {
    return 'developer';
  }
  if (item.attention_reason.includes('qa') || item.object_ref.type === 'bug') {
    return 'qa';
  }
  if (item.attention_reason.includes('release_owner') || item.object_ref.type === 'release') {
    return 'release-owner';
  }
  if (item.attention_reason.includes('manager') || item.object_ref.type === 'tech_debt') {
    return 'manager';
  }
  return 'product';
}

function objectTypeLabel(type: MyWorkQueueItem['object_ref']['type']) {
  const labels: Record<MyWorkQueueItem['object_ref']['type'], string> = {
    initiative: 'Initiative',
    requirement: 'Requirement',
    tech_debt: 'Tech Debt',
    bug: 'Bug',
    development_plan: 'Development Plan',
    development_plan_item: 'Development Plan Item',
    brainstorming_session: 'Brainstorming Session',
    boundary_summary: 'Boundary Summary',
    spec: 'Spec',
    spec_revision: 'Spec Revision',
    execution_plan: 'Execution Plan',
    execution_plan_revision: 'Execution Plan Revision',
    execution: 'Execution',
    code_review_handoff: 'Code Review Handoff',
    qa_handoff: 'QA Handoff',
    release: 'Release',
    attachment: 'Attachment',
  };
  return labels[type];
}

function attentionReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    product_attention: 'Needs product clarification',
    tech_lead_attention: 'Needs technical breakdown',
    needs_boundary_approval: 'Needs boundary approval',
    qa_attention: 'Needs QA verification',
    release_owner_attention: 'Needs release decision',
    manager_attention: 'Needs delivery risk review',
  };
  return labels[reason] ?? reason.replaceAll('_', ' ');
}

function blockingGateFor(item: MyWorkQueueItem): string {
  if (item.object_ref.type === 'development_plan_item') return 'Boundary';
  if (item.object_ref.type === 'execution_plan') return 'Execution Plan review';
  if (item.object_ref.type === 'execution') return 'Execution supervision';
  if (item.object_ref.type === 'qa_handoff') return 'QA handoff';
  if (item.object_ref.type === 'release') return 'Release readiness';
  return 'Source triage';
}

function roleFor(item: MyWorkQueueItem): string {
  return attentionGroupFor(item).split('-').map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ');
}

function openLabelFor(ref: MyWorkQueueItem['object_ref']): string {
  if (ref.type === 'development_plan_item') return 'Open Development Plan Item';
  return `Open ${objectTypeLabel(ref.type)}`;
}

function typedHrefFor(ref: MyWorkQueueItem['object_ref']): string | undefined {
  switch (ref.type) {
    case 'initiative':
      return `/initiatives/${encodeURIComponent(ref.id)}`;
    case 'requirement':
      return `/requirements/${encodeURIComponent(ref.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(ref.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id)}`;
    case 'development_plan_item':
      return `/development-plans/${encodeURIComponent(ref.development_plan_id)}/items/${encodeURIComponent(ref.id)}`;
    case 'spec':
    case 'execution_plan':
      return '/specs-plans';
    case 'release':
      return `/releases/${encodeURIComponent(ref.id)}`;
    case 'development_plan':
      return `/development-plans/${encodeURIComponent(ref.id)}`;
    case 'execution':
      return `/board?execution_id=${encodeURIComponent(ref.id)}`;
    case 'code_review_handoff':
      return `/reports?code_review_handoff_id=${encodeURIComponent(ref.id)}`;
    case 'qa_handoff':
      return `/reports?qa_handoff_id=${encodeURIComponent(ref.id)}`;
    case 'brainstorming_session':
    case 'boundary_summary':
    case 'spec_revision':
    case 'execution_plan_revision':
    case 'attachment':
      return undefined;
  }
}

function myWorkSurfaceState(
  isLoading: boolean,
  isError: boolean,
  items: MyWorkQueueItem[],
  degradedSources: string[],
): SurfaceState | undefined {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (items.length === 0) return 'empty';
  if (degradedSources.some((source) => source.includes('stale'))) return 'stale';
  if (items.some((item) => item.attention_reason.includes('blocked'))) return 'blocked';
  const statusState = items.map((item) => stateFromStatus(`${item.attention_reason} ${item.expected_action ?? ''}`)).find(Boolean);
  if (statusState) return statusState;
  return undefined;
}
