import { Link, useParams } from 'react-router';

import { useReleaseCockpitQuery, useReleaseReadinessQuery, useReleasesQuery } from '../../shared/api/hooks';
import type { ObjectRef, ReleaseCockpitResponse, ReleaseReadinessDetail, ReleaseSummary } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { CompactMetadata, EvidenceDrawer, GateProgress, ProductPage, ReleaseEvidenceLayout, ReleaseReadinessLayout, Section } from '../../shared/layout';
import { Button, DataTable, InlineNotice, StatusPill, type DataTableColumn } from '../../shared/ui';
import { SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';
import { releaseViewModel } from './release-view-model';

type ReleaseScopeRef = Extract<ObjectRef, { type: 'initiative' | 'requirement' | 'tech_debt' | 'development_plan_item' | 'bug' }>;
type ReadinessEvidenceItem =
  | ReleaseReadinessDetail['required_review_evidence'][number]
  | ReleaseReadinessDetail['required_test_acceptance_evidence'][number]
  | ReleaseReadinessDetail['package_run_evidence'][number]
  | ReleaseReadinessDetail['observation_evidence'][number];

const releaseScreenReaderSummaryClassName =
  'pointer-events-none absolute left-0 top-0 m-0 h-px w-px list-none overflow-hidden p-0 whitespace-normal break-words [clip-path:inset(50%)]';

export function ReleasesRoute() {
  const { projectId } = useProjectContext();
  const query = useReleasesQuery({ project_id: projectId, limit: 100 });
  const releases = query.data?.releases ?? [];
  const blockedCount = releases.filter((release) => release.gate_state !== 'approved' && release.resolution !== 'completed').length;
  const columns: DataTableColumn<ReleaseSummary>[] = [
    {
      key: 'release',
      header: 'Release',
      cell: (release) => (
        <Link className="font-semibold text-primary hover:underline" to={`/releases/${encodeURIComponent(release.id)}`}>
          {release.title}
        </Link>
      ),
    },
    { key: 'scope', header: 'Coverage', cell: (release) => compactText(release.scope_summary ?? 'Coverage not recorded') },
    {
      key: 'readiness',
      header: 'Gate state',
      cell: (release) => <StatusPill tone={release.gate_state === 'approved' ? 'success' : 'warning'}>{formatValue(release.gate_state)}</StatusPill>,
    },
    { key: 'phase', header: 'Phase', cell: (release) => formatValue(release.phase) },
    { key: 'owner', header: 'Release owner', cell: () => 'Release owner' },
    { key: 'next', header: 'Next action', cell: (release) => inventoryNextAction(release) },
  ];

  return (
    <ProductPage family="release-readiness" ariaLabel="Releases">
      <h1 className="mb-3 text-xl font-semibold text-text-primary">Releases</h1>
      <ReleaseReadinessLayout
        blockers={
          <div className="grid gap-4">
            <SurfaceStateIndicator label="Release inventory" state={releaseInventorySurfaceState(query.isLoading, query.isError, releases, blockedCount)} />
            <ReleaseScreenReaderSummary
              items={[
                query.isError ? 'Release inventory could not be loaded.' : `${blockedCount} release approval gate(s) need review.`,
                query.isError
                  ? 'Retry release inventory load.'
                  : releases.length === 0
                    ? 'Create a governed release from ready Plan Items.'
                    : 'Review the highest-risk release readiness row.',
                'Release owner reviews approval, launch, and rollback state.',
                query.isLoading ? 'Loading release inventory' : `${releases.length} release(s) in inventory`,
              ]}
            />
            <Section
              description="Scope, readiness, risk, approval, release owner. Dense inventory rows keep coverage, gate state, owner role, and next action scannable without opening raw package or Work Item browsers."
              title="Release inventory"
            >
              {query.isLoading ? <InlineNotice title="Loading releases." tone="info" /> : null}
              {query.isError ? <InlineNotice title="Releases could not be loaded." tone="danger" /> : null}
              <DataTable
                ariaLabel="Release inventory"
                columns={columns}
                density="compact"
                emptyMessage="No releases match the current filters."
                getRowKey={(release) => release.id}
                rows={releases}
                stickyHeader
              />
            </Section>
          </div>
        }
      />
    </ProductPage>
  );
}

export function ReleaseDetailRoute() {
  const { releaseId } = useParams();

  if (releaseId === undefined) {
    return <ReleaseUnavailable family="release-readiness" heading="Release Readiness" />;
  }

  return <ReleaseDetailContent releaseId={releaseId} />;
}

function ReleaseDetailContent({ releaseId }: { releaseId: string }) {
  const { projectId } = useProjectContext();
  const cockpitQuery = useReleaseCockpitQuery(releaseId);
  const readinessQuery = useReleaseReadinessQuery(releaseId, projectId);
  const release = cockpitQuery.data?.release;
  const readiness = readinessQuery.data;

  if (cockpitQuery.isLoading || readinessQuery.isLoading) {
    return <ReleaseLoading family="release-readiness" heading="Loading release data" />;
  }

  if (cockpitQuery.isError || readinessQuery.isError || release === undefined || readiness === undefined) {
    return <ReleaseUnavailable family="release-readiness" heading="Release Readiness" />;
  }

  return <ReleaseReadinessWorkspace cockpit={cockpitQuery.data} readiness={readiness} release={release} />;
}

function ReleaseReadinessWorkspace({
  cockpit,
  readiness,
  release,
}: {
  cockpit: ReleaseCockpitResponse | undefined;
  readiness: ReleaseReadinessDetail;
  release: ReleaseSummary;
}) {
  const viewModel = releaseViewModel({ release, readiness });
  const actions = viewModel.actions ?? [];
  const launchAction = actions.find((action) => action.id === 'launch');
  const rollbackAction = actions.find((action) => action.id === 'rollback');
  const disabledReason = launchAction?.disabledReason ?? viewModel.disabledReason;
  const rollbackText = rollbackAction?.disabledReason === undefined ? 'Rollback: plan ready' : `Rollback disabled: ${rollbackAction.disabledReason}`;

  return (
    <ProductPage
      family="release-readiness"
      ariaLabel="Release Readiness"
    >
      <h1 className="mb-3 text-xl font-semibold text-text-primary">Release Readiness</h1>
      <ReleaseReadinessLayout
        blockers={
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={launchAction?.enabled !== true} size="sm" variant="primary">
                Launch release
              </Button>
              <Button disabled={rollbackAction?.enabled !== true} size="sm" variant="secondary">
                Rollback release
              </Button>
            </div>
            <SurfaceStateIndicator label="Release readiness" state={readiness.ready ? 'approved' : 'blocked'} />
            <ReleaseScreenReaderSummary
              items={[
                `High-risk changes: ${highRiskSummary(cockpit)}. Approvals: ${approvalSummary(readiness)}.`,
                `${disabledReason === undefined ? 'Launch release is available' : `Launch disabled: ${disabledReason}`}. ${rollbackText}.`,
                `${viewModel.primaryActorOrRole} owns approval review, launch decision, rollback readiness, and evidence relevance.`,
                `Readiness ${readiness.ready ? 'ready' : 'blocked'} for ${readiness.scope_refs.length} scope object(s)`,
                `${release.scope_summary ?? 'Release scope unavailable.'} Readiness by Spec, Implementation Plan Doc, execution, code review, QA, release blockers, evidence, rollback plan, observation.`,
              ]}
            />
            <Section title={release.title}>
              <CompactMetadata
                items={[
                  { label: 'Scope', value: release.scope_summary ?? 'Scope summary unavailable' },
                  { label: 'Readiness', value: readiness.ready ? 'Ready' : 'Blocked' },
                  { label: 'High-risk changes', value: highRiskSummary(cockpit) },
                  { label: 'Approvals', value: approvalSummary(readiness) },
                  { label: 'Launch disabled', value: disabledReason ?? 'No launch blocker recorded' },
                  { label: 'Rollback', value: rollbackAction?.disabledReason ?? release.rollback_plan ?? 'Rollback plan unavailable' },
                ]}
              />
            </Section>
            <ReadinessSection readiness={readiness} />
          </div>
        }
        evidence={
          <EvidenceDrawer
            description="Raw evidence stays secondary to release readiness and scoped relevance."
            title="Secondary evidence context"
            content={<EvidenceContext cockpit={cockpit} readiness={readiness} />}
          />
        }
        rolloutPlan={
          <Section title="Readiness breakdown" variant="subtle">
            <GateProgress
              gates={viewModel.gateProgress.map((gate) => ({
                id: gate.label.toLowerCase().replaceAll(' ', '-'),
                label: gate.label,
                status: gate.disabledReason === undefined ? gate.state : `${gate.state}: ${gate.disabledReason}`,
              }))}
              {...(disabledReason === undefined ? {} : { currentGateId: 'release-blockers' })}
            />
          </Section>
        }
        scope={<TypedScopeSection scopeRefs={readiness.scope_refs} />}
      />
    </ProductPage>
  );
}

export function ReleaseEvidenceRoute() {
  const { releaseId } = useParams();

  if (releaseId === undefined) {
    return <ReleaseUnavailable family="release-evidence" heading="Release Evidence" />;
  }

  return <ReleaseEvidenceContent releaseId={releaseId} />;
}

function ReleaseEvidenceContent({ releaseId }: { releaseId: string }) {
  const { projectId } = useProjectContext();
  const cockpitQuery = useReleaseCockpitQuery(releaseId);
  const readinessQuery = useReleaseReadinessQuery(releaseId, projectId);
  const release = cockpitQuery.data?.release;
  const readiness = readinessQuery.data;

  if (cockpitQuery.isLoading || readinessQuery.isLoading) {
    return <ReleaseLoading family="release-evidence" heading="Loading evidence data" />;
  }

  if (cockpitQuery.isError || readinessQuery.isError || release === undefined || readiness === undefined) {
    return <ReleaseUnavailable family="release-evidence" heading="Release Evidence" />;
  }

  const disabledReason = releaseViewModel({ release, readiness }).disabledReason ?? readiness.disabled_reasons[0]?.message;

  return (
    <ProductPage family="release-evidence" ariaLabel="Release Evidence">
      <h1 className="mb-3 text-xl font-semibold text-text-primary">Release Evidence</h1>
      <ReleaseEvidenceLayout
        evidence={<ReadinessSection readiness={readiness} />}
        rawEvidence={
          <EvidenceDrawer
            description="Secondary evidence references remain available after readiness, relevance, and disabled reasons."
            title="Raw evidence references"
            content={<EvidenceContext cockpit={cockpitQuery.data} readiness={readiness} />}
          />
        }
        summary={
          <div className="grid gap-4">
            <SurfaceStateIndicator label="Release evidence" state={readiness.ready ? 'approved' : 'blocked'} />
            <ReleaseScreenReaderSummary
              items={[
                disabledReason === undefined ? 'Evidence readiness is clear.' : `Evidence readiness blocked: ${disabledReason}`,
                disabledReason === undefined ? 'Review relevant evidence before launch.' : `Resolve evidence relevance blocker: ${disabledReason}`,
                'Release owner validates evidence readiness and relevance with QA, reviewer, and development context.',
                `Evidence readiness ${readiness.ready ? 'ready' : 'blocked'} across ${evidenceCount(readiness)} evidence requirement(s)`,
              ]}
            />
            <Section title="Evidence readiness">
              <CompactMetadata
                items={[
                  { label: 'Evidence readiness', value: readiness.ready ? 'Ready' : 'Blocked' },
                  { label: 'Relevance', value: `${readiness.scope_refs.length} scoped object(s), ${evidenceCount(readiness)} evidence requirement(s)` },
                  { label: 'QA acceptance', value: evidenceStatusSummary(readiness.required_test_acceptance_evidence) },
                  { label: 'Release scope', value: release.scope_summary ?? 'Scope summary unavailable' },
                  { label: 'Primary blocker', value: disabledReason ?? 'No evidence blocker recorded' },
                ]}
              />
            </Section>
          </div>
        }
      />
    </ProductPage>
  );
}

function ReleaseScreenReaderSummary({ items }: { items: string[] }) {
  return (
    <ul className={releaseScreenReaderSummaryClassName} data-release-screen-reader-summary>
      {items.map((item, index) => (
        <li className="m-0 max-w-px p-0" key={`${index}:${item}`}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function TypedScopeSection({ scopeRefs }: { scopeRefs: ObjectRef[] }) {
  const typedScopeRefs = scopeRefs.filter(isReleaseScopeRef);

  return (
    <Section title="Typed scope">
      <div className="grid min-w-0 gap-2">
        {typedScopeRefs.map((ref) => (
          <Link
            className="flex min-w-0 items-start justify-between gap-3 rounded-card border border-border bg-surface p-3 text-sm hover:border-primary hover:bg-primary-soft"
            key={`${ref.type}:${ref.id}`}
            to={typedObjectHref(ref)}
          >
            <span className="shrink-0 font-semibold text-text-primary">{objectLabel(ref.type)}</span>
            <span className="min-w-0 text-right text-text-secondary break-words">{ref.title ?? ref.id}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

function ReadinessSection({ readiness }: { readiness: ReleaseReadinessDetail }) {
  const groups = [
    { title: 'Review evidence', items: readiness.required_review_evidence },
    { title: 'Test acceptance evidence', items: readiness.required_test_acceptance_evidence },
    { title: 'Execution evidence', items: readiness.package_run_evidence },
    { title: 'Observation evidence', items: readiness.observation_evidence },
  ];

  return (
    <>
      {readiness.disabled_reasons.length > 0 ? (
        <Section title="Disabled reasons">
          <ul className="m-0 grid list-none gap-2 p-0 text-sm text-text-secondary">
            {readiness.disabled_reasons.map((reason) => (
              <li key={`${reason.code}:${reason.target_ref?.type ?? 'release'}:${reason.target_ref?.id ?? readiness.release_id}`}>
                {reason.message}
                {reason.target_ref ? ` (${objectLabel(reason.target_ref.type)} ${reason.target_ref.title ?? reason.target_ref.id})` : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {groups.map((group) => (
        <Section key={group.title} title={group.title}>
          <div className="grid gap-2">
            {group.items.map((item) => (
              <ReadinessEvidenceCard item={item} key={item.requirement_id} />
            ))}
          </div>
        </Section>
      ))}
    </>
  );
}

function ReadinessEvidenceCard({ item }: { item: ReadinessEvidenceItem }) {
  const evidenceHref = executionEvidenceHref(item);

  return (
    <div className="grid gap-2 rounded-card border border-border bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={item.status === 'passed' ? 'success' : 'warning'}>{formatValue(item.status)}</StatusPill>
        <span className="font-semibold text-text-primary">{objectLabel(item.scope_ref.type)}</span>
        <span className="text-text-secondary">{item.scope_ref.title ?? item.scope_ref.id}</span>
      </div>
      <div className="text-text-secondary">{formatValue(item.kind)}</div>
      {evidenceHref ? (
        <Link className="text-primary hover:underline" to={evidenceHref}>
          Open execution evidence
        </Link>
      ) : null}
      {item.disabled_reason ? <p className="m-0 text-text-secondary">{item.disabled_reason.message}</p> : null}
    </div>
  );
}

function EvidenceContext({
  cockpit,
  readiness,
}: {
  cockpit: ReleaseCockpitResponse | undefined;
  readiness: ReleaseReadinessDetail;
}) {
  const evidenceRefs = cockpit?.evidences ?? [];

  return (
    <div className="grid gap-3 text-sm">
      <CompactMetadata
        items={[
          { label: 'Readiness evidence', value: `${evidenceCount(readiness)} requirement(s)` },
          { label: 'Release evidence refs', value: String(evidenceRefs.length) },
          { label: 'Observations', value: String(cockpit?.observations.length ?? 0) },
        ]}
      />
      <div className="grid gap-2 divide-y divide-border">
        {evidenceRefs.length > 0 ? (
          evidenceRefs.map((ref) => (
            <div className="grid gap-1 py-2 first:pt-0 last:pb-0" key={ref.id}>
              <div className="font-semibold text-text-primary">{ref.summary}</div>
              <div className="text-text-secondary">{objectLabel(ref.evidence_type)}</div>
            </div>
          ))
        ) : (
          <p className="m-0 text-text-secondary">No secondary evidence references recorded.</p>
        )}
      </div>
    </div>
  );
}

function executionEvidenceHref(item: ReadinessEvidenceItem): string | undefined {
  if (item.scope_ref.type !== 'development_plan_item' || item.evidence_ref === undefined) {
    return undefined;
  }
  const itemId = encodeURIComponent(item.scope_ref.id);
  const evidenceRef = item.evidence_ref;
  if ('evidence_type' in evidenceRef && evidenceRef.evidence_type === 'package_run') {
    return `/board?development_plan_item_id=${itemId}`;
  }
  if ('authority_ref' in evidenceRef && evidenceRef.authority_ref.type === 'code_review_handoff') {
    return `/reports?development_plan_item_id=${itemId}&code_review_handoff_id=${encodeURIComponent(evidenceRef.authority_ref.id)}`;
  }
  if ('code_review_handoff_id' in evidenceRef && evidenceRef.code_review_handoff_id !== undefined) {
    return `/reports?development_plan_item_id=${itemId}&code_review_handoff_id=${encodeURIComponent(evidenceRef.code_review_handoff_id)}`;
  }
  return undefined;
}

function ReleaseLoading({ family, heading }: { family: 'release-readiness' | 'release-evidence'; heading: string }) {
  const isEvidence = family === 'release-evidence';
  return (
    <ProductPage family={family} ariaLabel={heading}>
      <h1 className="mb-3 text-xl font-semibold text-text-primary">{heading}</h1>
      {isEvidence ? (
        <ReleaseEvidenceLayout
          summary={
            <Section title="Release evidence">
              <SurfaceStateIndicator label={heading} state="loading" />
              <InlineNotice title="Release readiness is loading." tone="info" />
            </Section>
          }
        />
      ) : (
        <ReleaseReadinessLayout
          blockers={
            <Section title="Release readiness">
              <SurfaceStateIndicator label={heading} state="loading" />
              <InlineNotice title="Release readiness is loading." tone="info" />
            </Section>
          }
        />
      )}
    </ProductPage>
  );
}

function ReleaseUnavailable({ family, heading }: { family: 'release-readiness' | 'release-evidence'; heading: string }) {
  const isEvidence = family === 'release-evidence';
  return (
    <ProductPage family={family} ariaLabel={heading}>
      <h1 className="mb-3 text-xl font-semibold text-text-primary">{heading}</h1>
      {isEvidence ? (
        <ReleaseEvidenceLayout
          summary={
            <Section title="Release evidence unavailable">
              <SurfaceStateIndicator label={heading} state="error" />
              <InlineNotice title="Release readiness is unavailable." tone="warning" />
            </Section>
          }
        />
      ) : (
        <ReleaseReadinessLayout
          blockers={
            <Section title="Release unavailable">
              <SurfaceStateIndicator label={heading} state="error" />
              <InlineNotice title="Release readiness is unavailable." tone="warning" />
            </Section>
          }
        />
      )}
    </ProductPage>
  );
}

function isReleaseScopeRef(ref: ObjectRef): ref is ReleaseScopeRef {
  return (
    ref.type === 'initiative' ||
    ref.type === 'requirement' ||
    ref.type === 'tech_debt' ||
    ref.type === 'development_plan_item' ||
    ref.type === 'bug'
  );
}

function typedObjectHref(ref: ReleaseScopeRef): string {
  switch (ref.type) {
    case 'initiative':
      return `/initiatives/${encodeURIComponent(ref.id)}`;
    case 'requirement':
      return `/requirements/${encodeURIComponent(ref.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(ref.id)}`;
    case 'development_plan_item':
      return `/development-plans/${encodeURIComponent(ref.development_plan_id)}/items/${encodeURIComponent(ref.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id)}`;
  }
}

function objectLabel(type: string): string {
  if (type === 'tech_debt') return 'Tech Debt';
  if (type === 'development_plan_item') return 'Development Plan Item';
  if (type === 'release_evidence') return 'Release evidence';
  return formatValue(type);
}

function formatValue(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function compactText(value: string): string {
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}

function inventoryNextAction(release: ReleaseSummary): string {
  if (release.gate_state === 'approved') return 'Prepare launch';
  if (release.phase === 'approval') return 'Review readiness';
  return 'Check release gate';
}

function releaseInventorySurfaceState(
  isLoading: boolean,
  isError: boolean,
  releases: ReleaseSummary[],
  blockedCount: number,
): SurfaceState {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (releases.length === 0) return 'empty';
  return blockedCount > 0 ? 'blocked' : 'approved';
}

function highRiskSummary(cockpit: ReleaseCockpitResponse | undefined): string {
  const riskSummary = cockpit?.risk_summary;
  if (riskSummary === undefined) return 'Risk signal unavailable';
  const highRiskCount =
    riskSummary.risk_blocker_count +
    riskSummary.evidence_blocker_count +
    riskSummary.failed_or_missing_check_count +
    riskSummary.packages_not_ready_count;
  if (highRiskCount === 0) return 'No high-risk changes flagged';
  return `${highRiskCount} high-risk change signal(s)`;
}

function approvalSummary(readiness: ReleaseReadinessDetail): string {
  const reviewPassed = readiness.required_review_evidence.filter((item) => item.status === 'passed').length;
  const total = readiness.required_review_evidence.length;
  if (total === 0) return 'Approval evidence unavailable';
  return `${reviewPassed}/${total} approval evidence gate(s) passed`;
}

function evidenceCount(readiness: ReleaseReadinessDetail): number {
  return (
    readiness.required_review_evidence.length +
    readiness.required_test_acceptance_evidence.length +
    readiness.package_run_evidence.length +
    readiness.observation_evidence.length
  );
}

function evidenceStatusSummary(items: ReadinessEvidenceItem[]): string {
  if (items.length === 0) return 'QA acceptance evidence unavailable';
  const passed = items.filter((item) => item.status === 'passed').length;
  return `${passed}/${items.length} QA acceptance evidence requirement(s) passed`;
}
