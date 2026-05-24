import { Link, useParams } from 'react-router';

import {
  useBoundarySummaryRevisionsQuery,
  useDevelopmentPlanItemQuery,
  useDevelopmentPlanItemRevisionsQuery,
} from '../../shared/api/hooks';
import { PageHeader, Section } from '../../shared/layout';
import { InlineNotice, StatusPill } from '../../shared/ui';
import { BrainstormingPanel } from '../brainstorming/brainstorming-panel';
import { SurfaceStateIndicator } from '../project-management/surface-state';
import {
  BoundarySummaryRevisionHistory,
  ItemStructuredFields,
  PlanItemGateSummary,
  PlanItemRevisionHistory,
  type BoundarySummaryRevision,
  type DevelopmentPlanItemProjection,
  type DevelopmentPlanItemRevision,
} from './plan-item-gates';
import { itemHref } from './development-plan-table';

type BrainstormingSession = {
  id: string;
  approval_state?: string;
  questions?: Array<{ id: string; text: string; status?: string }>;
  decisions?: Array<{ id: string; text: string; rationale?: string }>;
};

export function DevelopmentPlanItemDetailRoute() {
  return <DevelopmentPlanItemSurface focus="overview" />;
}

export function DevelopmentPlanItemBrainstormingRoute() {
  return <DevelopmentPlanItemSurface focus="brainstorming" />;
}

export function DevelopmentPlanItemSpecRoute() {
  return <DevelopmentPlanItemSurface focus="spec" />;
}

export function DevelopmentPlanItemExecutionPlanRoute() {
  return <DevelopmentPlanItemSurface focus="execution-plan" />;
}

export function DevelopmentPlanItemExecutionRoute() {
  return <DevelopmentPlanItemSurface focus="execution" />;
}

function DevelopmentPlanItemSurface({ focus }: { focus: 'overview' | 'brainstorming' | 'spec' | 'execution-plan' | 'execution' }) {
  const { developmentPlanId, itemId } = useParams();
  const query = useDevelopmentPlanItemQuery(developmentPlanId, itemId);
  const itemCandidate = query.data as DevelopmentPlanItemProjection | undefined;
  const item = itemCandidate?.id === undefined ? undefined : itemCandidate;
  const itemWithRoutePlan = normalizeItemPlanRef(item, developmentPlanId);
  const revisionsQuery = useDevelopmentPlanItemRevisionsQuery(developmentPlanId, itemId);
  const boundarySummaryId = firstBoundaryRevision(itemWithRoutePlan)?.boundary_summary_id;
  const boundaryRevisionsQuery = useBoundarySummaryRevisionsQuery(boundarySummaryId);
  const revisions = (revisionsQuery.data ?? []) as DevelopmentPlanItemRevision[];
  const boundaryRevisions = ((boundaryRevisionsQuery.data ?? itemWithRoutePlan?.boundary_summary_revisions ?? []) as BoundarySummaryRevision[]);
  const session = brainstormingSessionFor(itemWithRoutePlan);

  return (
    <div className="grid gap-6">
      <PageHeader
        actions={
          itemWithRoutePlan?.development_plan_ref ? (
            <Link className="inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-primary" to={`/development-plans/${itemWithRoutePlan.development_plan_ref.id}`}>
              Back to Development Plan
            </Link>
          ) : null
        }
        subtitle={`${focusLabel(focus)}. ${itemWithRoutePlan?.summary ?? 'Governed row detail.'}`}
        title={itemWithRoutePlan?.title ?? 'Development Plan Item'}
      />
      <SurfaceStateIndicator
        label="Development Plan Item Detail"
        state={query.isLoading ? 'loading' : query.isError ? 'error' : itemWithRoutePlan === undefined ? 'empty' : itemSurfaceState(itemWithRoutePlan)}
      />
      {query.isError ? <InlineNotice title="Development Plan Item could not be loaded." tone="danger" /> : null}
      {itemWithRoutePlan === undefined && !query.isLoading ? <InlineNotice title="Development Plan Item not found." tone="warning" /> : null}
      {itemWithRoutePlan ? (
        <>
          <ItemStructuredFields item={itemWithRoutePlan} />
          <PlanItemGateSummary item={itemWithRoutePlan} />
          <BrainstormingPanel developmentPlanId={developmentPlanId} itemId={itemId} session={session} />
          <Section title="Spec document">
            <ArtifactList items={itemWithRoutePlan.specs ?? []} empty="No Spec document generated yet." />
          </Section>
          <Section title="Execution Plan document">
            <ArtifactList items={itemWithRoutePlan.execution_plans ?? []} empty="No Execution Plan document generated yet." />
          </Section>
          <Section title="Execution supervision">
            <ArtifactList items={itemWithRoutePlan.executions ?? []} empty="No execution started yet." />
          </Section>
          <Section title="Code review and QA handoff">
            <div className="grid gap-2 text-sm text-text-secondary">
              <p>Review status: <StatusPill tone="info">{itemWithRoutePlan.review_status ?? 'not started'}</StatusPill></p>
              <ArtifactList items={itemWithRoutePlan.qa_handoffs ?? []} empty="No QA handoff created yet." />
            </div>
          </Section>
          <PlanItemRevisionHistory revisions={revisions} />
          <BoundarySummaryRevisionHistory revisions={boundaryRevisions} />
          <Section title="Evidence timeline">
            <p className="text-sm text-text-secondary">Evidence remains linked to the approved Spec, Execution Plan, execution, review, and QA gates.</p>
          </Section>
        </>
      ) : null}
    </div>
  );
}

