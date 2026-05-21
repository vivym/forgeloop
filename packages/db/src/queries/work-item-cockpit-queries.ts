import {
  type ExecutionPackage,
  type ExecutionPackageDependency,
  type Plan,
  type PlanRevision,
  type Release,
  type ReleaseEvidence,
  type ReviewPacket,
  type RunRuntimeMetadata,
  type RunSession,
  type Spec,
  type SpecRevision,
  type WorkItem,
} from '@forgeloop/domain';
import {
  workItemCockpitResponseSchema,
  type CheckResult,
  type DegradedSourceKey,
  type ProductLaneId,
  type WorkItemCockpitResponse,
} from '@forgeloop/contracts';

import type { DeliveryRepository } from '../repositories/delivery-repository';
import { serializePublicArtifactRef, serializePublicArtifactRefs } from './public-evidence-serialization';
import { deriveWorkItemDeliveryReadiness } from './work-item-delivery-readiness';
import type { ReleaseBlockerLike, ReleaseTestAcceptanceEvidenceLike } from './work-item-release-readiness';

export interface WorkItemCockpitOptions {
  run_session_metadata_fallback: RunRuntimeMetadata;
  lane?: ProductLaneId;
}

const withWorkerLeaseMetadata = async (
  _repository: DeliveryRepository,
  runSession: RunSession,
  fallbackRuntimeMetadata: RunRuntimeMetadata,
): Promise<RunSession> => {
  return runSession.runtime_metadata === undefined
    ? {
        ...runSession,
        runtime_metadata: fallbackRuntimeMetadata,
      }
    : runSession;
};

const projectWorkItem = (workItem: WorkItem) => ({
  id: workItem.id,
  project_id: workItem.project_id,
  kind: workItem.kind,
  title: workItem.title,
  goal: workItem.goal,
  success_criteria: workItem.success_criteria,
  priority: workItem.priority,
  risk: workItem.risk,
  driver_actor_id: workItem.driver_actor_id,
  intake_context: workItem.intake_context,
  phase: workItem.phase,
  activity_state: workItem.activity_state,
  gate_state: workItem.gate_state,
  resolution: workItem.resolution,
  ...(workItem.current_spec_id === undefined ? {} : { current_spec_id: workItem.current_spec_id }),
  ...(workItem.current_plan_id === undefined ? {} : { current_plan_id: workItem.current_plan_id }),
  ...(workItem.created_at === undefined ? {} : { created_at: workItem.created_at }),
  ...(workItem.updated_at === undefined ? {} : { updated_at: workItem.updated_at }),
});

const projectSpecPlan = (artifact: Spec | Plan | null) =>
  artifact === null
    ? null
    : {
        id: artifact.id,
        work_item_id: artifact.work_item_id,
        entity_type: artifact.entity_type,
        status: artifact.status,
        editing_state: artifact.editing_state,
        gate_state: artifact.gate_state,
        resolution: artifact.resolution,
        ...(artifact.current_revision_id === undefined ? {} : { current_revision_id: artifact.current_revision_id }),
        ...(artifact.approved_revision_id === undefined ? {} : { approved_revision_id: artifact.approved_revision_id }),
        ...(artifact.approved_at === undefined ? {} : { approved_at: artifact.approved_at }),
        ...(artifact.approved_by_actor_id === undefined ? {} : { approved_by_actor_id: artifact.approved_by_actor_id }),
        ...(artifact.created_at === undefined ? {} : { created_at: artifact.created_at }),
        ...(artifact.updated_at === undefined ? {} : { updated_at: artifact.updated_at }),
      };

