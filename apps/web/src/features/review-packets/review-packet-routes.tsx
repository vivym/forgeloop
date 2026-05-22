import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import {
  useApproveReviewPacketMutation,
  useRequestReviewChangesMutation,
  useReviewPacketReplayQuery,
  useReviewPacketsQuery,
  useReviewQuery,
} from '../../shared/api/hooks';
import type { ChangedFile, ProductListItem, ReviewPacket, RequestedChange, TimelineEntry } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { ActionRail, DetailLayout, InlineActions, MetadataGrid, PageHeader, PillGroup, Section } from '../../shared/layout';
import { Badge, DataTable, InlineNotice, StatusPill, Timeline, type TimelineItem } from '../../shared/ui';
import { ReviewDecisionForm } from './review-decision-form';

const supportedReviewFilters = ['status', 'reviewer_actor_id', 'decision', 'execution_package_id', 'run_session_id', 'cursor', 'limit'];

type ReviewFilters = {
  status?: string;
  reviewer_actor_id?: string;
  decision?: string;
  execution_package_id?: string;
  run_session_id?: string;
  cursor?: string;
  limit?: number;
};

export function ReviewsRegistry() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const filters = reviewFiltersFromSearch(searchParams);
  const query = useReviewPacketsQuery({ project_id: projectId, ...filters, limit: filters.limit ?? 100 });
  const unsupportedFilters = unsupportedReviewFilters(searchParams);
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader subtitle="Review packets, evidence handoff, and reviewer decisions." title="Reviews" />
      <Section
        description="Server-side filters are sent for reviewer, decision, package, run, status, cursor, and limit."
        title="Review packet inventory"
      >
        <RegistryState isError={query.isError} isPending={query.status === 'pending'} kind="review packets" />
        <FilterSummary filters={filters} unsupportedFilters={unsupportedFilters} />
        {query.status !== 'pending' && !query.isError ? (
          <>
            <DegradedNotice degradedSources={query.data?.degraded_sources ?? []} />
            <ReviewPacketTable items={items} />
          </>
        ) : null}
      </Section>
    </>
  );
}

export function ReviewPacketDetail() {
  const { reviewPacketId } = useParams();

  if (!reviewPacketId) {
    return <InvalidDetail title="Review" message="This review route is missing a review packet id." />;
  }

  return <ReviewPacketDetailView reviewPacketId={reviewPacketId} />;
}

