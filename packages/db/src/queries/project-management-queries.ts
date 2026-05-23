import type {
  BoardCard,
  BugDetail,
  BugListItem,
  EvidenceRequirementStatus,
  InitiativeDetail,
  InitiativeListItem,
  MyWorkQueueItem,
  ObjectRef,
  ProductSafeDisabledReason,
  ReleaseReadinessDetail,
  RequirementDetail,
  RequirementListItem,
  TaskDetail,
  TaskListItem,
  TechDebtDetail,
  TechDebtListItem,
} from '@forgeloop/contracts';
import { releaseReadinessDetailSchema } from '@forgeloop/contracts';
import type { ExecutionPackage, Release, ReleaseEvidence, ReviewPacket, RunSession, Task, WorkItem } from '@forgeloop/domain';
import { canGenerateRuntimePackageForTask } from '@forgeloop/domain';

import type { DeliveryRepository } from '../repositories/delivery-repository';
import { serializePublicArtifactRef, serializePublicArtifactRefs } from './public-evidence-serialization';

type WorkItemObjectType = Extract<ObjectRef['type'], 'initiative' | 'requirement' | 'bug' | 'tech_debt'>;
type MyWorkQueueObjectRef = MyWorkQueueItem['object_ref'];
type WorkItemPublicRef = Extract<MyWorkQueueObjectRef, { type: WorkItemObjectType }>;
type TypedWorkItem = WorkItem & { kind: WorkItemObjectType };
type ProductListQuery = { project_id: string };
type ReleaseRevisionAuthority = {
  current_spec_revision_id?: string;
  current_plan_revision_id?: string;
};

export async function listMyWorkQueue(
  repository: DeliveryRepository,
  query: { project_id: string; actor_id?: string },
): Promise<{ items: MyWorkQueueItem[]; degraded_sources: [] }> {
  const [workItems, tasks, releases] = await Promise.all([
    repository.listWorkItems(query.project_id),
    repository.listTasks(query.project_id),
    repository.listReleases(query.project_id),
  ]);
  const actorWorkItems =
    query.actor_id === undefined ? workItems : workItems.filter((workItem) => workItem.driver_actor_id === query.actor_id);
  const actorWorkItemKeys = new Set(actorWorkItems.map((workItem) => objectRefKey(workItemRef(workItem))));
  const actorTasks =
    query.actor_id === undefined
      ? tasks
      : tasks.filter((task) => task.parent_ref !== undefined && actorWorkItemKeys.has(objectRefKey(task.parent_ref)));
  const actorReleases =
    query.actor_id === undefined
      ? releases
      : releases.filter((release) => release.release_owner_actor_id === query.actor_id);

  return {
    items: [
      ...actorWorkItems.map((workItem) => ({ item: workItemToMyWorkQueueItem(workItem), updated_at: workItem.updated_at })),
      ...actorTasks.flatMap((task) => {
        const item = taskToMyWorkQueueItem(task);
        return item === undefined ? [] : [{ item, updated_at: task.updated_at }];
      }),
      ...actorReleases.map((release) => ({ item: releaseToMyWorkQueueItem(release), updated_at: release.updated_at })),
    ]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map(({ item }) => item),
    degraded_sources: [],
  };
}

export async function listRequirements(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: RequirementListItem[] }> {
  return { items: (await typedWorkItems(repository, query.project_id, 'requirement')).map(workItemToRequirementListItem) };
}

export async function getRequirementDetail(repository: DeliveryRepository, requirementId: string): Promise<RequirementDetail | undefined> {
  return workItemToRequirementDetail(await typedWorkItemById(repository, requirementId, 'requirement'), await repository.listTasksForParent({ type: 'requirement', id: requirementId }));
}

export async function listInitiatives(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: InitiativeListItem[] }> {
  return { items: (await typedWorkItems(repository, query.project_id, 'initiative')).map(workItemToInitiativeListItem) };
}

export async function getInitiativeDetail(repository: DeliveryRepository, initiativeId: string): Promise<InitiativeDetail | undefined> {
  const workItem = await typedWorkItemById(repository, initiativeId, 'initiative');
  return workItem === undefined ? undefined : workItemToInitiativeDetail(workItem);
}

export async function listTechDebt(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: TechDebtListItem[] }> {
  return { items: (await typedWorkItems(repository, query.project_id, 'tech_debt')).map(workItemToTechDebtListItem) };
}

export async function getTechDebtDetail(repository: DeliveryRepository, techDebtId: string): Promise<TechDebtDetail | undefined> {
  return workItemToTechDebtDetail(await typedWorkItemById(repository, techDebtId, 'tech_debt'), await repository.listTasksForParent({ type: 'tech_debt', id: techDebtId }));
}