const projectExecutionPackage = (executionPackage: ExecutionPackage) => ({
  id: executionPackage.id,
  work_item_id: executionPackage.work_item_id,
  ...(executionPackage.spec_id === undefined ? {} : { spec_id: executionPackage.spec_id }),
  ...(executionPackage.spec_revision_id === undefined ? {} : { spec_revision_id: executionPackage.spec_revision_id }),
  ...(executionPackage.plan_id === undefined ? {} : { plan_id: executionPackage.plan_id }),
  ...(executionPackage.plan_revision_id === undefined ? {} : { plan_revision_id: executionPackage.plan_revision_id }),
  ...(executionPackage.project_id === undefined ? {} : { project_id: executionPackage.project_id }),
  repo_id: executionPackage.repo_id,
  objective: executionPackage.objective,
  owner_actor_id: executionPackage.owner_actor_id,
  reviewer_actor_id: executionPackage.reviewer_actor_id,
  qa_owner_actor_id: executionPackage.qa_owner_actor_id,
  phase: executionPackage.phase,
  activity_state: executionPackage.activity_state,
  gate_state: executionPackage.gate_state,
  resolution: executionPackage.resolution,
  required_checks: executionPackage.required_checks,
  required_artifact_kinds: executionPackage.required_artifact_kinds,
  allowed_paths: executionPackage.allowed_paths,
  forbidden_paths: executionPackage.forbidden_paths,
  version: executionPackage.version,
  ...(executionPackage.last_run_session_id === undefined ? {} : { last_run_session_id: executionPackage.last_run_session_id }),
  ...(executionPackage.last_failure_summary === undefined ? {} : { last_failure_summary: executionPackage.last_failure_summary }),
  ...(executionPackage.blocked_reason === undefined ? {} : { blocked_reason: executionPackage.blocked_reason }),
  ...(executionPackage.created_at === undefined ? {} : { created_at: executionPackage.created_at }),
  ...(executionPackage.updated_at === undefined ? {} : { updated_at: executionPackage.updated_at }),
});

const projectCheckResult = (checkResult: CheckResult) => {
  const publicStdout = checkResult.stdout === undefined ? undefined : serializePublicArtifactRef(checkResult.stdout);
  const publicStderr = checkResult.stderr === undefined ? undefined : serializePublicArtifactRef(checkResult.stderr);
  return {
    check_id: checkResult.check_id,
    command: checkResult.command,
    status: checkResult.status,
    exit_code: checkResult.exit_code,
    duration_seconds: checkResult.duration_seconds,
    blocks_review: checkResult.blocks_review,
    ...(publicStdout === undefined ? {} : { stdout: publicStdout }),
    ...(publicStderr === undefined ? {} : { stderr: publicStderr }),
  };
};

const projectRuntimeMetadata = (runtimeMetadata: RunSession['runtime_metadata']) =>
  runtimeMetadata === undefined
    ? undefined
    : {
        ...(runtimeMetadata.durability_mode === undefined ? {} : { durability_mode: runtimeMetadata.durability_mode }),
        ...(runtimeMetadata.driver_kind === undefined ? {} : { driver_kind: runtimeMetadata.driver_kind }),
        ...(runtimeMetadata.driver_status === undefined ? {} : { driver_status: runtimeMetadata.driver_status }),
        ...(runtimeMetadata.last_event_at === undefined ? {} : { last_event_at: runtimeMetadata.last_event_at }),
        ...(runtimeMetadata.recovery_attempt_count === undefined
          ? {}
          : { recovery_attempt_count: runtimeMetadata.recovery_attempt_count }),
      };

const projectRunSession = (runSession: RunSession) => {
  const runtimeMetadata = projectRuntimeMetadata(runSession.runtime_metadata);
  return {
    id: runSession.id,
    execution_package_id: runSession.execution_package_id,
    requested_by_actor_id: runSession.requested_by_actor_id,
    status: runSession.status,
    ...(runSession.executor_type === undefined ? {} : { executor_type: runSession.executor_type }),
    ...(runSession.changed_files === undefined ? {} : { changed_files: runSession.changed_files }),
    check_results: runSession.check_results.map(projectCheckResult),
    artifacts: serializePublicArtifactRefs(runSession.artifacts),
    log_refs: serializePublicArtifactRefs(runSession.log_refs),
    ...(runtimeMetadata === undefined ? {} : { runtime_metadata: runtimeMetadata }),
    ...(runSession.summary === undefined ? {} : { summary: runSession.summary }),
    ...(runSession.failure_kind === undefined ? {} : { failure_kind: runSession.failure_kind }),
    ...(runSession.failure_reason === undefined ? {} : { failure_reason: runSession.failure_reason }),
    ...(runSession.created_at === undefined ? {} : { created_at: runSession.created_at }),
    ...(runSession.updated_at === undefined ? {} : { updated_at: runSession.updated_at }),
    ...(runSession.started_at === undefined ? {} : { started_at: runSession.started_at }),
    ...(runSession.finished_at === undefined ? {} : { finished_at: runSession.finished_at }),
  };
};

