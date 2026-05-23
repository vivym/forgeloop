import { Link } from 'react-router';

import { usePipelineQuery } from '../../shared/api/hooks';
import type { PipelineResponse, ProductListItem } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, PillGroup, Section } from '../../shared/layout';
import { Badge, InlineNotice, StatusPill } from '../../shared/ui';

const stageOrder: PipelineResponse['stages'][number]['id'][] = [
  'intake',
  'spec_plan',
  'execution',
  'review',
  'integration_validation',
  'test_acceptance',
  'release',
  'observation',
];

export function PipelineRouteBody() {
  const { projectId } = useProjectContext();
  const query = usePipelineQuery(projectId);
  const stages = orderedStages(query.data);

  return (
    <>
      <PageHeader
        subtitle="Delivery stages, blockers, risk, stale hints, and representative product objects."
        title="Pipeline"
      />
      <Section
        actions={<PipelineState isError={query.isError} isPending={query.status === 'pending'} />}
        description="A route-backed view of the full PRD delivery loop."
        title="Delivery loop"
      >
        {query.status === 'pending' ? <InlineNotice title="Loading pipeline stages." tone="info" /> : null}
        {query.isError ? <InlineNotice title="Pipeline data is temporarily unavailable." tone="danger" /> : null}
        {query.data ? (
          <>
            <DegradedSources degradedSources={query.data.degraded_sources} />
            <div aria-label="Delivery pipeline stages" className="grid gap-4 lg:grid-cols-2">
              {stages.map((stage) => (
                <PipelineStageCard key={stage.id} stage={stage} />
              ))}
            </div>
          </>
        ) : null}
      </Section>
    </>
  );
}

function orderedStages(response: PipelineResponse | undefined) {
  return stageOrder
    .map((stageId) => response?.stages.find((stage) => stage.id === stageId))
    .filter((stage): stage is PipelineResponse['stages'][number] => stage !== undefined);
}

function PipelineState({ isError, isPending }: { isError: boolean; isPending: boolean }) {
  if (isPending) return <Badge tone="info">Loading</Badge>;
  if (isError) return <Badge tone="danger">Unavailable</Badge>;
  return <Badge tone="success">Live</Badge>;
}

function DegradedSources({ degradedSources }: { degradedSources: string[] }) {
  if (degradedSources.length === 0) return null;

  return (
    <PillGroup aria-label="Pipeline degraded sources">
      {degradedSources.map((source) => (
        <Badge key={source} tone="warning">
          {source}
        </Badge>
      ))}
    </PillGroup>
  );
}

function PipelineStageCard({ stage }: { stage: PipelineStage }) {
  return (
    <article className="grid gap-4 rounded-card border border-border bg-surface p-4 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h3 className="m-0 text-lg font-semibold text-text-primary">{stage.label}</h3>
        {stage.degraded ? <Badge tone="warning">Degraded</Badge> : null}
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <PipelineStageMetric label="Items" value={stage.item_count} />
        <PipelineStageMetric label="Blocked" value={stage.blocked_count} tone={stage.blocked_count > 0 ? 'danger' : 'neutral'} />
        <PipelineStageMetric label="High risk" value={stage.high_risk_count} tone={stage.high_risk_count > 0 ? 'warning' : 'neutral'} />
        <PipelineStageMetric label="Stale" value={stage.stale_count} tone={stage.stale_count > 0 ? 'warning' : 'neutral'} />
      </dl>
      {stage.stale_hint ? <p className="m-0 text-sm text-warning">SLA hint: {stage.stale_hint}</p> : null}
      <PipelineStageDetails stage={stage} />
      <RepresentativeItems items={stage.representative_items} />
    </article>
  );
}

type PipelineStage = PipelineResponse['stages'][number];

function PipelineStageMetric({
  label,
  tone = 'neutral',
  value,
}: {
  label: string;
  tone?: 'neutral' | 'warning' | 'danger';
  value: number;
}) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-surface-muted p-3">
      <dt className="text-xs font-semibold uppercase text-text-muted">{label}</dt>
      <dd>
        <StatusPill tone={tone}>{value}</StatusPill>
      </dd>
    </div>
  );
}