export async function listBugs(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: BugListItem[] }> {
  return { items: (await typedWorkItems(repository, query.project_id, 'bug')).map(workItemToBugListItem) };
}

export async function getBugDetail(repository: DeliveryRepository, bugId: string): Promise<BugDetail | undefined> {
  return workItemToBugDetail(await typedWorkItemById(repository, bugId, 'bug'), await repository.listTasksForParent({ type: 'bug', id: bugId }));
}

export async function listTasks(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: TaskListItem[] }> {
  return { items: (await repository.listTasks(query.project_id)).map(taskToListItem) };
}

export async function getTaskDetail(repository: DeliveryRepository, taskId: string): Promise<TaskDetail | undefined> {
  const task = await repository.getTask(taskId);
  return task === undefined ? undefined : taskToDetail(task);
}

export async function getTaskPackageEvidence(
  repository: DeliveryRepository,
  taskId: string,
  packageId: string,
): Promise<Record<string, unknown> | undefined> {
  const executionPackage = await repository.getExecutionPackage(packageId);
  if (executionPackage === undefined || executionPackage.task_id !== taskId) {
    return undefined;
  }
  return {
    object_ref: { type: 'execution_package', id: executionPackage.id },
    task_ref: { type: 'task', id: taskId },
    href: `/tasks/${taskId}/packages/${executionPackage.id}`,
    package: publicPackageEvidence(executionPackage, taskId),
  };
}

export async function getTaskRunEvidence(
  repository: DeliveryRepository,
  taskId: string,
  runSessionId: string,
): Promise<Record<string, unknown> | undefined> {
  const runSession = await repository.getRunSession(runSessionId);
  if (runSession === undefined) {
    return undefined;
  }
  const executionPackage = await repository.getExecutionPackage(runSession.execution_package_id);
  if (executionPackage === undefined || executionPackage.task_id !== taskId) {
    return undefined;
  }
  return {
    object_ref: { type: 'run_session', id: runSession.id },
    task_ref: { type: 'task', id: taskId },
    package_ref: { type: 'execution_package', id: executionPackage.id },
    href: `/tasks/${taskId}/runs/${runSession.id}`,
    run_session: publicRunEvidence(runSession),
  };
}

export async function getTaskReviewEvidence(
  repository: DeliveryRepository,
  taskId: string,
  reviewPacketId: string,
): Promise<Record<string, unknown> | undefined> {
  const reviewPacket = await repository.getReviewPacket(reviewPacketId);
  if (reviewPacket === undefined) {
    return undefined;
  }
  const executionPackage = await repository.getExecutionPackage(reviewPacket.execution_package_id);
  if (executionPackage === undefined || executionPackage.task_id !== taskId) {
    return undefined;
  }
  return {
    object_ref: { type: 'review_packet', id: reviewPacket.id },
    task_ref: { type: 'task', id: taskId },
    package_ref: { type: 'execution_package', id: executionPackage.id },
    href: `/tasks/${taskId}/reviews/${reviewPacket.id}`,
    review_packet: publicReviewEvidence(reviewPacket),
  };
}

export async function getReleaseReadinessDetail(
  repository: DeliveryRepository,
  releaseId: string,
  options: { project_id?: string } = {},
): Promise<ReleaseReadinessDetail | undefined> {
  const release = await repository.getRelease(releaseId);
  if (release === undefined || (options.project_id !== undefined && release.project_id !== options.project_id)) {
    return undefined;
  }
  const scopeRefs = releaseScopeRefs(release);
  const evidence = await repository.listReleaseEvidences(releaseId);
  const revisionAuthority = releaseRevisionAuthority(release);
  const disabledReasons: ProductSafeDisabledReason[] = [];
  recordWrongScopeEvidence(evidence, scopeRefs, disabledReasons);
  const reviewGates = scopeRefs.map((scopeRef) => reviewGateFor(scopeRef, evidence, disabledReasons, revisionAuthority));
  const testGates = scopeRefs.map((scopeRef) => testGateFor(scopeRef, evidence, disabledReasons, revisionAuthority));
  const detail: ReleaseReadinessDetail = {
    release_id: release.id,
    scope_refs: scopeRefs,
    required_review_evidence: reviewGates,
    required_test_acceptance_evidence: testGates,
    package_run_evidence: [],
    observation_evidence: [],
    ready: disabledReasons.length === 0 && reviewGates.every((gate) => gate.status === 'passed') && testGates.every((gate) => gate.status === 'passed'),
    disabled_reasons: uniqueDisabledReasons(disabledReasons),
  };

  return releaseReadinessDetailSchema.parse(detail);
}