function ReviewPacketDetailView({ reviewPacketId }: { reviewPacketId: string }) {
  const { actorId } = useActorContext();
  const reviewQuery = useReviewQuery(reviewPacketId);
  const replayQuery = useReviewPacketReplayQuery(reviewPacketId);
  const approveReview = useApproveReviewPacketMutation(reviewPacketId);
  const requestChanges = useRequestReviewChangesMutation(reviewPacketId);
  const [decisionMode, setDecisionMode] = useState<'approve' | 'request_changes'>('approve');

  if (reviewQuery.status === 'pending') {
    return <InvalidDetail title="Review" message="Loading review packet." />;
  }

  if (reviewQuery.isError || reviewQuery.data === undefined) {
    return <InvalidDetail title="Review" message="Review packet data is temporarily unavailable." />;
  }

  const review = reviewQuery.data;
  const actionPending = approveReview.isPending || requestChanges.isPending;
  const disabledReason = reviewDecisionDisabledReason(review);
  const decisionsDisabled = disabledReason !== undefined;

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Review actions">
          <ReviewDecisionForm
            disabled={decisionsDisabled}
            disabledReason={disabledReason}
            error={(decisionMode === 'approve' ? approveReview.error : requestChanges.error) ?? null}
            isSubmitting={actionPending}
            mode={decisionMode}
            onApprove={({ summary }) =>
              approveReview.mutate({
                summary,
                reviewed_by_actor_id: actorId,
                reviewed_at: new Date().toISOString(),
              })
            }
            onModeChange={setDecisionMode}
            onRequestChanges={({ summary, requested_changes }) =>
              requestChanges.mutate({
                summary,
                reviewed_by_actor_id: actorId,
                reviewed_at: new Date().toISOString(),
                requested_changes,
              })
            }
          />
        </ActionRail>
      }
      header={
        <PageHeader
          eyebrow={
            <InlineActions>
              <span>Review</span>
              <StatusPill tone={reviewDecisionTone(review.decision)}>{review.decision}</StatusPill>
              <StatusPill tone={reviewDecisionTone(review.status)}>{review.status}</StatusPill>
            </InlineActions>
          }
          subtitle={review.check_result_summary ?? review.self_review?.summary ?? 'Review packet is ready for product decision.'}
          title={review.summary ?? 'Review packet'}
        />
      }
    >
      <Section title="Summary" description="Decision state, related package, and latest run context.">
        <MetadataGrid
          items={[
            { label: 'Review summary', value: review.summary ?? 'Review summary unavailable' },
            { label: 'Decision', value: review.decision },
            { label: 'Status', value: `Status: ${review.status}` },
            { label: 'Assigned reviewer', value: review.reviewer_actor_id ? 'Assigned' : 'Unassigned' },
            { label: 'Recorded decision', value: review.reviewed_by_actor_id ? 'Recorded' : 'Not recorded' },
            { label: 'Reviewed at', value: formatDate(review.reviewed_at) },
            { label: 'Run result', value: review.self_review?.status ?? review.check_result_summary ?? 'Run summary unavailable' },
          ]}
        />
        <InlineActions>
          <Link to={`/packages/${encodeURIComponent(review.execution_package_id)}`}>Open package</Link>
          <Link to={`/runs/${encodeURIComponent(review.run_session_id)}`}>Open run</Link>
        </InlineActions>
      </Section>
      <Section title="Changed files" description="Files included in the review packet.">
        <PillList empty="No changed files recorded." values={(review.changed_files ?? []).map(changedFileLabel)} />
      </Section>
      <Section title="Check summary" description="Required check outcome for reviewer handoff.">
        <p>{review.check_result_summary ?? 'Check summary unavailable from review packet API.'}</p>
      </Section>
      <Section title="Self-review" description="Implementer self-review and remaining risk notes.">
        <p>{review.self_review?.summary ?? 'Self-review summary unavailable.'}</p>
        <MetadataGrid
          items={[
            { label: 'Status', value: review.self_review?.status ?? 'unknown' },
            { label: 'Spec / Plan alignment', value: review.self_review?.spec_plan_alignment ?? 'unknown' },
            { label: 'Test assessment', value: review.self_review?.test_assessment ?? 'unknown' },
          ]}
        />
        <PillList empty="No self-review risk notes." values={review.self_review?.risk_notes ?? []} />
      </Section>
      <Section title="Risk notes" description="Reviewer-visible product risk notes.">
        <PillList empty="No risk notes recorded." values={review.risk_notes ?? []} />
      </Section>
      <Section title="Requested changes" description="Changes requested by reviewers.">
        <RequestedChangesList changes={review.requested_changes ?? []} />
      </Section>
      <Section title="Timeline / Replay" description="Review packet timeline from the replay read model.">
        <ReplayState isError={replayQuery.isError} isPending={replayQuery.status === 'pending'} timeline={replayQuery.data ?? []} />
      </Section>
    </DetailLayout>
  );
}

function ReviewPacketTable({ items }: { items: ProductListItem[] }) {
  return (
    <DataTable
      columns={[
        {
          key: 'title',
          header: 'Review',
          cell: (item) => (
            <div className="grid gap-3">
              <strong>{item.title}</strong>
              <Link to={`/reviews/${encodeURIComponent(item.object.id)}`}>Open review</Link>
            </div>
          ),
        },
        { key: 'decision', header: 'Decision', cell: (item) => <StatusPill>{item.review_state?.decision ?? 'none'}</StatusPill> },
        { key: 'status', header: 'Status', cell: (item) => item.status ?? 'unknown' },
        { key: 'reviewer', header: 'Reviewer', cell: (item) => item.reviewer_actor_id ?? 'unassigned' },
        { key: 'package', header: 'Package', cell: (item) => item.parent?.title ?? 'Package unavailable' },
        { key: 'changed', header: 'Changed files', cell: (item) => item.review_state?.changed_file_count ?? 0 },
        { key: 'updated', header: 'Updated', cell: (item) => formatAge(item.updated_at) },
      ]}
      emptyMessage="No review packets are available for this project."
      getRowKey={(item) => item.id}
      rows={items}
    />
  );
}

function RequestedChangesList({ changes }: { changes: RequestedChange[] }) {
  if (!changes.length) {
    return <InlineNotice title="No requested changes recorded." />;
  }

  return (
    <div className="grid gap-3">
      {changes.map((change) => (
        <article className="grid gap-3 rounded-card border border-border bg-surface p-4" key={`${change.title}-${change.file_path ?? 'general'}`}>
          <h3 className="text-sm font-semibold text-text-primary">{change.title}</h3>
          <p className="text-sm text-text-secondary">{change.description}</p>
          <MetadataGrid
            items={[
              { label: 'Severity', value: change.severity ?? 'unknown' },
              { label: 'File', value: change.file_path ? fileNameLabel(change.file_path) : 'not file-specific' },
              { label: 'Validation', value: change.suggested_validation ?? 'not recorded' },
            ]}
          />
        </article>
      ))}
    </div>
  );
}