const projectReviewPacket = (reviewPacket: ReviewPacket) => ({
  id: reviewPacket.id,
  run_session_id: reviewPacket.run_session_id,
  execution_package_id: reviewPacket.execution_package_id,
  reviewer_actor_id: reviewPacket.reviewer_actor_id,
  status: reviewPacket.status,
  decision: reviewPacket.decision,
  ...(reviewPacket.summary === undefined ? {} : { summary: reviewPacket.summary }),
  ...(reviewPacket.changed_files === undefined ? {} : { changed_files: reviewPacket.changed_files }),
  ...(reviewPacket.check_result_summary === undefined ? {} : { check_result_summary: reviewPacket.check_result_summary }),
  ...(reviewPacket.self_review === undefined ? {} : { self_review: reviewPacket.self_review }),
  ...(reviewPacket.independent_ai_review === undefined ? {} : { independent_ai_review: reviewPacket.independent_ai_review }),
  ...(reviewPacket.test_mapping === undefined ? {} : { test_mapping: reviewPacket.test_mapping }),
  ...(reviewPacket.risk_notes === undefined ? {} : { risk_notes: reviewPacket.risk_notes }),
  ...(reviewPacket.requested_changes === undefined ? {} : { requested_changes: reviewPacket.requested_changes }),
  ...(reviewPacket.reviewed_by_actor_id === undefined ? {} : { reviewed_by_actor_id: reviewPacket.reviewed_by_actor_id }),
  ...(reviewPacket.reviewed_at === undefined ? {} : { reviewed_at: reviewPacket.reviewed_at }),
  ...(reviewPacket.created_at === undefined ? {} : { created_at: reviewPacket.created_at }),
  ...(reviewPacket.updated_at === undefined ? {} : { updated_at: reviewPacket.updated_at }),
});

const safeList = async <T>(
  degradedSources: Set<DegradedSourceKey>,
  source: DegradedSourceKey,
  read: () => Promise<T[]>,
): Promise<T[]> => {
  try {
    return await read();
  } catch {
    degradedSources.add(source);
    return [];
  }
};

const safeValue = async <T>(
  degradedSources: Set<DegradedSourceKey>,
  source: DegradedSourceKey,
  read: () => Promise<T | undefined>,
): Promise<T | null> => {
  try {
    return (await read()) ?? null;
  } catch {
    degradedSources.add(source);
    return null;
  }
};

const safeRevisionOrNull = async <T>(
  degradedSources: Set<DegradedSourceKey>,
  source: DegradedSourceKey,
  revisionId: string | undefined,
  read: (id: string) => Promise<T | undefined>,
): Promise<T | null> =>
  revisionId === undefined ? null : safeValue(degradedSources, source, () => read(revisionId));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCurrentApprovedRevision = (artifact: { status: string; resolution: string; current_revision_id?: string; approved_revision_id?: string }): boolean =>
  artifact.status === 'approved' &&
  artifact.resolution === 'approved' &&
  artifact.approved_revision_id !== undefined &&
  artifact.current_revision_id === artifact.approved_revision_id;

const currentApprovedPackages = (
  workItem: WorkItem,
  packages: readonly ExecutionPackage[],
  approvedSpecRevision: SpecRevision | null,
  approvedPlanRevision: PlanRevision | null,
): ExecutionPackage[] => {
  if (approvedSpecRevision === null || approvedPlanRevision === null) {
    return [];
  }
  return packages.filter(
    (executionPackage) =>
      executionPackage.work_item_id === workItem.id &&
      executionPackage.archived_at === undefined &&
      executionPackage.deleted_at === undefined &&
      executionPackage.spec_revision_id === approvedSpecRevision.id &&
      executionPackage.plan_revision_id === approvedPlanRevision.id,
  );
};

const linkedReleases = (releases: readonly Release[], workItem: WorkItem, packages: readonly ExecutionPackage[]): Release[] => {
  const packageIds = new Set(packages.map((item) => item.id));
  const linkedIds = new Set([
    workItem.current_release_id,
    ...packages.map((item) => item.current_release_id),
  ].filter((value): value is string => value !== undefined));
  return releases.filter(
    (release) =>
      linkedIds.has(release.id) ||
      release.work_item_ids.includes(workItem.id) ||
      release.execution_package_ids.some((executionPackageId) => packageIds.has(executionPackageId)),
  );
};

