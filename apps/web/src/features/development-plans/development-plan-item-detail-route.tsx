import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import {
  useBoundarySummaryRevisionsQuery,
  useDevelopmentPlanItemQuery,
  useDevelopmentPlanItemRevisionsQuery,
} from '../../shared/api/hooks';
import { CompactMetadata, GateProgress, GateWorkspace, Section, SplitPane } from '../../shared/layout';
import { InlineNotice, StatusPill } from '../../shared/ui';
import { BrainstormingPanel } from '../brainstorming/brainstorming-panel';
import { SurfaceStateIndicator } from '../project-management/surface-state';
import {
  BoundarySummaryRevisionHistory,
  PlanItemGateSummary,
  PlanItemRevisionHistory,
  planItemGateModels,
  type BoundarySummaryRevision,
  type DevelopmentPlanItemProjection,
  type DevelopmentPlanItemRevision,
  type PlanItemGateModel,
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
  const gates = itemWithRoutePlan === undefined ? [] : planItemGateModels(itemWithRoutePlan);
  const currentGateId = itemWithRoutePlan === undefined ? undefined : currentGateIdFor(itemWithRoutePlan, focus);

  return (
    <GateWorkspace
      as="div"
      blockerRisk={itemWithRoutePlan === undefined ? 'Disabled reasons and evidence side context load with the item.' : blockerRiskSummary(itemWithRoutePlan, gates)}
      family="gate-workspace"
      heading={itemWithRoutePlan?.title ?? 'Development Plan Item'}
      nextAction={itemWithRoutePlan === undefined ? 'Current enabled action loads with the item.' : currentEnabledAction(itemWithRoutePlan, gates, currentGateId)}
      roleResponsibility={itemWithRoutePlan === undefined ? 'Priority summary loads with the item.' : prioritySummary(itemWithRoutePlan)}
      state={itemWithRoutePlan === undefined ? 'Gate progress is loading.' : gateProgressSummary(itemWithRoutePlan, gates, currentGateId)}
      subtitle={
        itemWithRoutePlan === undefined
          ? focusLabel(focus)
          : (
            <FirstViewportContext
              currentGateId={currentGateId}
              focus={focus}
              gates={gates}
              item={itemWithRoutePlan}
            />
          )
      }
      toolbar={
        <div className="flex flex-wrap items-start gap-2">
          {itemWithRoutePlan?.development_plan_ref ? (
            <Link className="inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-primary" to={`/development-plans/${itemWithRoutePlan.development_plan_ref.id}`}>
              Back to Development Plan
            </Link>
          ) : null}
          {itemWithRoutePlan ? <EvidenceSideContext compact item={itemWithRoutePlan} /> : null}
        </div>
      }
    >
      <SurfaceStateIndicator
        label="Development Plan Item Detail"
        state={query.isLoading ? 'loading' : query.isError ? 'error' : itemWithRoutePlan === undefined ? 'empty' : itemSurfaceState(itemWithRoutePlan)}
      />
      {query.isError ? <InlineNotice title="Development Plan Item could not be loaded." tone="danger" /> : null}
      {itemWithRoutePlan === undefined && !query.isLoading ? <InlineNotice title="Development Plan Item not found." tone="warning" /> : null}
      {itemWithRoutePlan ? (
        <>
          <SplitPane aside={<EvidenceSideContext item={itemWithRoutePlan} />}>
            <div className="grid gap-4">
              <ActiveGateBody
                developmentPlanId={developmentPlanId}
                focus={focus}
                item={itemWithRoutePlan}
                itemId={itemId}
                session={session}
              />
              <SupportingGateBodies
                developmentPlanId={developmentPlanId}
                focus={focus}
                item={itemWithRoutePlan}
                itemId={itemId}
                session={session}
              />
            </div>
          </SplitPane>
          <PlanItemRevisionHistory revisions={revisions} />
          <BoundarySummaryRevisionHistory revisions={boundaryRevisions} />
          <Section title="Evidence timeline">
            <p className="text-sm text-text-secondary">Evidence remains linked to the approved Spec, Execution Plan, execution, review, and QA gates.</p>
          </Section>
        </>
      ) : null}
    </GateWorkspace>
  );
}