function RepresentativeItems({ items }: { items: ProductListItem[] }) {
  if (items.length === 0) {
    return <p className="m-0 text-sm text-text-secondary">No representative objects in this stage.</p>;
  }

  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {items.map((item) => (
        <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm" key={item.id}>
          <Link className="font-semibold text-primary hover:text-primary-hover" to={productObjectHref(item)}>{item.title}</Link>
          <span className="text-text-secondary">{item.phase ?? item.status ?? item.gate_state ?? item.object.type}</span>
        </li>
      ))}
    </ul>
  );
}

function PipelineStageDetails({ stage }: { stage: PipelineResponse['stages'][number] }) {
  if (stage.integration_readiness !== undefined) {
    const details = stage.integration_readiness;
    return (
      <div className="grid gap-3 text-sm">
        <DetailList label="Readiness status" values={[details.readiness_status]} />
        <DetailList label="Dependency blockers" values={details.dependency_blockers} />
        <DetailList label="Contract/mock readiness" values={details.contract_mock_readiness} />
        <DetailList label="Environment requirements" values={details.environment_requirements} />
        <div>
          <h4 className="m-0 text-sm font-semibold text-text-primary">Waiting packages</h4>
          {details.waiting_package_refs.length ? (
            <ul className="mt-2 grid gap-1 pl-5">
              {details.waiting_package_refs.map((item) => (
                <li key={`${item.type}-${item.id}`}>
                  <Link to={productObjectRefHref(item)}>{item.title ?? item.id}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-2 text-text-secondary">No packages are waiting on another surface.</p>
          )}
        </div>
      </div>
    );
  }

  if (stage.test_acceptance !== undefined) {
    const details = stage.test_acceptance;
    return (
      <div className="grid gap-3 text-sm">
        <div>
          <h4 className="m-0 text-sm font-semibold text-text-primary">QA owner queues</h4>
          {details.qa_owner_queues.length ? (
            <ul className="mt-2 grid gap-1 pl-5">
              {details.qa_owner_queues.map((queue) => (
                <li key={queue.owner_actor_id}>{queue.owner_actor_id}: {queue.item_count}</li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-2 text-text-secondary">No QA owner queues are active.</p>
          )}
        </div>
        <DetailList label="Test strategy gaps" values={details.test_strategy_gaps} />
        <DetailList label="Acceptance criteria state" values={[details.acceptance_criteria_state]} />
        <DetailList label="Quality gates" values={details.quality_gates} />
        <DetailList label="Regression coverage gaps" values={details.regression_coverage_gaps} />
        <DetailList label="Release-blocking issues" values={details.release_blocking_issues} />
      </div>
    );
  }

  return null;
}

function DetailList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <h4 className="m-0 text-sm font-semibold text-text-primary">{label}</h4>
      {values.length ? (
        <ul className="mt-2 grid gap-1 pl-5">
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="m-0 mt-2 text-text-secondary">None recorded.</p>
      )}
    </div>
  );
}

function productObjectHref(item: ProductListItem): string {
  return productObjectRefHref(item.object);
}

function productObjectRefHref(object: ProductListItem['object']): string {
  switch (object.type) {
    case 'initiative':
      return `/initiatives/${encodeURIComponent(object.id)}`;
    case 'requirement':
      return `/requirements/${encodeURIComponent(object.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(object.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(object.id)}`;
    case 'task':
      return `/tasks/${encodeURIComponent(object.id)}`;
    case 'spec':
      return `/specs/${encodeURIComponent(object.id)}`;
    case 'plan':
      return `/plans/${encodeURIComponent(object.id)}`;
    case 'execution_package':
      return `/packages/${encodeURIComponent(object.id)}`;
    case 'run_session':
      return `/runs/${encodeURIComponent(object.id)}`;
    case 'review_packet':
      return `/reviews/${encodeURIComponent(object.id)}`;
    case 'release':
      return `/releases/${encodeURIComponent(object.id)}`;
    default:
      return '/lanes';
  }
}
