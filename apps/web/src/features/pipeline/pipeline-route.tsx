import { Link } from 'react-router';

import { usePipelineQuery } from '../../shared/api/hooks';
import type { PipelineResponse, ProductListItem } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { Badge, StatusPill } from '../../shared/ui';

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
        {query.status === 'pending' ? <p className="empty">Loading pipeline stages.</p> : null}
        {query.isError ? <p className="empty">Pipeline data is temporarily unavailable.</p> : null}
        {query.data ? (
          <>
            <DegradedSources degradedSources={query.data.degraded_sources} />
            <div className="fl-pipeline-grid" aria-label="Delivery pipeline stages">
              {stages.map((stage) => (
                <article className="fl-pipeline-stage" key={stage.id}>
                  <div className="fl-pipeline-stage__header">
                    <h3>{stage.label}</h3>
                    {stage.degraded ? <Badge tone="warning">Degraded</Badge> : null}
                  </div>
                  <dl className="fl-pipeline-stage__metrics">
                    <Metric label="Items" value={stage.item_count} />
                    <Metric label="Blocked" value={stage.blocked_count} tone={stage.blocked_count > 0 ? 'danger' : 'neutral'} />
                    <Metric label="High risk" value={stage.high_risk_count} tone={stage.high_risk_count > 0 ? 'warning' : 'neutral'} />
                    <Metric label="Stale" value={stage.stale_count} tone={stage.stale_count > 0 ? 'warning' : 'neutral'} />
                  </dl>
                  {stage.stale_hint ? <p className="fl-pipeline-stage__hint">SLA hint: {stage.stale_hint}</p> : null}
                  <PipelineStageDetails stage={stage} />
                  <RepresentativeItems items={stage.representative_items} />
                </article>
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
    <div className="pill-list" aria-label="Pipeline degraded sources">
      {degradedSources.map((source) => (
        <Badge key={source} tone="warning">
          {source}
        </Badge>
      ))}
    </div>
  );
}

function Metric({
  label,
  tone = 'neutral',
  value,
}: {
  label: string;
  tone?: 'neutral' | 'warning' | 'danger';
  value: number;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <StatusPill tone={tone}>{value}</StatusPill>
      </dd>
    </div>
  );
}

function RepresentativeItems({ items }: { items: ProductListItem[] }) {
  if (items.length === 0) {
    return <p className="empty">No representative objects in this stage.</p>;
  }

  return (
    <ul className="fl-pipeline-stage__items">
      {items.map((item) => (
        <li key={item.id}>
          <Link to={productObjectHref(item)}>{item.title}</Link>
          <span>{item.phase ?? item.status ?? item.gate_state ?? item.object.type}</span>
        </li>
      ))}
    </ul>
  );
}

function PipelineStageDetails({ stage }: { stage: PipelineResponse['stages'][number] }) {
  if (stage.integration_readiness !== undefined) {
    const details = stage.integration_readiness;
    return (
      <div className="fl-pipeline-stage__details">
        <DetailList label="Readiness status" values={[details.readiness_status]} />
        <DetailList label="Dependency blockers" values={details.dependency_blockers} />
        <DetailList label="Contract/mock readiness" values={details.contract_mock_readiness} />
        <DetailList label="Environment requirements" values={details.environment_requirements} />
        <div>
          <h4>Waiting packages</h4>
          {details.waiting_package_refs.length ? (
            <ul>
              {details.waiting_package_refs.map((item) => (
                <li key={`${item.type}-${item.id}`}>
                  <Link to={productObjectRefHref(item)}>{item.title ?? item.id}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No packages are waiting on another surface.</p>
          )}
        </div>
      </div>
    );
  }

  if (stage.test_acceptance !== undefined) {
    const details = stage.test_acceptance;
    return (
      <div className="fl-pipeline-stage__details">
        <div>
          <h4>QA owner queues</h4>
          {details.qa_owner_queues.length ? (
            <ul>
              {details.qa_owner_queues.map((queue) => (
                <li key={queue.owner_actor_id}>{queue.owner_actor_id}: {queue.item_count}</li>
              ))}
            </ul>
          ) : (
            <p>No QA owner queues are active.</p>
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
      <h4>{label}</h4>
      {values.length ? (
        <ul>
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p>None recorded.</p>
      )}
    </div>
  );
}

function productObjectHref(item: ProductListItem): string {
  return productObjectRefHref(item.object);
}

function productObjectRefHref(object: ProductListItem['object']): string {
  switch (object.type) {
    case 'work_item':
      return `/work-items/${encodeURIComponent(object.id)}`;
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
