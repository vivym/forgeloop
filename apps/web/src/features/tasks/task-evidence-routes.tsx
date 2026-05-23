import { Link, useParams } from 'react-router';

import {
  usePackageRuntimeReadinessQuery,
  useRunPackageMutation,
  useTaskPackageEvidenceQuery,
  useTaskReviewEvidenceQuery,
  useTaskRunEvidenceQuery,
} from '../../shared/api/hooks';
import type { ArtifactRef, ChangedFile, CheckResult, ExecutionPackage, ReviewPacket, RunSession } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { ActionRail, DetailLayout, InlineActions, Metric, MetricGrid, PageHeader, Section } from '../../shared/layout';
import { Badge, Button, InlineNotice, StatusPill } from '../../shared/ui';

const primaryLinkClass =
  'inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white transition-colors duration-base ease-standard hover:bg-primary-hover';

export function TaskPackageEvidenceRoute() {
  const { packageId, taskId } = useParams();
  const evidenceQuery = useTaskPackageEvidenceQuery(taskId, packageId);
  const evidence = evidenceQuery.data;
  const packageEvidence = evidence?.package;
  const readinessQuery = usePackageRuntimeReadinessQuery(packageEvidence?.id);
  const runMutation = useRunPackageMutation(packageEvidence?.id ?? '');
  const { actorId } = useActorContext();
  const runtimeReady =
    packageEvidence !== undefined &&
    readinessQuery.status === 'success' &&
    !readinessQuery.isError &&
    readinessQuery.data?.state === 'ready';
  const canRun = runtimeReady && !runMutation.isPending;

  if (taskId === undefined || packageId === undefined) {
    return <InvalidEvidenceRoute title="Package Evidence" />;
  }

  if (evidenceQuery.status === 'pending') {
    return <EvidenceLoading title="Package Evidence" />;
  }

  if (evidenceQuery.isError || evidence === undefined || evidence.task_ref.id !== taskId || packageEvidence?.id !== packageId) {
    return <EvidenceUnavailable title="Package Evidence" />;
  }

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Runtime actions">
          <div className="grid gap-3">
            <Button
              disabled={!canRun}
              loading={runMutation.isPending}
              onClick={() => packageEvidence === undefined ? undefined : runMutation.mutate({ actorId })}
              variant="primary"
            >
              Run package
            </Button>
            <Button disabled variant="secondary">
              Force rerun
            </Button>
            {!runtimeReady ? <InlineNotice title={readinessNotice(readinessQuery.status, readinessQuery.isError)} tone="warning" /> : null}
            {runMutation.isError ? <InlineNotice title={runMutation.error.message} tone="danger" /> : null}
            {runMutation.isSuccess ? <InlineNotice title="Package run was queued." tone="success" /> : null}
            <InlineNotice title="Force rerun requires an audited reason and remains disabled from evidence views." tone="info" />
          </div>
        </ActionRail>
      }
      header={
        <PageHeader
          eyebrow={<StatusPill tone={statusTone(packageEvidence.phase)}>{formatValue(packageEvidence.phase)}</StatusPill>}
          subtitle="Package evidence attached to the selected Task."
          title="Package Evidence"
        />
      }
    >
      <TaskScopeLinks taskId={taskId} />
      <PackageSummary executionPackage={packageEvidence} />
    </DetailLayout>
  );
}

export function TaskRunEvidenceRoute() {
  const { runSessionId, taskId } = useParams();
  const evidenceQuery = useTaskRunEvidenceQuery(taskId, runSessionId);
  const evidence = evidenceQuery.data;
  const runSession = evidence?.run_session;

  if (taskId === undefined || runSessionId === undefined) {
    return <InvalidEvidenceRoute title="Run Evidence" />;
  }

  if (evidenceQuery.status === 'pending') {
    return <EvidenceLoading title="Run Evidence" />;
  }

  if (evidenceQuery.isError || evidence === undefined || evidence.task_ref.id !== taskId || runSession?.id !== runSessionId) {
    return <EvidenceUnavailable title="Run Evidence" />;
  }

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Runtime actions">
          <div className="grid gap-3">
            <Button disabled variant="primary">
              Send input
            </Button>
            <Button disabled variant="secondary">
              Resume run
            </Button>
            <InlineNotice title="Runtime commands stay disabled from evidence views until live run control readiness is available." tone="info" />
          </div>
        </ActionRail>
      }
      header={
        <PageHeader
          eyebrow={<StatusPill tone={statusTone(runSession.status)}>{formatValue(runSession.status)}</StatusPill>}
          subtitle="Run evidence attached to the selected Task."
          title="Run Evidence"
        />
      }
    >
      <TaskScopeLinks packageId={evidence.package_ref.id} taskId={taskId} />
      <RunSummary runSession={runSession} />
    </DetailLayout>
  );
}