export async function listBoardCards(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: BoardCard[] }> {
  const [workItems, tasks, releases] = await Promise.all([
    repository.listWorkItems(query.project_id),
    repository.listTasks(query.project_id),
    repository.listReleases(query.project_id),
  ]);
  return {
    items: [
      ...workItems.map(workItemToBoardCard),
      ...tasks.map(taskToBoardCard),
      ...releases.map(releaseToBoardCard),
    ],
  };
}

export async function getReport(
  repository: DeliveryRepository,
  reportId: string,
  query: ProductListQuery,
): Promise<{ id: string; project_id: string; generated_at?: string; degraded_sources: [] }> {
  const releases = await repository.listReleases(query.project_id);
  return {
    id: reportId,
    project_id: query.project_id,
    degraded_sources: [],
    ...(releases[0]?.updated_at === undefined ? {} : { generated_at: releases[0].updated_at }),
  };
}

function workItemKindToObjectType(kind: WorkItem['kind']): WorkItemObjectType {
  return kind;
}

async function typedWorkItems(repository: DeliveryRepository, projectId: string, kind: WorkItemObjectType): Promise<TypedWorkItem[]> {
  return (await repository.listWorkItems(projectId)).filter((workItem): workItem is TypedWorkItem => workItem.kind === kind);
}

async function typedWorkItemById(
  repository: DeliveryRepository,
  workItemId: string,
  kind: WorkItemObjectType,
): Promise<TypedWorkItem | undefined> {
  const workItem = await repository.getWorkItem(workItemId);
  return workItem?.kind === kind ? (workItem as TypedWorkItem) : undefined;
}

function workItemRef(workItem: WorkItem): WorkItemPublicRef {
  return { type: workItemKindToObjectType(workItem.kind), id: workItem.id };
}

function publicWorkItemRefFromObjectRef(ref: ObjectRef): WorkItemPublicRef | undefined {
  switch (ref.type) {
    case 'initiative':
    case 'requirement':
    case 'bug':
    case 'tech_debt':
      return { type: ref.type, id: ref.id };
    default:
      return undefined;
  }
}

function workItemHref(workItem: WorkItem): string {
  const routes = {
    initiative: 'initiatives',
    requirement: 'requirements',
    tech_debt: 'tech-debt',
    bug: 'bugs',
  } satisfies Record<WorkItemObjectType, string>;
  return `/${routes[workItemKindToObjectType(workItem.kind)]}/${workItem.id}`;
}

function workItemToMyWorkQueueItem(workItem: WorkItem): MyWorkQueueItem {
  return {
    id: `${workItem.kind}:${workItem.id}`,
    object_ref: workItemRef(workItem),
    title: workItem.title,
    attention_reason: `${workItem.kind}_needs_attention`,
    actor_id: workItem.driver_actor_id,
    href: workItemHref(workItem),
  };
}

function taskToMyWorkQueueItem(task: Task): MyWorkQueueItem | undefined {
  const parentRef = task.parent_ref === undefined ? undefined : publicWorkItemRefFromObjectRef(task.parent_ref);
  if (parentRef === undefined) {
    return undefined;
  }

  return {
    id: `task:${task.id}`,
    object_ref: parentRef,
    title: task.title,
    attention_reason: task.stale_state === 'current' ? 'task_ready_for_developer' : `task_${task.stale_state}`,
    href: `/tasks/${task.id}`,
  };
}

function releaseToMyWorkQueueItem(release: Release): MyWorkQueueItem {
  return {
    id: `release:${release.id}`,
    object_ref: { type: 'release', id: release.id },
    title: release.title,
    attention_reason: 'release_readiness',
    actor_id: release.release_owner_actor_id,
    href: `/releases/${release.id}`,
  };
}

function baseWorkItemListItem(workItem: WorkItem) {
  return {
    id: workItem.id,
    ref: workItemRef(workItem),
    title: workItem.title,
    status: `${workItem.phase}/${workItem.activity_state}/${workItem.gate_state}`,
    priority: workItem.priority,
    risk: workItem.risk,
    driver_actor_id: workItem.driver_actor_id,
    updated_at: workItem.updated_at,
  };
}

function baseWorkItemDetail(workItem: TypedWorkItem) {
  return {
    ...baseWorkItemListItem(workItem),
    narrative_markdown: workItem.narrative_markdown,
    evidence_refs: [],
    attachment_refs: [],
  };
}

function workItemToRequirementListItem(workItem: TypedWorkItem): RequirementListItem {
  return { ...baseWorkItemListItem(workItem), ref: { type: 'requirement', id: workItem.id }, phase: workItem.phase };
}

