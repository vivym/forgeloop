import { Link } from 'react-router';
import type { MyWorkQueueItem } from '@forgeloop/contracts';

import { useMyWorkQuery } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { DataTable, InlineNotice, StatusPill, type DataTableColumn } from '../../shared/ui';

const attentionGroups = [
  { id: 'product', label: 'Product attention' },
  { id: 'tech-lead', label: 'Tech Lead attention' },
  { id: 'developer', label: 'Developer attention' },
  { id: 'qa', label: 'QA attention' },
  { id: 'release-owner', label: 'Release Owner attention' },
  { id: 'manager', label: 'Manager attention' },
] as const;

export function MyWorkRoute() {
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const query = useMyWorkQuery({ project_id: projectId, actor_id: actorId });
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader subtitle="Role-aware product inbox." title="My Work" />
      <div className="grid gap-4">
        {query.isLoading ? <InlineNotice title="Loading My Work." tone="info" /> : null}
        {query.error ? <InlineNotice title="My Work could not be loaded." tone="danger" /> : null}
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
    header: 'Object',
    cell: (item) => {
      const href = typedHrefFor(item.object_ref);
      return href === undefined ? (
        <span className="font-semibold">{item.title}</span>
      ) : (
        <Link className="font-semibold text-primary hover:underline" to={href}>
          {item.title}
        </Link>
      );
    },
  },
  { key: 'type', header: 'Type', cell: (item) => objectTypeLabel(item.object_ref.type) },
  { key: 'reason', header: 'Reason', cell: (item) => <StatusPill tone="neutral">{attentionReasonLabel(item.attention_reason)}</StatusPill> },
  { key: 'action', header: 'Expected action', cell: (item) => item.expected_action ?? 'Review' },
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
    execution_package: 'Evidence Package',
    run_session: 'Run Evidence',
    review_packet: 'Review Evidence',
    attachment: 'Attachment',
  };
  return labels[type];
}

function attentionReasonLabel(reason: string) {
  return reason.replaceAll('_', ' ');
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
      return `/specs/${encodeURIComponent(ref.id)}`;
    case 'execution_plan':
      return `/plans/${encodeURIComponent(ref.id)}`;
    case 'release':
      return `/releases/${encodeURIComponent(ref.id)}`;
    case 'development_plan':
    case 'brainstorming_session':
    case 'boundary_summary':
    case 'spec_revision':
    case 'execution_plan_revision':
    case 'execution':
    case 'code_review_handoff':
    case 'qa_handoff':
    case 'execution_package':
    case 'run_session':
    case 'review_packet':
    case 'attachment':
      return undefined;
  }
}
