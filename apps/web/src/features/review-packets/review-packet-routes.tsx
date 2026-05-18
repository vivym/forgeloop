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
import { ActionRail, DetailLayout, PageHeader, Section } from '../../shared/layout';
import { Button, DataTable, StatusPill, Timeline, type TimelineItem } from '../../shared/ui';

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

  if (reviewQuery.status === 'pending') {
    return <InvalidDetail title="Review" message="Loading review packet." />;
  }

  if (reviewQuery.isError || reviewQuery.data === undefined) {
    return <InvalidDetail title="Review" message="Review packet data is temporarily unavailable." />;
  }

  const review = reviewQuery.data;
  const actionPending = approveReview.isPending || requestChanges.isPending;

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Review actions">
          <div className="stack-form compact">
            <Button
              disabled={actionPending}
              loading={approveReview.isPending}
              onClick={() =>
                approveReview.mutate({
                  summary: 'Approved from Reviews route.',
                  reviewed_by_actor_id: actorId,
                  reviewed_at: new Date().toISOString(),
                })
              }
              variant="primary"
            >
              Approve
            </Button>
            <Button
              disabled={actionPending}
              loading={requestChanges.isPending}
              onClick={() =>
                requestChanges.mutate({
                  summary: 'Changes requested from Reviews route.',
                  reviewed_by_actor_id: actorId,
                  reviewed_at: new Date().toISOString(),
                  requested_changes: [
                    {
                      title: 'Address review packet feedback',
                      description: 'Review packet requires changes before approval.',
                      severity: 'major',
                    },
                  ],
                })
              }
              variant="secondary"
            >
              Request changes
            </Button>
          </div>
        </ActionRail>
      }
      header={<PageHeader subtitle={`Decision ${review.decision} / Status ${review.status}`} title={review.summary ?? review.id} />}
    >
      <Section title="Summary" description="Decision state, related package, and related run.">
        <dl className="fl-metadata-grid">
          <Metadata label="Decision" value={review.decision} />
          <Metadata label="Status" value={`Status: ${review.status}`} />
          <Metadata label="Reviewer" value={review.reviewer_actor_id} />
          <Metadata label="Reviewed by" value={review.reviewed_by_actor_id ?? 'not recorded'} />
          <Metadata label="Reviewed at" value={formatDate(review.reviewed_at)} />
        </dl>
        <div className="fl-inline-actions">
          <Link to={`/packages/${encodeURIComponent(review.execution_package_id)}`}>Open package</Link>
          <Link to={`/runs/${encodeURIComponent(review.run_session_id)}`}>Open run</Link>
        </div>
      </Section>
      <Section title="Changed files" description="Files included in the review packet.">
        <PillList empty="No changed files recorded." values={(review.changed_files ?? []).map(changedFileLabel)} />
      </Section>
      <Section title="Check summary" description="Required check outcome for reviewer handoff.">
        <p>{review.check_result_summary ?? 'Check summary unavailable from review packet API.'}</p>
      </Section>
      <Section title="Self-review" description="Implementer self-review and remaining risk notes.">
        <p>{review.self_review?.summary ?? 'Self-review summary unavailable.'}</p>
        <dl className="fl-metadata-grid">
          <Metadata label="Status" value={review.self_review?.status ?? 'unknown'} />
          <Metadata label="Spec / Plan alignment" value={review.self_review?.spec_plan_alignment ?? 'unknown'} />
          <Metadata label="Test assessment" value={review.self_review?.test_assessment ?? 'unknown'} />
        </dl>
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
            <div className="stack-form compact">
              <strong>{item.title}</strong>
              <Link to={`/reviews/${encodeURIComponent(item.object.id)}`}>Open review</Link>
            </div>
          ),
        },
        { key: 'decision', header: 'Decision', cell: (item) => <StatusPill>{item.review_state?.decision ?? 'none'}</StatusPill> },
        { key: 'status', header: 'Status', cell: (item) => item.status ?? 'unknown' },
        { key: 'reviewer', header: 'Reviewer', cell: (item) => item.reviewer_actor_id ?? 'unassigned' },
        { key: 'package', header: 'Package', cell: (item) => item.parent?.title ?? item.review_state?.execution_package_id ?? 'unknown' },
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
    return <p className="empty">No requested changes recorded.</p>;
  }

  return (
    <div className="stack-form compact">
      {changes.map((change) => (
        <article className="fl-card" key={`${change.title}-${change.file_path ?? 'general'}`}>
          <h3>{change.title}</h3>
          <p>{change.description}</p>
          <dl className="fl-metadata-grid">
            <Metadata label="Severity" value={change.severity ?? 'unknown'} />
            <Metadata label="File" value={change.file_path ?? 'not file-specific'} />
            <Metadata label="Validation" value={change.suggested_validation ?? 'not recorded'} />
          </dl>
        </article>
      ))}
    </div>
  );
}

function RegistryState({ isError, isPending, kind }: { isError: boolean; isPending: boolean; kind: string }) {
  if (isPending) return <p className="empty">Loading {kind}.</p>;
  if (isError) return <p className="empty">The {kind} inventory is temporarily unavailable.</p>;
  return null;
}

function FilterSummary({ filters, unsupportedFilters }: { filters: ReviewFilters; unsupportedFilters: string[] }) {
  const supported = Object.entries(filters)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return (
    <div className="stack-form compact">
      {supported.length ? <p>Applied filters: {supported.join(', ')}</p> : <p>No review filters applied.</p>}
      {unsupportedFilters.length ? (
        <p className="empty">{formatList(unsupportedFilters)} are not applied to the review packet inventory yet.</p>
      ) : null}
    </div>
  );
}

function DegradedNotice({ degradedSources }: { degradedSources: string[] }) {
  if (!degradedSources.length) return null;
  return <p className="empty">Some review data is incomplete: {degradedSources.join(', ')}.</p>;
}

function ReplayState({ isError, isPending, timeline }: { isError: boolean; isPending: boolean; timeline: TimelineEntry[] }) {
  if (isPending) return <p className="empty">Loading timeline.</p>;
  if (isError) return <p className="empty">Timeline is temporarily unavailable.</p>;
  if (!timeline.length) return <p className="empty">No timeline events recorded.</p>;
  return <Timeline items={timeline.map(timelineItem)} />;
}

function PillList({ empty, values }: { empty: string; values: string[] }) {
  if (!values.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="fl-pill-list">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

function Metadata({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function InvalidDetail({ message, title }: { message: string; title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Section title="Unavailable">
        <p className="empty">{message}</p>
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
  return file.path;
}

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
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