function workItemToRequirementDetail(workItem: TypedWorkItem | undefined, tasks: Task[]): RequirementDetail | undefined {
  return workItem === undefined
    ? undefined
    : {
        ...baseWorkItemDetail(workItem),
        ref: { type: 'requirement', id: workItem.id },
        ...(workItem.current_spec_id === undefined ? {} : { spec_ref: { type: 'spec', id: workItem.current_spec_id } }),
        ...(workItem.current_plan_id === undefined ? {} : { plan_ref: { type: 'plan', id: workItem.current_plan_id } }),
        task_refs: tasks.map((task) => ({ type: 'task', id: task.id })),
        bug_refs: [],
        release_refs: workItem.current_release_id === undefined ? [] : [{ type: 'release', id: workItem.current_release_id }],
      };
}

function workItemToInitiativeListItem(workItem: TypedWorkItem): InitiativeListItem {
  const context = workItem.intake_context.type === 'initiative' ? workItem.intake_context : undefined;
  return { ...baseWorkItemListItem(workItem), ref: { type: 'initiative', id: workItem.id }, business_outcome: context?.business_outcome };
}

function workItemToInitiativeDetail(workItem: TypedWorkItem): InitiativeDetail {
  return {
    ...baseWorkItemDetail(workItem),
    ref: { type: 'initiative', id: workItem.id },
    child_refs: [],
    release_refs: workItem.current_release_id === undefined ? [] : [{ type: 'release', id: workItem.current_release_id }],
  };
}

function workItemToTechDebtListItem(workItem: TypedWorkItem): TechDebtListItem {
  const context = workItem.intake_context.type === 'tech_debt' ? workItem.intake_context : undefined;
  return { ...baseWorkItemListItem(workItem), ref: { type: 'tech_debt', id: workItem.id }, affected_modules: context?.affected_modules ?? [] };
}

function workItemToTechDebtDetail(workItem: TypedWorkItem | undefined, tasks: Task[]): TechDebtDetail | undefined {
  if (workItem === undefined) {
    return undefined;
  }
  const context = workItem.intake_context.type === 'tech_debt' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemDetail(workItem),
    ref: { type: 'tech_debt', id: workItem.id },
    affected_modules: context?.affected_modules ?? [],
    validation_strategy: context?.validation_strategy,
    ...(workItem.current_spec_id === undefined ? {} : { spec_ref: { type: 'spec', id: workItem.current_spec_id } }),
    ...(workItem.current_plan_id === undefined ? {} : { plan_ref: { type: 'plan', id: workItem.current_plan_id } }),
    task_refs: tasks.map((task) => ({ type: 'task', id: task.id })),
  };
}

function workItemToBugListItem(workItem: TypedWorkItem): BugListItem {
  return { ...baseWorkItemListItem(workItem), ref: { type: 'bug', id: workItem.id }, severity: workItem.risk };
}

function workItemToBugDetail(workItem: TypedWorkItem | undefined, tasks: Task[]): BugDetail | undefined {
  if (workItem === undefined) {
    return undefined;
  }
  const context = workItem.intake_context.type === 'bug' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemDetail(workItem),
    ref: { type: 'bug', id: workItem.id },
    observed_behavior: context?.observed_behavior,
    expected_behavior: context?.expected_behavior,
    reproduction_steps: context?.reproduction_steps ?? [],
    task_refs: tasks.map((task) => ({ type: 'task', id: task.id })),
  };
}

function taskToListItem(task: Task): TaskListItem {
  return {
    id: task.id,
    ref: { type: 'task', id: task.id },
    title: task.title,
    status: taskStatusForContract(task.status),
    parent_ref: task.parent_ref,
    package_generation_eligible: canGenerateRuntimePackageForTask(task),
    updated_at: task.updated_at,
  };
}

function taskToDetail(task: Task): TaskDetail {
  const packageGenerationEligible = canGenerateRuntimePackageForTask(task);
  return {
    ...taskToListItem(task),
    narrative_markdown: task.narrative_markdown,
    acceptance_checklist: task.acceptance_checklist,
    controlling_spec_revision_id: task.controlling_spec_revision_id,
    controlling_plan_revision_id: task.controlling_plan_revision_id,
    controlling_spec_revision_authority: task.controlling_spec_revision_id === undefined ? 'missing' : 'current_approved',
    controlling_plan_revision_authority: task.controlling_plan_revision_id === undefined ? 'missing' : 'current_approved',
    stale_state: task.stale_state,
    package_generation_eligible: packageGenerationEligible,
    audited_exception: task.audited_exception,
    attachment_refs: [],
  };
}

