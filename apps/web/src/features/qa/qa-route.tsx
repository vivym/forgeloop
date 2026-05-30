import { Link } from 'react-router';

import { useQaHandoffsQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { ProductPage, QaHandoffLayout, Section } from '../../shared/layout';
import { EmptyState, InlineNotice, StatusPill } from '../../shared/ui';
import type { QaHandoffProjection } from './qa-handoff-panel';

type QaQueueProjection = QaHandoffProjection & {
  title?: string;
  ref?: { title?: string };
};

export function QaRoute() {
  const { projectId } = useProjectContext();
  const query = useQaHandoffsQuery({ project_id: projectId, limit: 100 });
  const handoffs = (query.data?.items ?? []) as QaQueueProjection[];
  const degradedSources = query.data?.degraded_sources ?? [];

  return (
    <ProductPage family="qa-handoff" ariaLabel="QA">
      <h1 className="mb-3 text-xl font-semibold text-text-primary">QA</h1>
      <QaHandoffLayout
        workspace={
          <Section title="QA queue" variant="panel">
            <div className="grid gap-3">
              {query.isLoading ? <InlineNotice title="Loading QA handoffs." tone="info" /> : null}
              {query.isError ? <InlineNotice title="QA handoff queue is temporarily unavailable." tone="danger" /> : null}
              {degradedSources.length > 0 ? (
                <InlineNotice
                  description={degradedSources.join(', ')}
                  title="QA handoff projection is degraded."
                  tone="warning"
                />
              ) : null}
              {!query.isLoading && !query.isError && handoffs.length === 0 ? (
                <EmptyState description="QA handoff readiness is tracked from Plan Item execution evidence." title="No QA queue rows." />
              ) : (
                <div className="grid gap-2">
                  {handoffs.map((handoff) => (
                    <QaQueueRow handoff={handoff} key={handoff.id} />
                  ))}
                </div>
              )}
            </div>
          </Section>
        }
      />
    </ProductPage>
  );
}

function QaQueueRow({ handoff }: { handoff: QaQueueProjection }) {
  return (
    <article className="grid gap-3 rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h2 className="m-0 text-sm font-semibold text-text-primary">{handoffTitle(handoff)}</h2>
          <p className="m-0 text-sm text-text-secondary">{handoff.development_plan_item_ref?.title ?? 'Plan Item unavailable'}</p>
        </div>
        <StatusPill tone={handoff.status === 'accepted' ? 'success' : handoff.status === 'blocked' ? 'warning' : 'info'}>
          {formatStatus(handoff.status)}
        </StatusPill>
      </div>
      <dl className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
        <Definition label="Execution" value={handoff.execution_id} />
        <Definition label="Test strategy" value={handoff.test_strategy ?? 'Not recorded'} />
        <Definition label="Release impact" value={formatStatus(handoff.release_impact)} />
        <Definition label="Acceptance criteria" value={(handoff.acceptance_criteria ?? []).join(', ') || 'Not recorded'} />
        <Definition label="Changed surfaces" value={(handoff.changed_surfaces ?? []).join(', ') || 'Not recorded'} />
        <Definition label="Known risks" value={(handoff.known_risks ?? []).join(', ') || 'None recorded'} />
      </dl>
      <div>
        <Link
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-semibold text-primary hover:bg-surface-muted"
          to={`/executions/${encodeURIComponent(handoff.execution_id)}`}
        >
          Open execution handoff
        </Link>
      </div>
    </article>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-md border border-border bg-background p-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="break-words font-semibold text-text-primary">{value}</dd>
    </div>
  );
}

function handoffTitle(handoff: QaQueueProjection): string {
  return handoff.title ?? handoff.ref?.title ?? handoff.development_plan_item_ref?.title ?? `QA handoff ${handoff.id}`;
}

function formatStatus(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