function FirstViewportContext({
  currentGateId,
  focus,
  gates,
  item,
}: {
  currentGateId: PlanItemGateModel['id'] | undefined;
  focus: DevelopmentPlanItemFocus;
  gates: PlanItemGateModel[];
  item: DevelopmentPlanItemProjection;
}) {
  return (
    <div className="grid gap-3">
      <p>{focusLabel(focus)}. {item.summary ?? 'Governed row detail.'}</p>
      <CompactMetadata
        items={[
          { label: 'Source', value: sourceLabel(item) },
          { label: 'Development Plan', value: planLabel(item) },
          { label: 'Current gate', value: gateLabelFor(gates, currentGateId) },
          { label: 'Priority summary', value: `${item.priority ?? 'unscored'} priority / ${item.risk ?? 'unscored'} risk` },
          { label: 'Driver', value: item.driver_actor_id ?? 'Unassigned' },
          { label: 'Responsible role', value: item.responsible_role ?? 'Unassigned' },
        ]}
      />
      <div className="grid gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Gate progress</h2>
        <GateProgress
          {...(currentGateId === undefined ? {} : { currentGateId })}
          gates={gates.map((gate) => ({
            id: gate.id,
            label: gate.label,
            status: statusLabel(gate.status),
          }))}
        />
      </div>
    </div>
  );
}

function ActiveGateBody({
  developmentPlanId,
  focus,
  item,
  itemId,
  session,
}: {
  developmentPlanId: string | undefined;
  focus: DevelopmentPlanItemFocus;
  item: DevelopmentPlanItemProjection;
  itemId: string | undefined;
  session: BrainstormingSession | undefined;
}) {
  return (
    <div data-active-gate-body="">
      {renderGateBody(focus === 'overview' ? 'overview' : focus, { developmentPlanId, item, itemId, session })}
    </div>
  );
}

function SupportingGateBodies({
  developmentPlanId,
  focus,
  item,
  itemId,
  session,
}: {
  developmentPlanId: string | undefined;
  focus: DevelopmentPlanItemFocus;
  item: DevelopmentPlanItemProjection;
  itemId: string | undefined;
  session: BrainstormingSession | undefined;
}) {
  if (focus !== 'overview') {
    return <PlanItemGateSummary item={item} />;
  }

  return (
    <>
      {renderGateBody('brainstorming', { developmentPlanId, item, itemId, session })}
      {renderGateBody('spec', { developmentPlanId, item, itemId, session })}
      {renderGateBody('execution-plan', { developmentPlanId, item, itemId, session })}
      {renderGateBody('execution', { developmentPlanId, item, itemId, session })}
      {renderGateBody('review', { developmentPlanId, item, itemId, session })}
    </>
  );
}