function RegistryState({ isError, isPending, kind }: { isError: boolean; isPending: boolean; kind: string }) {
  if (isPending) return <InlineNotice title={`Loading ${kind}.`} tone="info" />;
  if (isError) return <InlineNotice title={`The ${kind} inventory is temporarily unavailable.`} tone="danger" />;
  return null;
}

function FilterSummary({ filters, unsupportedFilters }: { filters: ReviewFilters; unsupportedFilters: string[] }) {
  const supported = Object.entries(filters)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => reviewFilterLabel(key, value));

  return (
    <div className="grid gap-3">
      {supported.length ? <p>Applied filters: {supported.join(', ')}</p> : <p>No review filters applied.</p>}
      {unsupportedFilters.length ? (
        <InlineNotice title={`${formatList(unsupportedFilters)} are not applied to the review packet inventory yet.`} tone="warning" />
      ) : null}
    </div>
  );
}

function DegradedNotice({ degradedSources }: { degradedSources: string[] }) {
  if (!degradedSources.length) return null;
  return <InlineNotice title={`Some review data is incomplete: ${degradedSources.join(', ')}.`} tone="warning" />;
}

function ReplayState({ isError, isPending, timeline }: { isError: boolean; isPending: boolean; timeline: TimelineEntry[] }) {
  if (isPending) return <InlineNotice title="Loading timeline." tone="info" />;
  if (isError) return <InlineNotice title="Timeline is temporarily unavailable." tone="danger" />;
  if (!timeline.length) return <InlineNotice title="No timeline events recorded." />;
  return <Timeline items={timeline.map(timelineItem)} />;
}

function PillList({ empty, values }: { empty: string; values: string[] }) {
  if (!values.length) return <InlineNotice title={empty} />;
  return (
    <PillGroup>
      {values.map((value) => (
        <Badge key={value}>{value}</Badge>
      ))}
    </PillGroup>
  );
}

function InvalidDetail({ message, title }: { message: string; title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Section title="Unavailable">
        <InlineNotice title={message} tone="danger" />
      </Section>
    </>
  );
}

function reviewFiltersFromSearch(searchParams: URLSearchParams): ReviewFilters {
  const filters: ReviewFilters = {};
  for (const key of supportedReviewFilters) {
    const value = searchParams.get(key)?.trim();
    if (!value) continue;
    if (key === 'limit') {
      const parsed = Number(value);
      filters.limit = Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 100;
    } else {
      filters[key as Exclude<keyof ReviewFilters, 'limit'>] = value;
    }
  }
  return filters;
}

function unsupportedReviewFilters(searchParams: URLSearchParams) {
  const unsupported = Array.from(searchParams.keys()).filter(
    (key) => key !== 'project_id' && !supportedReviewFilters.includes(key),
  );
  const limit = searchParams.get('limit');
  if (limit !== null) {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      unsupported.push('limit');
    }
  }
  return Array.from(new Set(unsupported));
}

function timelineItem(entry: TimelineEntry): TimelineItem {
  return {
    id: entry.id,
    title: entry.summary,
    meta: formatDate(entry.created_at),
  };
}

function changedFileLabel(file: ChangedFile) {
  return fileNameLabel(file.path);
}

function fileNameLabel(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? 'file';
}

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function reviewFilterLabel(key: string, value: unknown) {
  if (key === 'execution_package_id') return 'Package filter applied';
  if (key === 'run_session_id') return 'Run filter applied';
  if (key === 'reviewer_actor_id') return 'Reviewer filter applied';
  if (key === 'decision') return `Decision: ${String(value)}`;
  if (key === 'status') return `Status: ${String(value)}`;
  if (key === 'limit') return `Limit: ${String(value)}`;
  if (key === 'cursor') return 'Cursor filter applied';
  return `${key}: ${String(value)}`;
}

function formatDate(value: string | undefined) {
  return value ?? 'not recorded';
}

function formatAge(value: string | undefined) {
  if (!value) return 'unknown';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function reviewDecisionTone(value: string | undefined) {
  const normalized = value?.toLowerCase() ?? '';
  if (['approved', 'completed', 'passed'].includes(normalized)) return 'success';
  if (['changes_requested', 'failed', 'rejected'].includes(normalized)) return 'danger';
  if (['pending', 'requested'].includes(normalized)) return 'warning';
  return 'info';
}

function reviewDecisionDisabledReason(review: ReviewPacket) {
  if (review.status === 'completed') {
    return 'Review decisions are disabled because this review is already completed.';
  }
  if (review.status === 'archived') {
    return 'Review decisions are disabled because this review is archived.';
  }
  if (review.decision !== 'none') {
    return 'Review decisions are disabled because this review already has a recorded decision.';
  }
  return undefined;
}