export function TaskReviewEvidenceRoute() {
  const { reviewPacketId, taskId } = useParams();
  const evidenceQuery = useTaskReviewEvidenceQuery(taskId, reviewPacketId);
  const evidence = evidenceQuery.data;
  const reviewPacket = evidence?.review_packet;

  if (taskId === undefined || reviewPacketId === undefined) {
    return <InvalidEvidenceRoute title="Review Evidence" />;
  }

  if (evidenceQuery.status === 'pending') {
    return <EvidenceLoading title="Review Evidence" />;
  }

  if (evidenceQuery.isError || evidence === undefined || evidence.task_ref.id !== taskId || reviewPacket?.id !== reviewPacketId) {
    return <EvidenceUnavailable title="Review Evidence" />;
  }

  return (
    <DetailLayout
      header={
        <PageHeader
          eyebrow={<StatusPill tone={statusTone(reviewPacket.decision ?? reviewPacket.status)}>{formatValue(reviewPacket.decision ?? reviewPacket.status)}</StatusPill>}
          subtitle="Review evidence attached to the selected Task."
          title="Review Evidence"
        />
      }
    >
      <TaskScopeLinks packageId={evidence.package_ref.id} taskId={taskId} />
      <ReviewSummary reviewPacket={reviewPacket} />
    </DetailLayout>
  );
}

function TaskScopeLinks({ packageId, taskId }: { packageId?: string; taskId: string }) {
  return (
    <Section title="Task scope">
      <InlineActions>
        <Link className={primaryLinkClass} to={`/tasks/${encodeURIComponent(taskId)}`}>
          Task {taskId}
        </Link>
        {packageId ? (
          <Link to={`/tasks/${encodeURIComponent(taskId)}/packages/${encodeURIComponent(packageId)}`}>
            Package evidence
          </Link>
        ) : null}
      </InlineActions>
    </Section>
  );
}

function PackageSummary({ executionPackage }: { executionPackage: ExecutionPackage }) {
  return (
    <>
      <Section title="Evidence summary">
        <MetricGrid>
          <Metric label="Package" value={executionPackage.id} />
          <Metric label="Repository" value={executionPackage.repo_id} />
          <Metric label="Gate" value={formatValue(executionPackage.gate_state)} />
          <Metric label="Version" value={String(executionPackage.version ?? 'Not recorded')} />
        </MetricGrid>
        <p>{executionPackage.objective}</p>
      </Section>
      <StringList items={executionPackage.allowed_paths ?? []} title="Allowed paths" />
      <StringList items={executionPackage.forbidden_paths ?? []} title="Forbidden paths" />
      <Section title="Required checks">
        {executionPackage.required_checks?.length ? (
          <ul>
            {executionPackage.required_checks.map((check) => (
              <li key={check.check_id}>
                <strong>{check.display_name}</strong>: {check.command}
              </li>
            ))}
          </ul>
        ) : (
          <InlineNotice title="No required checks are recorded for this package." />
        )}
      </Section>
    </>
  );
}

function RunSummary({ runSession }: { runSession: RunSession }) {
  return (
    <>
      <Section title="Evidence summary">
        <MetricGrid>
          <Metric label="Run" value={runSession.id} />
          <Metric label="Package" value={runSession.execution_package_id} />
          <Metric label="Executor" value={formatValue(runSession.executor_type)} />
          <Metric label="Status" value={formatValue(runSession.status)} />
        </MetricGrid>
        <p>{runSession.summary ?? 'No run summary recorded.'}</p>
      </Section>
      <ChangedFiles files={runSession.changed_files ?? []} />
      <CheckResults checks={runSession.check_results ?? []} />
      <Artifacts artifacts={runSession.artifacts ?? []} />
    </>
  );
}