function ArtifactList({ items, empty }: { items: Array<{ id: string; title?: string; status?: string }>; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-text-secondary">{empty}</p>;
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3 text-sm" key={item.id}>
          <span className="font-semibold text-text-primary">{item.title ?? item.id}</span>
          {item.status ? <StatusPill tone="info">{item.status}</StatusPill> : null}
        </div>
      ))}
    </div>
  );
}

function firstBoundaryRevision(item: DevelopmentPlanItemProjection | undefined): BoundarySummaryRevision | undefined {
  return item?.boundary_summary_revisions?.[0];
}

function brainstormingSessionFor(item: DevelopmentPlanItemProjection | undefined): BrainstormingSession | undefined {
  const revision = firstBoundaryRevision(item);
  if (revision?.brainstorming_session_id === undefined) return undefined;
  return {
    id: revision.brainstorming_session_id,
    ...(item?.boundary_status === undefined ? {} : { approval_state: item.boundary_status }),
    questions: [{ id: 'boundary-question', text: 'Which source and code boundaries are in scope?' }],
    decisions: (revision.summary_markdown ?? revision.summary) === undefined ? [] : [{ id: revision.id, text: revision.summary_markdown ?? revision.summary ?? '' }],
  };
}

function itemSurfaceState(item: DevelopmentPlanItemProjection): 'blocked' | 'approved' | 'running' | 'resumable' | 'stale' | undefined {
  const statusText = `${item.boundary_status ?? ''} ${item.spec_status ?? ''} ${item.execution_plan_status ?? ''} ${item.execution_status ?? ''}`;
  if (statusText.includes('blocked')) return 'blocked';
  if (statusText.includes('stale')) return 'stale';
  if (statusText.includes('interrupted')) return 'resumable';
  if (statusText.includes('running')) return 'running';
  if (item.boundary_status === 'approved') return 'approved';
  return undefined;
}

function normalizeItemPlanRef(
  item: DevelopmentPlanItemProjection | undefined,
  routeDevelopmentPlanId: string | undefined,
): DevelopmentPlanItemProjection | undefined {
  if (item === undefined) return undefined;
  const developmentPlanId = item.development_plan_ref?.id ?? item.object_ref?.development_plan_id ?? item.development_plan_id ?? routeDevelopmentPlanId;
  if (developmentPlanId === undefined) return item;
  return {
    ...item,
    development_plan_id: developmentPlanId,
    object_ref: {
      ...item.object_ref,
      type: 'development_plan_item',
      id: item.id,
      development_plan_id: developmentPlanId,
      title: item.object_ref?.title ?? item.title,
    },
    development_plan_ref: {
      ...item.development_plan_ref,
      id: developmentPlanId,
    },
    href: itemHref({ ...item, development_plan_id: developmentPlanId }),
  };
}

function focusLabel(focus: 'overview' | 'brainstorming' | 'spec' | 'execution-plan' | 'execution'): string {
  switch (focus) {
    case 'brainstorming':
      return 'Boundary brainstorming';
    case 'spec':
      return 'Spec document';
    case 'execution-plan':
      return 'Execution Plan document';
    case 'execution':
      return 'Execution supervision';
    default:
      return 'Gate overview';
  }
}