function taskStatusForContract(status: Task['status']): TaskListItem['status'] {
  return status === 'draft' ? 'todo' : status === 'cancelled' ? 'canceled' : status;
}

function publicPackageEvidence(executionPackage: ExecutionPackage, taskId: string): Record<string, unknown> {
  return {
    id: executionPackage.id,
    object_ref: { type: 'execution_package', id: executionPackage.id },
    scope_ref: { type: 'task', id: taskId },
    spec_revision_id: executionPackage.spec_revision_id,
    plan_revision_id: executionPackage.plan_revision_id,
    project_id: executionPackage.project_id,
    repo_id: executionPackage.repo_id,
    objective: executionPackage.objective,
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
    ...(executionPackage.current_run_session_id === undefined ? {} : { current_run_session_id: executionPackage.current_run_session_id }),
    ...(executionPackage.current_review_packet_id === undefined ? {} : { current_review_packet_id: executionPackage.current_review_packet_id }),
    ...(executionPackage.current_release_id === undefined ? {} : { current_release_id: executionPackage.current_release_id }),
    ...(executionPackage.last_run_session_id === undefined ? {} : { last_run_session_id: executionPackage.last_run_session_id }),
    ...(executionPackage.last_failure_summary === undefined ? {} : { last_failure_summary: executionPackage.last_failure_summary }),
    ...(executionPackage.blocked_reason === undefined ? {} : { blocked_reason: executionPackage.blocked_reason }),
    ...(executionPackage.created_at === undefined ? {} : { created_at: executionPackage.created_at }),
    updated_at: executionPackage.updated_at,
  };
}

function publicCheckResult(checkResult: RunSession['check_results'][number]): Record<string, unknown> {
  const stdout = checkResult.stdout === undefined ? undefined : serializePublicArtifactRef(checkResult.stdout);
  const stderr = checkResult.stderr === undefined ? undefined : serializePublicArtifactRef(checkResult.stderr);
  return {
    check_id: checkResult.check_id,
    command: checkResult.command,
    status: checkResult.status,
    exit_code: checkResult.exit_code,
    duration_seconds: checkResult.duration_seconds,
    blocks_review: checkResult.blocks_review,
    ...(stdout === undefined ? {} : { stdout }),
    ...(stderr === undefined ? {} : { stderr }),
  };
}

function publicRunEvidence(runSession: RunSession): Record<string, unknown> {
  return {
    id: runSession.id,
    object_ref: { type: 'run_session', id: runSession.id },
    execution_package_id: runSession.execution_package_id,
    requested_by_actor_id: runSession.requested_by_actor_id,
    status: runSession.status,
    executor_type: runSession.executor_type,
    changed_files: runSession.changed_files,
    check_results: runSession.check_results.map(publicCheckResult),
    artifacts: serializePublicArtifactRefs(runSession.artifacts),
    log_refs: serializePublicArtifactRefs(runSession.log_refs),
    summary: runSession.summary,
    failure_kind: runSession.failure_kind,
    failure_reason: runSession.failure_reason,
    created_at: runSession.created_at,
    updated_at: runSession.updated_at,
    started_at: runSession.started_at,
    finished_at: runSession.finished_at,
  };
}

function publicReviewEvidence(reviewPacket: ReviewPacket): Record<string, unknown> {
  return {
    id: reviewPacket.id,
    object_ref: { type: 'review_packet', id: reviewPacket.id },
    execution_package_id: reviewPacket.execution_package_id,
    run_session_id: reviewPacket.run_session_id,
    status: reviewPacket.status,
    decision: reviewPacket.decision,
    summary: reviewPacket.summary,
    changed_files: reviewPacket.changed_files,
    check_result_summary: reviewPacket.check_result_summary,
    self_review: reviewPacket.self_review,
    independent_ai_review: reviewPacket.independent_ai_review,
    test_mapping: reviewPacket.test_mapping,
    risk_notes: reviewPacket.risk_notes,
    requested_changes: reviewPacket.requested_changes,
    reviewed_by_actor_id: reviewPacket.reviewed_by_actor_id,
    reviewed_at: reviewPacket.reviewed_at,
    created_at: reviewPacket.created_at,
    updated_at: reviewPacket.updated_at,
  };
}

function releaseScopeRefs(release: Release): ObjectRef[] {
  const refs = isRecord(release.extra) && Array.isArray(release.extra.project_management_scope_refs) ? release.extra.project_management_scope_refs : [];
  return refs.filter(isObjectRef);
}