function ReviewSummary({ reviewPacket }: { reviewPacket: ReviewPacket }) {
  return (
    <>
      <Section title="Evidence summary">
        <MetricGrid>
          <Metric label="Review" value={reviewPacket.id} />
          <Metric label="Run" value={reviewPacket.run_session_id} />
          <Metric label="Package" value={reviewPacket.execution_package_id} />
          <Metric label="Decision" value={formatValue(reviewPacket.decision ?? reviewPacket.status)} />
        </MetricGrid>
        <p>{reviewPacket.summary}</p>
      </Section>
      <ChangedFiles files={reviewPacket.changed_files ?? []} />
      <StringList items={reviewPacket.risk_notes ?? []} title="Risk notes" />
      <Section title="Check result summary">
        <p>{reviewPacket.check_result_summary ?? 'No check result summary recorded.'}</p>
      </Section>
    </>
  );
}

function ChangedFiles({ files }: { files: ChangedFile[] }) {
  return (
    <Section title="Changed files">
      {files.length ? (
        <ul>
          {files.map((file) => (
            <li key={`${file.repo_id}:${file.path}`}>
              <Badge tone="info">{file.change_kind}</Badge> {file.repo_id}/{file.path}
            </li>
          ))}
        </ul>
      ) : (
        <InlineNotice title="No changed files are recorded." />
      )}
    </Section>
  );
}

function CheckResults({ checks }: { checks: CheckResult[] }) {
  return (
    <Section title="Check results">
      {checks.length ? (
        <ul>
          {checks.map((check) => (
            <li key={check.check_id}>
              <StatusPill tone={statusTone(check.status)}>{formatValue(check.status)}</StatusPill> {check.command}
            </li>
          ))}
        </ul>
      ) : (
        <InlineNotice title="No check results are recorded." />
      )}
    </Section>
  );
}

function Artifacts({ artifacts }: { artifacts: ArtifactRef[] }) {
  return (
    <Section title="Artifacts">
      {artifacts.length ? (
        <ul>
          {artifacts.map((artifact) => (
            <li key={`${artifact.kind}:${artifact.name}`}>
              {formatValue(artifact.kind)}: {artifact.name}
            </li>
          ))}
        </ul>
      ) : (
        <InlineNotice title="No artifacts are recorded." />
      )}
    </Section>
  );
}

function StringList({ items, title }: { items: string[]; title: string }) {
  return (
    <Section title={title}>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <InlineNotice title={`No ${title.toLowerCase()} are recorded.`} />
      )}
    </Section>
  );
}

function EvidenceLoading({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle={`Loading ${title.toLowerCase()}.`} title="Loading Evidence" />}>
      <Section title="Loading">
        <InlineNotice title="Loading task-scoped evidence." tone="info" />
      </Section>
    </DetailLayout>
  );
}

function EvidenceUnavailable({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="This evidence is not available for the requested Task." title={title} />}>
      <Section title="Evidence unavailable">
        <InlineNotice title="Evidence was not found or access denied." tone="warning" />
      </Section>
    </DetailLayout>
  );
}

function InvalidEvidenceRoute({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="Route context is required for this evidence page." title={title} />}>
      <Section title="Invalid route">
        <InlineNotice title="Task evidence route context is missing." tone="warning" />
      </Section>
    </DetailLayout>
  );
}

function readinessNotice(status: 'pending' | 'error' | 'success', isError: boolean) {
  if (status === 'pending') return 'Runtime readiness is loading; actions are disabled.';
  if (isError) return 'Runtime readiness is unavailable; actions are disabled.';
  return 'Runtime readiness is not ready; actions are disabled.';
}

function statusTone(status: string | undefined) {
  if (status === 'approved' || status === 'ready' || status === 'succeeded' || status === 'completed') return 'success';
  if (status === 'blocked' || status === 'failed' || status === 'rejected' || status === 'changes_requested') return 'danger';
  if (status === 'running' || status === 'pending') return 'warning';
  return 'info';
}

function formatValue(value: string | undefined, fallback = 'Not set') {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  return value
    .split(/[_/ -]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}
