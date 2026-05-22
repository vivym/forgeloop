import { Link, useParams, useSearchParams } from 'react-router';

import type { DeliveryStage, SpecPlan, WorkItemDeliveryReadiness } from '../../shared/api/types';
import { useWorkItemCockpitQuery, useWorkItemReplayQuery } from '../../shared/api/hooks';
import { ActionRail, DetailLayout, PageHeader, PillGroup, Section } from '../../shared/layout';
import { Badge, InlineNotice, Skeleton, StatusPill, Timeline, type TimelineItem } from '../../shared/ui';
import {
  DeliveryActionRail,
  DeliveryActionSummary,
  DeliveryStageRail,
  EvidenceTimeline,
  ExecutionSummary,
  InitiativeBreakdown,
  IntegrationReadinessPanel,
  PackageMatrix,
  QualityGatePanel,
  ReleaseReadinessPanel,
  ReviewSummary,
  TypedBrief,
} from './delivery-cockpit';
import { createWorkItemDetailViewModel, deliveryStageTargetId, deliveryStageTone, formatValue } from './work-item-view-model';
import { parseProductLaneId, productLaneDefinition } from '../product-lanes/product-lanes';

export function WorkItemDetail() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const workItemId = params.workItemId;
  const requestedLane = searchParams.get('lane');
  const cockpitLane = parseProductLaneId(requestedLane ?? undefined);
  const unsupportedLane = requestedLane !== null && cockpitLane === undefined;
  const cockpit = useWorkItemCockpitQuery(workItemId, cockpitLane);
  const replay = useWorkItemReplayQuery(workItemId);
  const viewModel = createWorkItemDetailViewModel(cockpit.data, replay.data);
  const { deliveryReadiness, workItem } = viewModel;

  if (workItemId === undefined) {
    return (
      <DetailLayout header={<PageHeader subtitle="No work item route parameter was provided." title="Work Item" />}>
        <Section title="Invalid route">
          <InlineNotice title="This Work Item route is missing a work item." />
        </Section>
      </DetailLayout>
    );
  }

  if (cockpit.status === 'pending') {
    return <DeliveryCockpitSkeleton />;
  }

  if (cockpit.isError) {
    return (
      <DetailLayout header={<PageHeader subtitle="The work item could not be loaded." title="Work Item" />}>
        <Section title="Unavailable">
          <InlineNotice title="Work item data is temporarily unavailable." tone="danger" />
        </Section>
      </DetailLayout>
    );
  }

  if (workItem === null || deliveryReadiness === null) {
    return (
      <DetailLayout header={<PageHeader subtitle="No work item was found for this route." title="Work Item" />}>
        <Section title="Empty">
          <InlineNotice title="No work item data is available." />
        </Section>
      </DetailLayout>
    );
  }

  const stage = stageFinder(deliveryReadiness);
  const lane = productLaneDefinition(deliveryReadiness.active_lane);

  return (
    <DetailLayout
      actionRail={
        unsupportedLane ? (
          <UnsupportedLaneActionRail activeLane={deliveryReadiness.active_lane} workItemId={workItem.id} />
        ) : (
          <DeliveryActionRail
            actions={deliveryReadiness.next_actions}
            activeLane={deliveryReadiness.active_lane}
            projectId={workItem.project_id}
          />
        )
      }
      header={
        <PageHeader
          eyebrow={`${formatValue(workItem.kind)} / ${lane.label}`}
          subtitle={workItem.title}
          title="Delivery Cockpit"
        />
      }
    >
      <DeliveryActionSummary readiness={deliveryReadiness} />
      <DeliveryStageRail stages={deliveryReadiness.stages} />
      <DeliveryDegradedNotice readiness={deliveryReadiness} />
      <TypedBrief workItem={workItem} />
      <ArtifactStageSection artifact={viewModel.spec} description="Approved product intent and acceptance criteria." fallbackId="spec" stage={stage('spec')} />
      <ArtifactStageSection
        artifact={viewModel.plan}
        description="Approved implementation plan and package split."
        fallbackId="plan"
        stage={stage('plan')}
      />
      <PackageMatrix packages={viewModel.packageRows} />
      {workItem.kind === 'initiative' && viewModel.packages.length === 0 ? (
        <InitiativeBreakdown aggregation={{ mode: 'unavailable', label: initiativeUnavailableLabel(deliveryReadiness) }} />
      ) : null}
      <ExecutionSummary runCount={viewModel.runs.length} {...stageProp(stage('execution'))} />
      <ReviewSummary reviewCount={viewModel.reviews.length} {...stageProp(stage('review'))} />
      <IntegrationReadinessPanel {...stageProp(stage('integration_readiness'))} />
      <QualityGatePanel {...stageProp(stage('quality_gate'))} />
      <ReleaseReadinessPanel {...stageProp(stage('release_readiness'))} />
      <EvidenceTimeline evidence={deliveryReadiness.evidence} />
      <ActivityTimeline isError={replay.isError} timeline={viewModel.timeline} />
    </DetailLayout>
  );
}