function releaseRevisionAuthority(release: Release): ReleaseRevisionAuthority {
  const currentSpecRevisionId = stringValue(release.extra, 'current_spec_revision_id');
  const currentPlanRevisionId = stringValue(release.extra, 'current_plan_revision_id');
  return {
    ...(currentSpecRevisionId === undefined ? {} : { current_spec_revision_id: currentSpecRevisionId }),
    ...(currentPlanRevisionId === undefined ? {} : { current_plan_revision_id: currentPlanRevisionId }),
  };
}

function reviewGateFor(
  scopeRef: ObjectRef,
  evidence: ReleaseEvidence[],
  disabledReasons: ProductSafeDisabledReason[],
  revisionAuthority: ReleaseRevisionAuthority,
): EvidenceRequirementStatus {
  const candidates = evidenceForScope(evidence, scopeRef, 'review');
  const invalidStatus = recordInvalidStatus(candidates, scopeRef, 'review', disabledReasons);
  if (invalidStatus !== undefined) {
    return invalidStatus;
  }
  const authoritativeCandidates = candidates.filter((item) => isAuthoritativeReview(item) && value(item.extra, 'status') === 'approved');
  const authoritative = authoritativeCandidates.find((item) => evidenceRevisionsMatch(item, revisionAuthority));
  if (authoritative === undefined) {
    if (authoritativeCandidates.length > 0) {
      disabledReasons.push(disabled('evidence_revision_mismatch', scopeRef));
      return revisionMismatchGate('review', scopeRef, 'review');
    }
    disabledReasons.push(disabled('missing_required_review', scopeRef));
    return gate('review', scopeRef, 'review', 'missing', disabled('missing_required_review', scopeRef));
  }
  const evidenceSpecRevisionId = stringValue(authoritative.extra, 'spec_revision_id');
  const evidencePlanRevisionId = stringValue(authoritative.extra, 'plan_revision_id');
  return {
    requirement_id: `review:${scopeRef.type}:${scopeRef.id}`,
    scope_ref: scopeRef,
    kind: 'review',
    status: 'passed',
    ...revisionFields(revisionAuthority, evidenceSpecRevisionId, evidencePlanRevisionId),
    evidence_ref: {
      id: authoritative.id,
      authority_type: value(authoritative.extra, 'authority_type') === 'review_packet_approval' ? 'review_packet_approval' : 'human_review_decision',
      authority_ref:
        value(authoritative.extra, 'authority_type') === 'review_packet_approval'
          ? { type: 'review_packet', id: stringValue(authoritative.extra, 'review_packet_id') ?? authoritative.id }
          : { type: 'human_review_decision', id: stringValue(authoritative.extra, 'decision_id') ?? authoritative.id },
      scope_ref: scopeRef,
      status: 'approved',
      required: true,
      ...(evidenceSpecRevisionId === undefined ? {} : { spec_revision_id: evidenceSpecRevisionId }),
      ...(evidencePlanRevisionId === undefined ? {} : { plan_revision_id: evidencePlanRevisionId }),
      attachment_refs: [],
    },
  };
}

function testGateFor(
  scopeRef: ObjectRef,
  evidence: ReleaseEvidence[],
  disabledReasons: ProductSafeDisabledReason[],
  revisionAuthority: ReleaseRevisionAuthority,
): EvidenceRequirementStatus {
  const candidates = evidenceForScope(evidence, scopeRef, 'test');
  const invalidStatus = recordInvalidStatus(candidates, scopeRef, 'qa_acceptance', disabledReasons);
  if (invalidStatus !== undefined) {
    return invalidStatus;
  }
  const passingCandidates = candidates.filter((item) => value(item.extra, 'status') === 'passed' && isAuthorizedEvidence(item));
  const passing = passingCandidates.find((item) => evidenceRevisionsMatch(item, revisionAuthority));
  if (passing === undefined) {
    if (passingCandidates.length > 0) {
      disabledReasons.push(disabled('evidence_revision_mismatch', scopeRef));
      return revisionMismatchGate('test_acceptance', scopeRef, 'qa_acceptance');
    }
    disabledReasons.push(disabled('missing_required_test_acceptance', scopeRef));
    return gate('test_acceptance', scopeRef, 'qa_acceptance', 'missing', disabled('missing_required_test_acceptance', scopeRef));
  }
  return {
    requirement_id: `test_acceptance:${scopeRef.type}:${scopeRef.id}`,
    scope_ref: scopeRef,
    kind: 'qa_acceptance',
    status: 'passed',
    ...revisionFields(revisionAuthority, stringValue(passing.extra, 'spec_revision_id'), stringValue(passing.extra, 'plan_revision_id')),
    evidence_ref: {
      id: passing.id,
      scope_ref: scopeRef,
      evidence_type: 'qa_acceptance',
      status: 'passed',
      required: true,
      attachment_refs: [],
    },
  };
}