const releaseWithAuthoritativeScope = async (
  repository: DeliveryRepository,
  degradedSources: Set<DegradedSourceKey>,
  release: Release,
): Promise<Release> => {
  try {
    const [workItemLinks, packageLinks] = await Promise.all([
      repository.listReleaseWorkItems(release.id),
      repository.listReleaseExecutionPackages(release.id),
    ]);
    return {
      ...release,
      work_item_ids: workItemLinks.map((item) => item.work_item_id),
      execution_package_ids: packageLinks.map((item) => item.execution_package_id),
    };
  } catch {
    degradedSources.add('release_scope');
    return release;
  }
};

const releaseBlockersFromRelease = (release: Release): ReleaseBlockerLike[] => {
  const derived: ReleaseBlockerLike[] = [];
  if (release.rollout_strategy === undefined || release.rollout_strategy.trim().length === 0) {
    derived.push({
      code: 'missing_rollout_strategy',
      message: 'Release is missing a rollout strategy.',
      category: 'planning',
      overrideable: true,
      object_type: 'release',
      object_id: release.id,
    });
  }
  if (release.rollback_plan === undefined || release.rollback_plan.trim().length === 0) {
    derived.push({
      code: 'missing_rollback_plan',
      message: 'Release is missing a rollback plan.',
      category: 'planning',
      overrideable: true,
      object_type: 'release',
      object_id: release.id,
    });
  }

  const blockers = release.extra?.blockers;
  if (!Array.isArray(blockers)) {
    return derived;
  }
  return derived.concat(blockers.flatMap((candidate): ReleaseBlockerLike[] =>
    typeof candidate === 'object' && candidate !== null && 'code' in candidate && 'message' in candidate
      ? [candidate as ReleaseBlockerLike]
      : [],
  ));
};

const safeReleaseBlockers = (
  degradedSources: Set<DegradedSourceKey>,
  releases: readonly Release[],
): ReleaseBlockerLike[] => {
  try {
    return releases.flatMap(releaseBlockersFromRelease);
  } catch {
    degradedSources.add('release_blockers');
    return [];
  }
};

const releaseTestAcceptanceFromEvidence = (evidence: ReleaseEvidence): ReleaseTestAcceptanceEvidenceLike[] => {
  const extra = evidence.extra;
  const candidate = extra?.test_acceptance ?? extra?.release_test_acceptance ?? (evidence.evidence_type === 'test_report' ? extra : undefined);
  if (!isRecord(candidate)) {
    return [];
  }
  return [
    {
      release_id: evidence.release_id,
      ...(typeof candidate.gate_id === 'string' ? { gate_id: candidate.gate_id } : evidence.key === undefined ? {} : { gate_id: evidence.key }),
      state: typeof candidate.state === 'string' ? candidate.state : evidence.status,
      ...(typeof candidate.status === 'string' ? { status: candidate.status } : {}),
      ...(typeof candidate.result === 'string' ? { result: candidate.result } : {}),
      ...(typeof candidate.scope_fingerprint === 'string' ? { scope_fingerprint: candidate.scope_fingerprint } : {}),
      ...(typeof candidate.rationale === 'string' ? { rationale: candidate.rationale } : {}),
      ...(typeof candidate.reason === 'string' ? { reason: candidate.reason } : {}),
    },
  ];
};

const releaseEvidenceLike = (evidence: ReleaseEvidence) => ({
  release_id: evidence.release_id,
  evidence_type: evidence.evidence_type,
  status: evidence.status,
  ...(evidence.object_ref === undefined ? {} : { object_ref: evidence.object_ref }),
  ...(evidence.extra === undefined ? {} : { extra: evidence.extra }),
});