function DeliveryCockpitSkeleton() {
  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Delivery actions">
          <Skeleton lines={4} />
        </ActionRail>
      }
      header={<PageHeader subtitle="Loading work item context." title="Work Item" />}
    >
      <Section title="Delivery action summary">
        <Skeleton lines={4} />
      </Section>
      <Section title="Delivery readiness stages">
        <Skeleton lines={8} />
      </Section>
      <Section title="Package matrix">
        <Skeleton lines={4} />
      </Section>
    </DetailLayout>
  );
}

function UnsupportedLaneActionRail({ activeLane, workItemId }: { activeLane: WorkItemDeliveryReadiness['active_lane']; workItemId: string }) {
  return (
    <ActionRail title="Delivery actions">
      <InlineNotice title="This lane is not available for this Work Item." tone="warning" />
      <Link className={linkButtonClass('primary')} to={`/work-items/${encodeURIComponent(workItemId)}?lane=${activeLane}`}>
        Open default lane
      </Link>
    </ActionRail>
  );
}

function DeliveryDegradedNotice({ readiness }: { readiness: WorkItemDeliveryReadiness }) {
  if (readiness.degraded_sources.length === 0) return null;

  return (
    <Section
      description="Some delivery evidence sources could not be loaded, so readiness is intentionally conservative."
      title="Delivery readiness degraded"
    >
      <PillGroup aria-label="Degraded delivery sources">
        {readiness.degraded_sources.map((source) => (
          <Badge key={source} tone="warning">
            {source}
          </Badge>
        ))}
      </PillGroup>
      {readiness.blockers.length === 0 ? null : (
        <ul>
          {readiness.blockers.map((blocker) => (
            <li key={blocker.id}>{blocker.label}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ArtifactStageSection({
  artifact,
  description,
  fallbackId,
  stage,
}: {
  artifact: SpecPlan | null;
  description: string;
  fallbackId: 'spec' | 'plan';
  stage: DeliveryStage | undefined;
}) {
  const targetId = deliveryStageTargetId({ id: stage?.id ?? fallbackId });

  return (
    <Section id={targetId} tabIndex={-1} title={stage?.label ?? formatValue(fallbackId)} description={description}>
      <PillGroup aria-label={`${stage?.label ?? formatValue(fallbackId)} state`}>
        <StatusPill tone={stage === undefined ? 'neutral' : deliveryStageTone(stage.state)}>{formatValue(stage?.state, 'Unavailable')}</StatusPill>
        <Badge tone={artifact === null ? 'warning' : 'info'}>{artifact === null ? 'Missing artifact' : formatValue(artifact.status)}</Badge>
        {artifact?.gate_state === undefined ? null : <Badge>{formatValue(artifact.gate_state)}</Badge>}
      </PillGroup>
      <ArtifactStageBlockers stage={stage} fallbackLabel={`No ${formatValue(fallbackId).toLowerCase()} blockers reported.`} />
    </Section>
  );
}

function ArtifactStageBlockers({ fallbackLabel, stage }: { fallbackLabel: string; stage: DeliveryStage | undefined }) {
  if (stage === undefined || stage.blockers.length === 0) return <InlineNotice title={fallbackLabel} />;

  return (
    <ul>
      {stage.blockers.map((blocker) => (
        <li key={blocker.id}>{blocker.label}</li>
      ))}
    </ul>
  );
}

function ActivityTimeline({ isError, timeline }: { isError: boolean; timeline: readonly { id: string; summary: string; created_at: string }[] }) {
  const items: TimelineItem[] = timeline.map((entry) => ({
    id: entry.id,
    title: entry.summary,
    meta: entry.created_at,
  }));

  return (
    <Section title="Activity timeline">
      {isError ? (
        <InlineNotice title="Timeline is temporarily unavailable." tone="danger" />
      ) : timeline.length ? (
        <Timeline items={items} />
      ) : (
        <InlineNotice title="No timeline events have been published for this product view." />
      )}
    </Section>
  );
}

function linkButtonClass(variant: 'primary' | 'secondary') {
  const variantClass =
    variant === 'primary'
      ? 'border-primary bg-primary text-white hover:bg-primary-hover'
      : 'border-border bg-surface text-text-primary hover:border-border-strong hover:bg-surface-muted';

  return [
    'inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors duration-base ease-standard motion-reduce:transition-none',
    variantClass,
  ].join(' ');
}

function stageFinder(readiness: WorkItemDeliveryReadiness) {
  return (stageId: DeliveryStage['id']) => readiness.stages.find((stage) => stage.id === stageId);
}

function stageProp(stage: DeliveryStage | undefined): { stage: DeliveryStage } | Record<string, never> {
  return stage === undefined ? {} : { stage };
}

function initiativeUnavailableLabel(readiness: WorkItemDeliveryReadiness) {
  return (
    readiness.stages
      .find((stage) => stage.id === 'packages')
      ?.blockers.find((blocker) => blocker.label.trim().length > 0)?.label ?? 'Child-work aggregation unavailable'
  );
}