function renderGateBody(
  body: DevelopmentPlanItemFocus | 'review',
  context: {
    developmentPlanId: string | undefined;
    item: DevelopmentPlanItemProjection;
    itemId: string | undefined;
    session: BrainstormingSession | undefined;
  },
): ReactNode {
  switch (body) {
    case 'overview':
      return <PlanItemGateSummary item={context.item} />;
    case 'brainstorming':
      return <BrainstormingPanel developmentPlanId={context.developmentPlanId} itemId={context.itemId} session={context.session} />;
    case 'spec':
      return (
        <Section title="Spec document">
          <ArtifactList items={context.item.specs ?? []} empty="No Spec document generated yet." />
        </Section>
      );
    case 'execution-plan':
      return (
        <Section title="Execution Plan document">
          <ArtifactList items={context.item.execution_plans ?? []} empty="No Execution Plan document generated yet." />
        </Section>
      );
    case 'execution':
      return (
        <Section title="Execution supervision">
          <ArtifactList items={context.item.executions ?? []} empty="No execution started yet." />
        </Section>
      );
    case 'review':
      return (
        <Section title="Code review and QA handoff">
          <div className="grid gap-2 text-sm text-text-secondary">
            <p>Review status: <StatusPill tone="info">{statusLabel(context.item.review_status)}</StatusPill></p>
            <ArtifactList items={context.item.qa_handoffs ?? []} empty="No QA handoff created yet." />
          </div>
        </Section>
      );
  }
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

function EvidenceSideContext({ compact = false, item }: { compact?: boolean; item: DevelopmentPlanItemProjection }) {
  const evidence = executionEvidenceRefs(item);
  const firstTitle = evidence[0]?.title ?? evidence[0]?.id;
  const summary = evidence.length === 0
    ? 'No execution evidence linked yet.'
    : `${evidence.length} execution evidence ${evidence.length === 1 ? 'ref' : 'refs'}${firstTitle === undefined ? '' : `, latest ${firstTitle}`}.`;

  return (
    <section
      aria-label="Evidence side context"
      className={compact
        ? 'grid max-w-xs gap-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm'
        : 'grid gap-3 rounded-card border border-border bg-surface p-4 text-sm'}
    >
      <h2 className="text-sm font-semibold text-text-primary">Evidence side context</h2>
      <p className="text-text-secondary">{summary}</p>
      {!compact ? (
        <dl className="grid gap-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-normal text-text-muted">Source</dt>
            <dd className="text-text-primary">{sourceLabel(item)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-normal text-text-muted">Plan context</dt>
            <dd className="text-text-primary">{planLabel(item)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-normal text-text-muted">Release impact</dt>
            <dd className="text-text-primary">{item.release_impact ?? 'not recorded'}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

type DevelopmentPlanItemFocus = 'overview' | 'brainstorming' | 'spec' | 'execution-plan' | 'execution';

function currentGateIdFor(item: DevelopmentPlanItemProjection, focus: DevelopmentPlanItemFocus): PlanItemGateModel['id'] {
  if (focus !== 'overview') return focus === 'brainstorming' ? 'boundary' : focus;
  if (!isCompleteStatus(item.boundary_status)) return 'boundary';
  if (!isCompleteStatus(item.spec_status)) return 'spec';
  if (!isCompleteStatus(item.execution_plan_status)) return 'execution-plan';
  if (!isCompleteStatus(item.execution_status)) return 'execution';
  if (!isCompleteStatus(item.review_status)) return 'code-review';
  return 'qa-handoff';
}

function gateProgressSummary(
  item: DevelopmentPlanItemProjection,
  gates: PlanItemGateModel[],
  currentGateId: PlanItemGateModel['id'] | undefined,
): string {
  const completeCount = gates.filter((gate) => isCompleteStatus(gate.status)).length;
  return `Gate progress: ${completeCount} of ${gates.length} gates complete. Current gate ${gateLabelFor(gates, currentGateId)}. ${item.next_action ?? 'Review gate state.'}`;
}

function prioritySummary(item: DevelopmentPlanItemProjection): string {
  return `Priority summary: ${item.priority ?? 'unscored'} priority, ${item.risk ?? 'unscored'} risk. ${item.responsible_role ?? 'Unassigned role'} owns the next gate; driver ${item.driver_actor_id ?? 'unassigned'}.`;
}

function currentEnabledAction(
  item: DevelopmentPlanItemProjection,
  gates: PlanItemGateModel[],
  currentGateId: PlanItemGateModel['id'] | undefined,
): string {
  const gate = gates.find((candidate) => candidate.id === currentGateId && candidate.enabled) ?? gates.find((candidate) => candidate.enabled);
  return `Current enabled action: ${gate === undefined ? 'No gate action is currently enabled' : `Open ${gate.label}`}. ${item.next_action ?? 'Review gate state.'}`;
}

function blockerRiskSummary(item: DevelopmentPlanItemProjection, gates: PlanItemGateModel[]): string {
  const disabledReasons = gates
    .filter((gate) => !gate.enabled)
    .map((gate) => `${gate.label}: ${gate.reason}`);
  const disabledText = disabledReasons.length === 0
    ? 'Disabled reasons: no gate routes are disabled; lifecycle commands still require their item prerequisites.'
    : `Disabled reasons: ${disabledReasons.join(' ')}`;
  return `${disabledText} Risk ${item.risk ?? 'unscored'}. Evidence side context: ${executionEvidenceRefs(item).length} execution evidence refs linked.`;
}

function gateLabelFor(gates: PlanItemGateModel[], gateId: PlanItemGateModel['id'] | undefined): string {
  return gates.find((gate) => gate.id === gateId)?.label ?? 'not selected';
}

function sourceLabel(item: DevelopmentPlanItemProjection): string {
  return item.source_ref?.title ?? item.source_ref?.id ?? 'Not linked';
}

function planLabel(item: DevelopmentPlanItemProjection): string {
  return item.development_plan_ref?.title ?? item.object_ref?.development_plan_id ?? item.development_plan_id ?? 'Not linked';
}

function statusLabel(status: string | undefined): string {
  return (status ?? 'not started').replaceAll('_', ' ');
}

function isCompleteStatus(status: string | undefined): boolean {
  return status === 'approved' || status === 'completed' || status === 'accepted';
}

function executionEvidenceRefs(item: DevelopmentPlanItemProjection) {
  const execution = item.executions?.[0];
  return [...(execution?.evidence_refs ?? []), ...(execution?.test_evidence_refs ?? [])];
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