export async function getWorkItemCockpit(
  repository: DeliveryRepository,
  workItemId: string,
  options: WorkItemCockpitOptions,
): Promise<WorkItemCockpitResponse | undefined> {
  const workItem = await repository.getWorkItem(workItemId);
  if (workItem === undefined) {
    return undefined;
  }

  const degradedSources = new Set<DegradedSourceKey>();
  const currentSpec =
    workItem.current_spec_id === undefined
      ? null
      : await safeValue(degradedSources, 'spec', () => repository.getSpec(workItem.current_spec_id!));
  const currentPlan =
    workItem.current_plan_id === undefined
      ? null
      : await safeValue(degradedSources, 'plan', () => repository.getPlan(workItem.current_plan_id!));
  const [currentSpecRevision, approvedSpecRevision, currentPlanRevision, approvedPlanRevision] = await Promise.all([
    safeRevisionOrNull(degradedSources, 'spec_revision', currentSpec?.current_revision_id, (id) => repository.getSpecRevision(id)),
    safeRevisionOrNull(degradedSources, 'spec_revision', currentSpec?.approved_revision_id, (id) => repository.getSpecRevision(id)),
    safeRevisionOrNull(degradedSources, 'plan_revision', currentPlan?.current_revision_id, (id) => repository.getPlanRevision(id)),
    safeRevisionOrNull(degradedSources, 'plan_revision', currentPlan?.approved_revision_id, (id) => repository.getPlanRevision(id)),
  ]);

  const packages = await safeList(degradedSources, 'execution_packages', () => repository.listExecutionPackagesForWorkItem(workItem.id));
  const currentPackages =
    currentSpec !== null &&
    currentPlan !== null &&
    isCurrentApprovedRevision(currentSpec) &&
    isCurrentApprovedRevision(currentPlan)
      ? currentApprovedPackages(workItem, packages, approvedSpecRevision, approvedPlanRevision)
      : packages;
  const packageDependencies = (
    await Promise.all(
      currentPackages.map((item) =>
        safeList<ExecutionPackageDependency>(degradedSources, 'package_dependencies', () =>
          repository.listExecutionPackageDependencies(item.id),
        ),
      ),
    )
  ).flat();
  const runSessions = (
    await Promise.all(
      currentPackages.map((item) =>
        safeList<RunSession>(degradedSources, 'run_sessions', () => repository.listRunSessionsForPackage(item.id)),
      ),
    )
  ).flat();
  const reviewPackets = (
    await Promise.all(
      currentPackages.map((item) =>
        safeList<ReviewPacket>(degradedSources, 'review_packets', () => repository.listReviewPacketsForPackage(item.id)),
      ),
    )
  ).flat();
  const allReleases = await safeList(degradedSources, 'release_scope', () => repository.listReleases(workItem.project_id));
  const scopedReleases = await Promise.all(
    linkedReleases(allReleases, workItem, currentPackages).map((release) =>
      releaseWithAuthoritativeScope(repository, degradedSources, release),
    ),
  );
  const releaseEvidences = (
    await Promise.all(
      scopedReleases.map((release) =>
        safeList<ReleaseEvidence>(degradedSources, 'release_test_acceptance', () =>
          repository.listReleaseEvidences(release.id),
        ),
      ),
    )
  ).flat();
  const decisions = (
    await Promise.all(
      scopedReleases.map((release) =>
        safeList(degradedSources, 'decisions', () => repository.listDecisionsForObject('release', release.id)),
      ),
    )
  ).flat();
  const releaseBlockers = safeReleaseBlockers(degradedSources, scopedReleases);
  const releaseTestAcceptance = releaseEvidences.flatMap(releaseTestAcceptanceFromEvidence);

  return workItemCockpitResponseSchema.parse({
    work_item: projectWorkItem(workItem),
    current_spec: projectSpecPlan(currentSpec),
    current_plan: projectSpecPlan(currentPlan),
    packages: packages.map(projectExecutionPackage),
    run_sessions: await Promise.all(
      runSessions.map(async (runSession) =>
        projectRunSession(await withWorkerLeaseMetadata(repository, runSession, options.run_session_metadata_fallback)),
      ),
    ),
    review_packets: reviewPackets.map(projectReviewPacket),
    delivery_readiness: deriveWorkItemDeliveryReadiness({
      workItem,
      ...(options.lane === undefined ? {} : { activeLane: options.lane }),
      currentSpec,
      currentSpecRevision,
      approvedSpecRevision,
      currentPlan,
      currentPlanRevision,
      approvedPlanRevision,
      packages,
      packageDependencies,
      runSessions,
      reviewPackets,
      releases: scopedReleases,
      releaseBlockers,
      releaseTestAcceptance,
      releaseEvidence: releaseEvidences.map(releaseEvidenceLike),
      decisions,
      degradedSources: [...degradedSources],
    }),
  });
}