function evidenceForScope(evidence: ReleaseEvidence[], scopeRef: ObjectRef, kind: 'review' | 'test'): ReleaseEvidence[] {
  return evidence.filter((item) => {
    const itemScopeRef = isRecord(item.extra) ? item.extra.scope_ref : undefined;
    const kindMatches =
      kind === 'review'
        ? evidenceType(item) === 'review_packet' || evidenceType(item) === 'review_authority' || value(item.extra, 'authority_type') !== undefined
        : evidenceType(item) === 'test_report' || evidenceType(item) === 'test_acceptance' || value(item.extra, 'evidence_type') !== undefined;
    return kindMatches && isObjectRef(itemScopeRef) && itemScopeRef.type === scopeRef.type && itemScopeRef.id === scopeRef.id;
  });
}

function evidenceRevisionsMatch(evidence: ReleaseEvidence, revisionAuthority: ReleaseRevisionAuthority): boolean {
  const evidenceSpecRevisionId = stringValue(evidence.extra, 'spec_revision_id');
  const evidencePlanRevisionId = stringValue(evidence.extra, 'plan_revision_id');
  return (
    revisionAuthority.current_spec_revision_id !== undefined &&
    evidenceSpecRevisionId === revisionAuthority.current_spec_revision_id &&
    revisionAuthority.current_plan_revision_id !== undefined &&
    evidencePlanRevisionId === revisionAuthority.current_plan_revision_id
  );
}

function revisionFields(
  revisionAuthority: ReleaseRevisionAuthority,
  evidenceSpecRevisionId: string | undefined,
  evidencePlanRevisionId: string | undefined,
): Pick<
  EvidenceRequirementStatus,
  'current_spec_revision_id' | 'evidence_spec_revision_id' | 'current_plan_revision_id' | 'evidence_plan_revision_id'
> {
  return {
    ...(revisionAuthority.current_spec_revision_id === undefined ? {} : { current_spec_revision_id: revisionAuthority.current_spec_revision_id }),
    ...(evidenceSpecRevisionId === undefined ? {} : { evidence_spec_revision_id: evidenceSpecRevisionId }),
    ...(revisionAuthority.current_plan_revision_id === undefined ? {} : { current_plan_revision_id: revisionAuthority.current_plan_revision_id }),
    ...(evidencePlanRevisionId === undefined ? {} : { evidence_plan_revision_id: evidencePlanRevisionId }),
  };
}

function revisionMismatchGate(
  requirementId: string,
  scopeRef: ObjectRef,
  kind: EvidenceRequirementStatus['kind'],
): EvidenceRequirementStatus {
  return gate(requirementId, scopeRef, kind, 'blocked', disabled('evidence_revision_mismatch', scopeRef));
}

function recordWrongScopeEvidence(
  evidence: ReleaseEvidence[],
  scopeRefs: ObjectRef[],
  disabledReasons: ProductSafeDisabledReason[],
): void {
  for (const item of evidence) {
    const scopeRef = isRecord(item.extra) ? item.extra.scope_ref : undefined;
    if (!isObjectRef(scopeRef)) {
      continue;
    }
    if (!scopeRefs.some((releaseScopeRef) => releaseScopeRef.type === scopeRef.type && releaseScopeRef.id === scopeRef.id)) {
      disabledReasons.push(disabled('evidence_scope_mismatch', scopeRef));
    }
  }
}

function recordInvalidStatus(
  candidates: ReleaseEvidence[],
  scopeRef: ObjectRef,
  kind: EvidenceRequirementStatus['kind'],
  disabledReasons: ProductSafeDisabledReason[],
): EvidenceRequirementStatus | undefined {
  const stale = candidates.find((item) => item.status === 'stale' || value(item.extra, 'freshness') === 'stale');
  if (stale !== undefined) {
    disabledReasons.push(disabled('evidence_stale', scopeRef));
    return gate(stale.id, scopeRef, kind, 'stale', disabled('evidence_stale', scopeRef));
  }
  const unauthorized = candidates.find((item) => value(item.extra, 'authorization') === 'unauthorized' || !isAuthorizedEvidence(item));
  if (unauthorized !== undefined) {
    disabledReasons.push(disabled('evidence_unauthorized', scopeRef));
    return gate(unauthorized.id, scopeRef, kind, 'unauthorized', disabled('evidence_unauthorized', scopeRef));
  }
  const tombstoned = candidates.find((item) => value(item.extra, 'reference_status') === 'tombstoned' || value(item.extra, 'reference_status') === 'deleted');
  if (tombstoned !== undefined) {
    disabledReasons.push(disabled('evidence_tombstoned', scopeRef));
    return gate(tombstoned.id, scopeRef, kind, 'tombstoned', disabled('evidence_tombstoned', scopeRef));
  }
  return undefined;
}

function isAuthoritativeReview(evidence: ReleaseEvidence): boolean {
  const authorityType = value(evidence.extra, 'authority_type');
  return (
    (authorityType === 'human_review_decision' || authorityType === 'review_packet_approval') &&
    isAuthorizedEvidence(evidence) &&
    value(evidence.extra, 'freshness') !== 'stale' &&
    value(evidence.extra, 'reference_status') !== 'tombstoned'
  );
}

function isAuthorizedEvidence(evidence: ReleaseEvidence): boolean {
  const authorityType = value(evidence.extra, 'authority_type');
  return authorityType !== 'ai_self_review_approval' && authorityType !== 'attachment_only' && value(evidence.extra, 'authorization') !== 'unauthorized';
}

function gate(
  requirementId: string,
  scopeRef: ObjectRef,
  kind: EvidenceRequirementStatus['kind'],
  status: EvidenceRequirementStatus['status'],
  disabledReason: ProductSafeDisabledReason,
): EvidenceRequirementStatus {
  return {
    requirement_id: `${requirementId}:${scopeRef.type}:${scopeRef.id}`,
    scope_ref: scopeRef,
    kind,
    status,
    disabled_reason: disabledReason,
  };
}

function disabled(code: ProductSafeDisabledReason['code'], scopeRef: ObjectRef): ProductSafeDisabledReason {
  return {
    code,
    message: `Release is blocked by ${code.replaceAll('_', ' ')}.`,
    target_ref: scopeRef,
    remediation_route: `/${routeSegmentFor(scopeRef)}/${scopeRef.id}/evidence`,
  };
}

function routeSegmentFor(ref: ObjectRef): string {
  if (ref.type === 'tech_debt') {
    return 'tech-debt';
  }
  if (ref.type === 'task') {
    return 'tasks';
  }
  if (ref.type === 'bug') {
    return 'bugs';
  }
  if (ref.type === 'initiative') {
    return 'initiatives';
  }
  return 'requirements';
}

function uniqueDisabledReasons(reasons: ProductSafeDisabledReason[]): ProductSafeDisabledReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.code}:${reason.target_ref?.type ?? ''}:${reason.target_ref?.id ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function workItemToBoardCard(workItem: WorkItem): BoardCard {
  return {
    id: `${workItem.kind}:${workItem.id}`,
    object_ref: workItemRef(workItem),
    title: workItem.title,
    column_id: workItem.phase,
    status: `${workItem.phase}/${workItem.activity_state}/${workItem.gate_state}`,
    priority: workItem.priority,
    risk: workItem.risk,
    driver_actor_id: workItem.driver_actor_id,
    blocked: false,
    href: workItemHref(workItem),
  };
}

function taskToBoardCard(task: Task): BoardCard {
  return {
    id: `task:${task.id}`,
    object_ref: { type: 'task', id: task.id },
    title: task.title,
    column_id: task.status,
    status: task.status,
    blocked: task.status === 'blocked' || task.stale_state !== 'current',
    href: `/tasks/${task.id}`,
  };
}

function releaseToBoardCard(release: Release): BoardCard {
  return {
    id: `release:${release.id}`,
    object_ref: { type: 'release', id: release.id },
    title: release.title,
    column_id: release.phase,
    status: `${release.phase}/${release.activity_state}/${release.gate_state}`,
    driver_actor_id: release.release_owner_actor_id,
    blocked: false,
    href: `/releases/${release.id}`,
  };
}

function evidenceType(evidence: ReleaseEvidence): string {
  return evidence.evidence_type;
}

function isObjectRef(valueToCheck: unknown): valueToCheck is ObjectRef {
  return (
    isRecord(valueToCheck) &&
    typeof valueToCheck.type === 'string' &&
    typeof valueToCheck.id === 'string' &&
    ['initiative', 'requirement', 'bug', 'tech_debt', 'task', 'release'].includes(valueToCheck.type)
  );
}

function isRecord(valueToCheck: unknown): valueToCheck is Record<string, unknown> {
  return typeof valueToCheck === 'object' && valueToCheck !== null && !Array.isArray(valueToCheck);
}

function value(record: unknown, key: string): unknown {
  return isRecord(record) ? record[key] : undefined;
}

function stringValue(record: unknown, key: string): string | undefined {
  const maybeValue = value(record, key);
  return typeof maybeValue === 'string' && maybeValue.trim().length > 0 ? maybeValue : undefined;
}

function objectRefKey(ref: ObjectRef): string {
  return `${ref.type}:${ref.id}`;
}
