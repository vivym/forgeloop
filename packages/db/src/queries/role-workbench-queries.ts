import type { RoleWorkbenchAction, RoleWorkbenchResponse } from '@forgeloop/contracts';
import type {
  ExecutionPackage,
  ExecutionPackageDependency,
  Release,
  ReviewPacket,
  RunSession,
  Spec,
  SpecRevision,
  WorkItem,
  WorkItemKind,
} from '@forgeloop/domain';
import { isOpenReviewPacketStatus } from '@forgeloop/domain';

import type { DeliveryRepository } from '../repositories/delivery-repository';
import { getReleaseCockpit } from './release-cockpit-queries';

export interface RoleWorkbenchFilters {
  project_id?: string | undefined;
  actor_id?: string | undefined;
  kind?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  phase?: string | undefined;
  status?: string | undefined;
  risk?: string | undefined;
}

type RoleWorkbenchItem = Record<string, unknown> & {
  id: string;
  object: { type: string; id: string };
  actions: RoleWorkbenchAction[];
};

type WorkbenchId =
  | 'intake'
  | 'spec-approver'
  | 'execution-owner'
  | 'reviewer'
  | 'qa-test-owner'
  | 'release-owner'
  | 'manager-health';

const defaultLimit = 50;
const workItemRequiredFields = ['project_id', 'title', 'goal', 'success_criteria', 'priority', 'risk', 'owner_actor_id'] as const;
const workItemTypeMetadata: Record<WorkItemKind, { label: string; required_fields: readonly (typeof workItemRequiredFields)[number][] }> = {
  initiative: { label: 'Initiative', required_fields: workItemRequiredFields },
  requirement: { label: 'Requirement', required_fields: workItemRequiredFields },
  bug: { label: 'Bug', required_fields: workItemRequiredFields },
  tech_debt: { label: 'Tech debt', required_fields: workItemRequiredFields },
};
type IntakeStageGroup = 'draft' | 'triage' | 'ready_for_spec';
type IntakeTypeGroupSummary = Record<IntakeStageGroup | 'total', number>;

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

const byUpdatedAtDesc = <T extends { updated_at?: string; created_at?: string; id: string }>(left: T, right: T): number => {
  const leftTime = Date.parse(left.updated_at ?? left.created_at ?? '');
  const rightTime = Date.parse(right.updated_at ?? right.created_at ?? '');
  return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime) || right.id.localeCompare(left.id);
};

const isVisible = (object: { archived_at?: string; deleted_at?: string }): boolean =>
  object.archived_at === undefined && object.deleted_at === undefined;

const action = (
  label: string,
  method: RoleWorkbenchAction['method'],
  path: string,
  options: { enabled?: boolean | undefined; reason?: string | undefined } = {},
): RoleWorkbenchAction => ({
  label,
  method,
  path,
  enabled: options.enabled ?? true,
  ...(options.reason === undefined ? {} : { reason: options.reason }),
});

const matchesStatus = (status: string | undefined, object: Record<string, unknown>): boolean => {
  if (status === undefined) {
    return true;
  }

  return [object.status, object.phase, object.activity_state, object.gate_state, object.resolution, object.decision].some(
    (value) => value === status,
  );
};

const paginate = (items: RoleWorkbenchItem[], filters: RoleWorkbenchFilters): Pick<RoleWorkbenchResponse, 'items' | 'next_cursor'> => {
  const cursorIndex = filters.cursor === undefined ? -1 : items.findIndex((item) => item.id === filters.cursor);
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const limit = filters.limit ?? defaultLimit;
  const page = items.slice(start, start + limit);
  const nextItem = items[start + limit];

  return {
    items: page,
    ...(nextItem === undefined ? {} : { next_cursor: page[page.length - 1]?.id }),
  };
};

const response = (workbenchId: WorkbenchId, items: RoleWorkbenchItem[], filters: RoleWorkbenchFilters): RoleWorkbenchResponse => {
  const page = paginate(items, filters);
  return {
    summary: {
      workbench_id: workbenchId,
      total: items.length,
      returned: page.items.length,
      filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)),
    },
    ...page,
  };
};

const listVisibleWorkItems = async (repository: DeliveryRepository, filters: RoleWorkbenchFilters): Promise<WorkItem[]> => {
  const workItems = await repository.listWorkItems(filters.project_id);
  return workItems
    .filter(isVisible)
    .filter((item) => filters.kind === undefined || item.kind === filters.kind)
    .filter((item) => filters.actor_id === undefined || item.owner_actor_id === filters.actor_id)
    .filter((item) => filters.phase === undefined || item.phase === filters.phase)
    .filter((item) => filters.risk === undefined || item.risk === filters.risk)
    .filter((item) => matchesStatus(filters.status, item as unknown as Record<string, unknown>))
    .sort(byUpdatedAtDesc);
};

const listVisiblePackages = async (
  repository: DeliveryRepository,
  filters: RoleWorkbenchFilters,
): Promise<Array<{ executionPackage: ExecutionPackage; workItem: WorkItem }>> => {
  const workItems = await listVisibleWorkItems(repository, { ...filters, actor_id: undefined, phase: undefined, status: undefined });
  const rows = (
    await Promise.all(
      workItems.map(async (workItem) =>
        (await repository.listExecutionPackagesForWorkItem(workItem.id))
          .filter(isVisible)
          .map((executionPackage) => ({ executionPackage, workItem })),
      ),
    )
  ).flat();

  return rows
    .filter(({ executionPackage }) => filters.actor_id === undefined || executionPackage.owner_actor_id === filters.actor_id)
    .filter(({ executionPackage }) => filters.phase === undefined || executionPackage.phase === filters.phase)
    .filter(({ executionPackage }) => matchesStatus(filters.status, executionPackage as unknown as Record<string, unknown>))
    .sort((left, right) => byUpdatedAtDesc(left.executionPackage, right.executionPackage));
};

const packageActions = (executionPackage: ExecutionPackage): RoleWorkbenchAction[] => [
  action('Open replay', 'GET', `/query/replay/execution_package/${executionPackage.id}`),
  action('Edit package', 'PATCH', `/execution-packages/${executionPackage.id}`),
  action('Mark ready', 'POST', `/execution-packages/${executionPackage.id}/mark-ready`, {
    enabled: executionPackage.phase === 'draft' || executionPackage.gate_state === 'changes_requested',
    reason:
      executionPackage.phase === 'draft' || executionPackage.gate_state === 'changes_requested'
        ? undefined
        : 'Package is not in a draft or changes-requested state.',
  }),
  action('Run package', 'POST', `/execution-packages/${executionPackage.id}/run`, {
    enabled: executionPackage.phase === 'ready' && executionPackage.gate_state === 'not_submitted',
    reason:
      executionPackage.phase === 'ready' && executionPackage.gate_state === 'not_submitted'
        ? undefined
        : 'Package must be ready before it can be run.',
  }),
  action('Rerun package', 'POST', `/execution-packages/${executionPackage.id}/rerun`, {
    enabled: executionPackage.last_run_session_id !== undefined || executionPackage.current_run_session_id !== undefined,
    reason:
      executionPackage.last_run_session_id !== undefined || executionPackage.current_run_session_id !== undefined
        ? undefined
        : 'Package has no prior run session to rerun.',
  }),
  action('Force rerun package', 'POST', `/execution-packages/${executionPackage.id}/force-rerun`, {
    enabled:
      executionPackage.phase === 'review' &&
      executionPackage.resolution === 'none' &&
      executionPackage.last_run_session_id !== undefined,
    reason:
      executionPackage.phase === 'review' &&
      executionPackage.resolution === 'none' &&
      executionPackage.last_run_session_id !== undefined
        ? undefined
        : 'Force rerun requires a current open review for a package in review.',
  }),
];

const latestRunSessionForPackage = async (
  repository: DeliveryRepository,
  executionPackage: ExecutionPackage,
): Promise<RunSession | undefined> => {
  const runSessions = await repository.listRunSessionsForPackage(executionPackage.id);
  return (
    runSessions.find((runSession) => runSession.id === executionPackage.current_run_session_id) ??
    runSessions.find((runSession) => runSession.id === executionPackage.last_run_session_id) ??
    [...runSessions].sort(byUpdatedAtDesc)[0]
  );
};

const requiredCheckSummary = (executionPackage: ExecutionPackage, runSession: RunSession | undefined) => {
  if (executionPackage.required_checks.length === 0) {
    return undefined;
  }

  const resultsByCheckId = new Map(runSession?.check_results.map((check) => [check.check_id, check]) ?? []);
  const passed = executionPackage.required_checks.filter((check) => resultsByCheckId.get(check.check_id)?.status === 'succeeded').length;
  const failed = executionPackage.required_checks.filter((check) => {
    const result = resultsByCheckId.get(check.check_id);
    return result !== undefined && result.status !== 'succeeded';
  }).length;

  return {
    total: executionPackage.required_checks.length,
    passed,
    failed,
    missing: executionPackage.required_checks.length - passed - failed,
  };
};

const requiredArtifactSummary = (executionPackage: ExecutionPackage, runSession: RunSession | undefined) => {
  if (executionPackage.required_artifact_kinds.length === 0) {
    return undefined;
  }

  const artifactKinds = new Set((runSession?.artifacts ?? []).map((artifact) => artifact.kind));
  const logKinds = new Set((runSession?.log_refs ?? []).map((artifact) => artifact.kind));
  const present = unique(
    executionPackage.required_artifact_kinds.filter((kind) => (kind === 'logs' ? logKinds.has(kind) : artifactKinds.has(kind))),
  );
  const missing = executionPackage.required_artifact_kinds.filter((kind) =>
    kind === 'logs' ? !logKinds.has(kind) : !artifactKinds.has(kind),
  );

  return {
    required: executionPackage.required_artifact_kinds,
    present,
    missing,
  };
};

const workItemMissingRequiredFields = (workItem: WorkItem): string[] => [
  ...(!hasText(workItem.project_id) ? ['project_id'] : []),
  ...(!hasText(workItem.title) ? ['title'] : []),
  ...(!hasText(workItem.goal) ? ['goal'] : []),
  ...(!workItem.success_criteria.some(hasText) ? ['success_criteria'] : []),
  ...(!hasText(workItem.priority) ? ['priority'] : []),
  ...(!hasText(workItem.risk) ? ['risk'] : []),
  ...(!hasText(workItem.owner_actor_id) ? ['owner_actor_id'] : []),
];

const intakeStageForWorkItem = (
  workItem: WorkItem,
  missingRequiredFields = workItemMissingRequiredFields(workItem),
): IntakeStageGroup => {
  if (workItem.phase === 'triage') {
    return 'triage';
  }
  return missingRequiredFields.length === 0 ? 'ready_for_spec' : 'draft';
};

const summarizeIntakeTypeGroups = (items: readonly RoleWorkbenchItem[]): Record<string, IntakeTypeGroupSummary> =>
  items.reduce<Record<string, IntakeTypeGroupSummary>>((groups, item) => {
    const typeGroup = String(item.type_group ?? item.kind ?? 'unknown');
    const stageGroup = ['draft', 'triage', 'ready_for_spec'].includes(String(item.stage_group))
      ? (item.stage_group as IntakeStageGroup)
      : 'draft';
    const group = (groups[typeGroup] ??= { total: 0, draft: 0, triage: 0, ready_for_spec: 0 });
    group.total += 1;
    group[stageGroup] += 1;
    return groups;
  }, {});

const specCurrentRevision = async (repository: DeliveryRepository, spec: Spec): Promise<SpecRevision | undefined> =>
  spec.current_revision_id === undefined ? undefined : repository.getSpecRevision(spec.current_revision_id);

const packageItem = (
  queue: string,
  executionPackage: ExecutionPackage,
  workItem: WorkItem,
  actions = packageActions(executionPackage),
): RoleWorkbenchItem => ({
  id: executionPackage.id,
  queue,
  object: { type: 'execution_package', id: executionPackage.id },
  work_item: { type: 'work_item', id: workItem.id, title: workItem.title },
  project_id: executionPackage.project_id,
  title: executionPackage.objective,
  phase: executionPackage.phase,
  status: executionPackage.gate_state,
  activity_state: executionPackage.activity_state,
  owner_actor_id: executionPackage.owner_actor_id,
  reviewer_actor_id: executionPackage.reviewer_actor_id,
  qa_owner_actor_id: executionPackage.qa_owner_actor_id,
  risk: workItem.risk,
  actions,
});

const runSummary = (runSession: RunSession | undefined) =>
  runSession === undefined
    ? undefined
    : {
        id: runSession.id,
        status: runSession.status,
        summary: runSession.summary,
        failure_kind: runSession.failure_kind,
        failure_reason: runSession.failure_reason,
        created_at: runSession.created_at,
        updated_at: runSession.updated_at,
        finished_at: runSession.finished_at,
      };

const reviewPacketSummary = (reviewPacket: ReviewPacket | undefined) =>
  reviewPacket === undefined
    ? undefined
    : {
        id: reviewPacket.id,
        status: reviewPacket.status,
        decision: reviewPacket.decision,
        run_session_id: reviewPacket.run_session_id,
        check_result_summary: reviewPacket.check_result_summary,
        created_at: reviewPacket.created_at,
        updated_at: reviewPacket.updated_at,
      };

const currentReviewPacketForPackage = async (
  repository: DeliveryRepository,
  executionPackage: ExecutionPackage,
): Promise<ReviewPacket | undefined> => {
  if (executionPackage.current_review_packet_id !== undefined) {
    const currentPacket = await repository.getReviewPacket(executionPackage.current_review_packet_id);
    if (currentPacket !== undefined) {
      return currentPacket;
    }
  }

  return repository.findOpenReviewPacketForPackage(executionPackage.id);
};

const dependencyStatusForPackage = async (repository: DeliveryRepository, executionPackage: ExecutionPackage) => {
  const dependencies = await repository.listExecutionPackageDependencies(executionPackage.id);
  const rows = await Promise.all(
    dependencies.map(async (dependency: ExecutionPackageDependency) => {
      const upstreamPackage = await repository.getExecutionPackage(dependency.depends_on_package_id);
      const completed = upstreamPackage?.resolution === 'completed';
      return {
        package_id: dependency.depends_on_package_id,
        dependency_type: dependency.dependency_type,
        reason: dependency.reason,
        completed,
        phase: upstreamPackage?.phase,
        gate_state: upstreamPackage?.gate_state,
        resolution: upstreamPackage?.resolution,
      };
    }),
  );
  const blockedCount = rows.filter((dependency) => !dependency.completed).length;

  return {
    total: rows.length,
    completed: rows.length - blockedCount,
    blocked_count: blockedCount,
    blocked: blockedCount > 0,
    dependencies: rows,
  };
};

const isActiveRunSession = (runSession: RunSession | undefined): boolean =>
  runSession !== undefined &&
  ['queued', 'running', 'waiting_for_input', 'stalled', 'resuming', 'cancel_requested'].includes(runSession.status);

const executionQueueForPackage = (
  executionPackage: ExecutionPackage,
  options: {
    dependencyStatus?: Awaited<ReturnType<typeof dependencyStatusForPackage>>;
    latestRun?: RunSession | undefined;
    currentReviewPacket?: ReviewPacket | undefined;
  } = {},
): string => {
  if (
    options.dependencyStatus?.blocked === true ||
    executionPackage.activity_state === 'blocked' ||
    hasText(executionPackage.blocked_reason)
  ) {
    return 'blocked';
  }
  if (
    executionPackage.phase === 'review' ||
    executionPackage.gate_state === 'awaiting_human_review' ||
    options.currentReviewPacket !== undefined
  ) {
    return 'review_handoff';
  }
  if (
    executionPackage.phase === 'queued' ||
    executionPackage.phase === 'execution' ||
    executionPackage.activity_state === 'ai_running' ||
    executionPackage.activity_state === 'ai_retrying' ||
    isActiveRunSession(options.latestRun)
  ) {
    return 'active_run';
  }
  if (executionPackage.phase === 'draft') {
    return 'draft';
  }
  return 'ready';
};

export async function getIntakeWorkbench(
  repository: DeliveryRepository,
  filters: RoleWorkbenchFilters,
): Promise<RoleWorkbenchResponse> {
  const items = (await listVisibleWorkItems(repository, filters))
    .filter((workItem) => workItem.phase === 'draft' || workItem.phase === 'triage' || workItem.phase === 'spec')
    .map<RoleWorkbenchItem>((workItem) => {
      const missingRequiredFields = workItemMissingRequiredFields(workItem);
      const stageGroup = intakeStageForWorkItem(workItem, missingRequiredFields);
      return {
        id: workItem.id,
        queue: `intake:${workItem.kind}:${stageGroup}`,
        object: { type: 'work_item', id: workItem.id },
        project_id: workItem.project_id,
        kind: workItem.kind,
        type_group: workItem.kind,
        stage_group: stageGroup,
        title: workItem.title,
        phase: workItem.phase,
        status: workItem.gate_state,
        owner_actor_id: workItem.owner_actor_id,
        risk: workItem.risk,
        missing_required_fields: missingRequiredFields,
        owner_assignment_status: hasText(workItem.owner_actor_id) ? 'assigned' : 'unassigned',
        risk_status: hasText(workItem.risk) ? 'set' : 'missing',
        success_criteria_status: workItem.success_criteria.some(hasText) ? 'present' : 'missing',
        work_item_brief_status: missingRequiredFields.length === 0 ? 'ready' : 'incomplete',
        readiness_summary: {
          ready_for_spec: missingRequiredFields.length === 0,
          missing_required_field_count: missingRequiredFields.length,
        },
        actions: [
          action('Open cockpit', 'GET', `/query/work-item-cockpit/${workItem.id}`),
          action('Edit work item', 'PATCH', `/work-items/${workItem.id}`),
          action('Create spec', 'POST', `/work-items/${workItem.id}/specs`, {
            enabled: workItem.current_spec_id === undefined,
            reason: workItem.current_spec_id === undefined ? undefined : 'Work item already has a spec.',
          }),
        ],
      };
    });

  const result = response('intake', items, filters);
  result.summary = {
    ...result.summary,
    type_metadata: workItemTypeMetadata,
    type_groups: summarizeIntakeTypeGroups(items),
  };
  return result;
}

export async function getSpecApproverWorkbench(
  repository: DeliveryRepository,
  filters: RoleWorkbenchFilters,
): Promise<RoleWorkbenchResponse> {
  const workItems = await listVisibleWorkItems(repository, { ...filters, status: undefined });
  const items: RoleWorkbenchItem[] = [];

  for (const workItem of workItems) {
    if (
      workItem.current_spec_id === undefined ||
      (workItem.gate_state !== 'awaiting_spec_approval' && workItem.gate_state !== 'spec_changes_requested')
    ) {
      continue;
    }
    const spec = await repository.getSpec(workItem.current_spec_id);
    if (spec === undefined || (spec.gate_state !== 'awaiting_approval' && spec.gate_state !== 'changes_requested')) {
      continue;
    }

    const item = await specPlanItem(repository, 'spec_approval', 'spec', spec, workItem);
    if (matchesStatus(filters.status, item)) {
      items.push(item);
    }
  }

  return response('spec-approver', items, filters);
}

const specPlanItem = async (
  repository: DeliveryRepository,
  queue: string,
  type: 'spec' | 'plan',
  item: Spec,
  workItem: WorkItem,
): Promise<RoleWorkbenchItem> => {
  const revision = await specCurrentRevision(repository, item);
  return {
    id: item.id,
    queue,
    object: { type, id: item.id },
    work_item: { type: 'work_item', id: workItem.id, title: workItem.title },
    project_id: workItem.project_id,
    title: workItem.title,
    phase: workItem.phase,
    status: item.gate_state,
    owner_actor_id: workItem.owner_actor_id,
    risk: workItem.risk,
    current_revision:
      revision === undefined
        ? undefined
        : {
            id: revision.id,
            revision_number: revision.revision_number,
            summary: revision.summary,
          },
    test_strategy: {
      summary: revision?.test_strategy_summary,
      missing: !hasText(revision?.test_strategy_summary),
    },
    risk_notes: revision?.risk_notes ?? [],
    actions: [
      action('Open cockpit', 'GET', `/query/work-item-cockpit/${workItem.id}`),
      action('Approve', 'POST', `/${type}s/${item.id}/approve`),
      action('Request changes', 'POST', `/${type}s/${item.id}/request-changes`),
    ],
  };
};

export async function getExecutionOwnerWorkbench(
  repository: DeliveryRepository,
  filters: RoleWorkbenchFilters,
): Promise<RoleWorkbenchResponse> {
  const rows = (await listVisiblePackages(repository, filters)).filter(
    ({ executionPackage }) => executionPackage.phase !== 'release' && executionPackage.phase !== 'archived',
  );
  const items = await Promise.all(
    rows.map(async ({ executionPackage, workItem }) => {
      const [dependencyStatus, latestRun, currentReviewPacket] = await Promise.all([
        dependencyStatusForPackage(repository, executionPackage),
        latestRunSessionForPackage(repository, executionPackage),
        currentReviewPacketForPackage(repository, executionPackage),
      ]);

      return {
        ...packageItem(
          executionQueueForPackage(executionPackage, {
            dependencyStatus,
            latestRun,
            currentReviewPacket,
          }),
          executionPackage,
          workItem,
        ),
        dependency_status: dependencyStatus,
        latest_run_summary: runSummary(latestRun),
        current_review_packet: reviewPacketSummary(currentReviewPacket),
      };
    }),
  );

  return response('execution-owner', items, filters);
}

export async function getReviewerWorkbench(
  repository: DeliveryRepository,
  filters: RoleWorkbenchFilters,
): Promise<RoleWorkbenchResponse> {
  const rows = await listVisiblePackages(repository, { ...filters, actor_id: undefined });
  const items: RoleWorkbenchItem[] = [];

  for (const { executionPackage, workItem } of rows) {
    if (filters.actor_id !== undefined && executionPackage.reviewer_actor_id !== filters.actor_id) {
      continue;
    }
    const packets = (await repository.listReviewPacketsForPackage(executionPackage.id))
      .filter((packet) => isOpenReviewPacketStatus(packet.status))
      .filter((packet) => matchesStatus(filters.status, packet as unknown as Record<string, unknown>))
      .sort(byUpdatedAtDesc);
    for (const packet of packets) {
      items.push(reviewPacketItem(packet, executionPackage, workItem));
    }
  }

  return response('reviewer', items, filters);
}

const reviewPacketItem = (
  reviewPacket: ReviewPacket,
  executionPackage: ExecutionPackage,
  workItem: WorkItem,
): RoleWorkbenchItem => ({
  id: reviewPacket.id,
  queue: 'review',
  object: { type: 'review_packet', id: reviewPacket.id },
  execution_package: { type: 'execution_package', id: executionPackage.id, title: executionPackage.objective },
  work_item: { type: 'work_item', id: workItem.id, title: workItem.title },
  project_id: executionPackage.project_id,
  title: reviewPacket.summary ?? executionPackage.objective,
  phase: executionPackage.phase,
  status: reviewPacket.status,
  decision: reviewPacket.decision,
  reviewer_actor_id: reviewPacket.reviewer_actor_id,
  risk: workItem.risk,
  changed_file_count: reviewPacket.changed_files.length,
  check_summary: reviewPacket.check_result_summary,
  self_review_summary: reviewPacket.self_review.summary,
  requested_changes: reviewPacket.requested_changes.map((change) => ({
    title: change.title,
    ...(hasText(change.description) ? { description: change.description } : {}),
    ...(hasText(change.file_path) ? { file_path: change.file_path } : {}),
    ...(hasText(change.severity) ? { severity: change.severity } : {}),
    ...(hasText(change.suggested_validation) ? { suggested_validation: change.suggested_validation } : {}),
  })),
  actions: [
    action('Open replay', 'GET', `/query/replay/review_packet/${reviewPacket.id}`),
    action('Approve', 'POST', `/review-packets/${reviewPacket.id}/approve`),
    action('Request changes', 'POST', `/review-packets/${reviewPacket.id}/request-changes`),
  ],
});

export async function getQaTestOwnerWorkbench(
  repository: DeliveryRepository,
  filters: RoleWorkbenchFilters,
): Promise<RoleWorkbenchResponse> {
  const packageRows = (await listVisiblePackages(repository, { ...filters, actor_id: undefined }))
    .filter(({ executionPackage }) => filters.actor_id === undefined || executionPackage.qa_owner_actor_id === filters.actor_id)
    .filter(({ executionPackage }) => filters.phase === undefined || executionPackage.phase === filters.phase)
    .filter(({ executionPackage }) => matchesStatus(filters.status, executionPackage as unknown as Record<string, unknown>));
  const items: RoleWorkbenchItem[] = [];

  const workItems = await listVisibleWorkItems(repository, { ...filters, actor_id: undefined, status: undefined });
  for (const workItem of workItems) {
    const item = await qaWorkItem(workItem, repository);
    if (item !== undefined && matchesStatus(filters.status, item)) {
      items.push(item);
    }
  }

  for (const { executionPackage, workItem } of packageRows) {
    const item = await qaPackageItem(repository, executionPackage, workItem);
    if (item !== undefined) {
      items.push(item);
    }
  }

  const releases = (await listReleases(repository, filters))
    .filter((release) => filters.phase === undefined || release.phase === filters.phase)
    .filter((release) => matchesStatus(filters.status, release as unknown as Record<string, unknown>))
    .sort(byUpdatedAtDesc);
  for (const release of releases) {
    if (!(await releaseMatchesQaActor(repository, release, filters.actor_id))) {
      continue;
    }
    const item = await qaReleaseItem(repository, release);
    if (item !== undefined) {
      items.push(item);
    }
  }

  return response('qa-test-owner', items, filters);
}

const qaWorkItem = async (workItem: WorkItem, repository: DeliveryRepository): Promise<RoleWorkbenchItem | undefined> => {
  const spec = workItem.current_spec_id === undefined ? undefined : await repository.getSpec(workItem.current_spec_id);
  const revision = spec === undefined ? undefined : await specCurrentRevision(repository, spec);
  const missingArtifacts = [
    ...(revision === undefined || !hasText(revision.test_strategy_summary) ? ['spec_test_strategy_summary'] : []),
    ...(revision === undefined || !revision.acceptance_criteria.some(hasText) ? ['spec_acceptance_criteria'] : []),
  ];

  if (missingArtifacts.length === 0) {
    return undefined;
  }

  return {
    id: `work_item:${workItem.id}`,
    queue: 'qa_test_work_item',
    object: { type: 'work_item', id: workItem.id },
    project_id: workItem.project_id,
    title: workItem.title,
    kind: workItem.kind,
    phase: workItem.phase,
    status: workItem.gate_state,
    risk: workItem.risk,
    test_strategy: {
      summary: revision?.test_strategy_summary,
      missing: !hasText(revision?.test_strategy_summary),
    },
    required_artifacts: ['spec_test_strategy_summary', 'spec_acceptance_criteria'],
    missing_artifacts: missingArtifacts,
    evidence_chain_links: [{ type: 'work_item', id: workItem.id }],
    actions: [action('Open cockpit', 'GET', `/query/work-item-cockpit/${workItem.id}`)],
  };
};

const qaPackageItem = async (
  repository: DeliveryRepository,
  executionPackage: ExecutionPackage,
  workItem: WorkItem,
): Promise<RoleWorkbenchItem | undefined> => {
  const latestRun = await latestRunSessionForPackage(repository, executionPackage);
  const checkSummary = requiredCheckSummary(executionPackage, latestRun);
  const artifactSummary = requiredArtifactSummary(executionPackage, latestRun);
  const failedBlockingChecks = latestRun?.check_results
    .filter((check) => check.blocks_review && check.status !== 'succeeded')
    .map((check) => ({ check_id: check.check_id, status: check.status })) ?? [];
  const missingArtifacts = artifactSummary?.missing ?? [];
  const hasEvidenceGap =
    (checkSummary?.missing ?? 0) > 0 ||
    (checkSummary?.failed ?? 0) > 0 ||
    missingArtifacts.length > 0 ||
    failedBlockingChecks.length > 0 ||
    latestRun?.status === 'failed' ||
    latestRun?.status === 'timed_out' ||
    latestRun?.status === 'cancelled';

  if (!hasEvidenceGap) {
    return undefined;
  }

  return {
    ...packageItem('qa_test_package', executionPackage, workItem),
    id: `execution_package:${executionPackage.id}`,
    latest_run: latestRun === undefined ? undefined : { type: 'run_session', id: latestRun.id, status: latestRun.status },
    required_checks: checkSummary,
    required_artifacts: artifactSummary,
    missing_artifacts: missingArtifacts,
    failed_blocking_checks: failedBlockingChecks,
    evidence_chain_links: [
      { type: 'execution_package', id: executionPackage.id },
      ...(latestRun === undefined ? [] : [{ type: 'run_session', id: latestRun.id }]),
    ],
  };
};

const releaseMatchesQaActor = async (
  repository: DeliveryRepository,
  release: Release,
  actorId: string | undefined,
): Promise<boolean> => {
  if (actorId === undefined) {
    return true;
  }
  const packages = await Promise.all(release.execution_package_ids.map((packageId) => repository.getExecutionPackage(packageId)));
  return packages.some((executionPackage) => executionPackage?.qa_owner_actor_id === actorId);
};

const qaReleaseItem = async (repository: DeliveryRepository, release: Release): Promise<RoleWorkbenchItem | undefined> => {
  const cockpit = await getReleaseCockpit(repository, release.id);
  if (cockpit === undefined) {
    return undefined;
  }
  const evidenceBlockers = cockpit.blockers.filter((blocker) => blocker.category === 'evidence');
  const testEvidenceBlockers = cockpit.blockers.filter((blocker) =>
    [blocker.code, blocker.category, blocker.message].join(' ').toLowerCase().includes('test'),
  );
  const missingAck = cockpit.blockers.some(
    (blocker) => blocker.code === 'missing_required_evidence_backlink' && blocker.message.toLowerCase().includes('acknowledgement'),
  );

  if (evidenceBlockers.length === 0 && testEvidenceBlockers.length === 0 && !missingAck) {
    return undefined;
  }

  return {
    id: `release:${release.id}`,
    queue: 'qa_test_release',
    object: { type: 'release', id: release.id },
    project_id: release.project_id,
    title: release.title,
    phase: release.phase,
    status: release.gate_state,
    test_strategy_summary: cockpit.work_items.map((workItem) => ({
      work_item: { type: 'work_item', id: workItem.id, title: workItem.title },
    })),
    required_checks: {
      total: cockpit.execution_packages.reduce(
        (count, executionPackage) => count + (executionPackage.required_check_summary?.total ?? 0),
        0,
      ),
      failed: cockpit.execution_packages.reduce(
        (count, executionPackage) => count + (executionPackage.required_check_summary?.failed ?? 0),
        0,
      ),
      missing: cockpit.execution_packages.reduce(
        (count, executionPackage) => count + (executionPackage.required_check_summary?.missing ?? 0),
        0,
      ),
    },
    missing_artifacts: unique(
      cockpit.execution_packages.flatMap((executionPackage) => executionPackage.required_artifact_summary?.missing ?? []),
    ),
    failed_blocking_checks: cockpit.latest_run_sessions.flatMap((runSession) =>
      runSession.check_results
        .filter((check) => check.blocks_review === true && check.status !== 'succeeded')
        .map((check) => ({ run_session_id: runSession.id, check_id: check.check_id, status: check.status })),
    ),
    release_blocker_refs: [...evidenceBlockers, ...testEvidenceBlockers].map((blocker) => ({
      code: blocker.code,
      category: blocker.category,
      ...(blocker.object_type === undefined ? {} : { object_type: blocker.object_type }),
      ...(blocker.object_id === undefined ? {} : { object_id: blocker.object_id }),
    })),
    evidence_chain_links: [
      ...cockpit.work_items.map((workItem) => ({ type: 'work_item', id: workItem.id })),
      ...cockpit.execution_packages.map((executionPackage) => ({ type: 'execution_package', id: executionPackage.id })),
      ...cockpit.latest_run_sessions.map((runSession) => ({ type: 'run_session', id: runSession.id })),
    ],
    actions: [
      action('Open cockpit', 'GET', `/query/release-cockpit/${release.id}`),
      action('Acknowledge test acceptance', 'POST', `/releases/${release.id}/test-acceptance/acknowledge`, {
        enabled: missingAck,
        reason: missingAck ? undefined : 'Release does not require QA acknowledgement.',
      }),
    ],
  };
};

const listReleases = async (repository: DeliveryRepository, filters: RoleWorkbenchFilters): Promise<Release[]> => {
  return repository.listReleases(filters.project_id);
};

export async function getReleaseOwnerWorkbench(
  repository: DeliveryRepository,
  filters: RoleWorkbenchFilters,
): Promise<RoleWorkbenchResponse> {
  const releases = (await listReleases(repository, filters))
    .filter((release) => filters.actor_id === undefined || release.release_owner_actor_id === filters.actor_id)
    .filter((release) => filters.phase === undefined || release.phase === filters.phase)
    .filter((release) => matchesStatus(filters.status, release as unknown as Record<string, unknown>))
    .sort(byUpdatedAtDesc);
  const items = await Promise.all(releases.map((release) => releaseOwnerItem(repository, release)));

  return response('release-owner', items, filters);
}

const releaseOwnerItem = async (repository: DeliveryRepository, release: Release): Promise<RoleWorkbenchItem> => {
  const cockpit = await getReleaseCockpit(repository, release.id);
  const blockers = cockpit?.blockers ?? [];
  const evidenceBlockers = blockers.filter((blocker) => blocker.category === 'evidence');
  const planningBlockers = blockers.filter((blocker) => blocker.category === 'planning');
  const latestDecision = cockpit?.decisions.at(-1);
  const hasBlockers = blockers.length > 0;

  return {
    id: release.id,
    queue: releaseOwnerQueue(release, hasBlockers),
    object: { type: 'release', id: release.id },
    project_id: release.project_id,
    title: release.title,
    phase: release.phase,
    status: release.gate_state,
    release_owner_actor_id: release.release_owner_actor_id,
    rollout_strategy_summary: release.rollout_strategy,
    rollback_plan_summary: release.rollback_plan,
    release_decision_summary: {
      latest_decision:
        latestDecision === undefined
          ? undefined
          : {
              id: latestDecision.id,
              decision_type: latestDecision.decision_type,
              outcome: latestDecision.outcome,
              created_at: latestDecision.created_at,
            },
      blocker_count: blockers.length,
      next_actions: cockpit?.next_actions ?? [],
    },
    missing_release_plan_blockers: planningBlockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
      ...(blocker.object_type === undefined ? {} : { object_type: blocker.object_type }),
      ...(blocker.object_id === undefined ? {} : { object_id: blocker.object_id }),
    })),
    test_evidence_summary: {
      blocker_count: evidenceBlockers.length,
      blockers: evidenceBlockers.map((blocker) => ({
        code: blocker.code,
        message: blocker.message,
        ...(blocker.object_type === undefined ? {} : { object_type: blocker.object_type }),
        ...(blocker.object_id === undefined ? {} : { object_id: blocker.object_id }),
      })),
      required_checks: {
        total:
          cockpit?.execution_packages.reduce(
            (count, executionPackage) => count + (executionPackage.required_check_summary?.total ?? 0),
            0,
          ) ?? 0,
        failed:
          cockpit?.execution_packages.reduce(
            (count, executionPackage) => count + (executionPackage.required_check_summary?.failed ?? 0),
            0,
          ) ?? 0,
        missing:
          cockpit?.execution_packages.reduce(
            (count, executionPackage) => count + (executionPackage.required_check_summary?.missing ?? 0),
            0,
          ) ?? 0,
      },
      missing_artifacts: unique(
        cockpit?.execution_packages.flatMap((executionPackage) => executionPackage.required_artifact_summary?.missing ?? []) ?? [],
      ),
    },
    observation_backlinks:
      cockpit?.observations.map((observation) => ({
        evidence_id: observation.id,
        evidence_type: observation.evidence_type,
        ...(observation.object_ref === undefined ? {} : { object_ref: observation.object_ref }),
      })) ?? [],
    actions: [
      action('Open cockpit', 'GET', `/query/release-cockpit/${release.id}`),
      action('Edit release', 'PATCH', `/releases/${release.id}`),
      action('Submit for approval', 'POST', `/releases/${release.id}/submit-for-approval`, {
        enabled: release.phase === 'draft' || release.phase === 'candidate',
        reason:
          release.phase === 'draft' || release.phase === 'candidate'
            ? undefined
            : 'Release is not in draft or candidate phase.',
      }),
      action('Approve', 'POST', `/releases/${release.id}/approve`, {
        enabled: release.phase === 'approval' && !hasBlockers,
        reason:
          release.phase === 'approval' && !hasBlockers
            ? undefined
            : 'Release approval requires approval phase with no blockers.',
      }),
      action('Override approve', 'POST', `/releases/${release.id}/override-approve`, {
        enabled: release.phase === 'approval' || release.phase === 'candidate' || hasBlockers,
        reason:
          release.phase === 'approval' || release.phase === 'candidate' || hasBlockers
            ? undefined
            : 'Override approval is only available for approval or blocked candidates.',
      }),
      action('Request changes', 'POST', `/releases/${release.id}/request-changes`, {
        enabled: release.phase === 'approval' || release.phase === 'candidate',
        reason:
          release.phase === 'approval' || release.phase === 'candidate'
            ? undefined
            : 'Release changes can only be requested during candidate or approval.',
      }),
      action('Start observing', 'POST', `/releases/${release.id}/start-observing`, {
        enabled: release.phase === 'rollout',
        reason: release.phase === 'rollout' ? undefined : 'Release must be in rollout before observation can start.',
      }),
      action('Close release', 'POST', `/releases/${release.id}/close`, {
        enabled: release.phase === 'observing' || release.phase === 'completed' || release.phase === 'rollout',
        reason:
          release.phase === 'observing' || release.phase === 'completed' || release.phase === 'rollout'
            ? undefined
            : 'Release can close from rollout, observing, or completed phases.',
      }),
    ],
  };
};

const releaseOwnerQueue = (release: Release, hasBlockers: boolean): string => {
  if (hasBlockers) {
    return 'blocked';
  }
  if (release.phase === 'approval') {
    return 'approval';
  }
  if (release.phase === 'rollout') {
    return 'rollout';
  }
  if (release.phase === 'observing') {
    return 'observing';
  }
  if (release.phase === 'completed' || release.phase === 'closed') {
    return 'closed';
  }
  return 'candidate';
};

export async function getManagerHealthWorkbench(
  repository: DeliveryRepository,
  filters: RoleWorkbenchFilters,
): Promise<RoleWorkbenchResponse> {
  const workItems = await listVisibleWorkItems(repository, filters);
  const packages = (await listVisiblePackages(repository, filters)).map(({ executionPackage }) => executionPackage);
  const releases = (await listReleases(repository, filters))
    .filter((release) => filters.actor_id === undefined || release.release_owner_actor_id === filters.actor_id)
    .filter((release) => filters.phase === undefined || release.phase === filters.phase)
    .filter((release) => matchesStatus(filters.status, release as unknown as Record<string, unknown>));
  if (workItems.length === 0 && packages.length === 0 && releases.length === 0) {
    return response('manager-health', [], filters);
  }
  const reviewPackets = (
    await Promise.all(packages.map((executionPackage) => repository.listReviewPacketsForPackage(executionPackage.id)))
  )
    .flat()
    .filter((packet) => isOpenReviewPacketStatus(packet.status));
  const latestRuns = (
    await Promise.all(packages.map((executionPackage) => latestRunSessionForPackage(repository, executionPackage)))
  ).flatMap((runSession) => (runSession === undefined ? [] : [runSession]));
  const cockpitRows = await Promise.all(releases.map(async (release) => ({ release, cockpit: await getReleaseCockpit(repository, release.id) })));
  const qualityGapPackages = await Promise.all(
    packages.map(async (executionPackage) => {
      const latestRun = await latestRunSessionForPackage(repository, executionPackage);
      const checkSummary = requiredCheckSummary(executionPackage, latestRun);
      const artifactSummary = requiredArtifactSummary(executionPackage, latestRun);
      return {
        executionPackage,
        checkSummary,
        artifactSummary,
        hasGap:
          (checkSummary?.missing ?? 0) > 0 ||
          (checkSummary?.failed ?? 0) > 0 ||
          (artifactSummary?.missing.length ?? 0) > 0,
      };
    }),
  );
  const managerPath = managerWorkbenchPath(filters);
  const aggregateAction = [action('Open manager health', 'GET', managerPath)];
  const items: RoleWorkbenchItem[] = [
    {
      id: 'stage_counts',
      queue: 'manager_health',
      object: { type: 'manager_health_group', id: 'stage_counts' },
      stage_counts: {
        work_items_by_phase: countRecordsBy(workItems, (workItem) => workItem.phase),
        packages_by_phase: countRecordsBy(packages, (executionPackage) => executionPackage.phase),
        releases_by_phase: countRecordsBy(releases, (release) => release.phase),
      },
      drilldown: {
        work_items: workItems.map((workItem) => ({ type: 'work_item', id: workItem.id })),
        execution_packages: packages.map((executionPackage) => ({ type: 'execution_package', id: executionPackage.id })),
        releases: releases.map((release) => ({ type: 'release', id: release.id })),
      },
      actions: aggregateAction,
    },
    {
      id: 'blocker_groups',
      queue: 'manager_health',
      object: { type: 'manager_health_group', id: 'blocker_groups' },
      blocker_groups: {
        work_item_gate_states: countRecordsBy(
          workItems.filter((workItem) => workItem.gate_state !== 'none'),
          (workItem) => workItem.gate_state,
        ),
        package_gate_states: countRecordsBy(
          packages.filter((executionPackage) => executionPackage.gate_state !== 'not_submitted'),
          (executionPackage) => executionPackage.gate_state,
        ),
        release_blockers_by_category: cockpitRows.reduce<Record<string, number>>((counts, row) => {
          for (const blocker of row.cockpit?.blockers ?? []) {
            counts[blocker.category] = (counts[blocker.category] ?? 0) + 1;
          }
          return counts;
        }, {}),
      },
      drilldown: {
        blocked_work_items: workItems
          .filter((workItem) => workItem.gate_state !== 'none')
          .map((workItem) => ({ type: 'work_item', id: workItem.id })),
        blocked_packages: packages
          .filter((executionPackage) => executionPackage.gate_state !== 'not_submitted')
          .map((executionPackage) => ({ type: 'execution_package', id: executionPackage.id })),
        blocked_releases: cockpitRows
          .filter((row) => (row.cockpit?.blockers.length ?? 0) > 0)
          .map((row) => ({ type: 'release', id: row.release.id })),
      },
      actions: aggregateAction,
    },
    {
      id: 'review_backlog',
      queue: 'manager_health',
      object: { type: 'manager_health_group', id: 'review_backlog' },
      review_backlog: {
        open: reviewPackets.length,
        by_status: countRecordsBy(reviewPackets, (packet) => packet.status),
        requested_changes: reviewPackets.reduce((count, packet) => count + packet.requested_changes.length, 0),
      },
      drilldown: {
        review_packets: reviewPackets.map((packet) => ({ type: 'review_packet', id: packet.id })),
      },
      actions: aggregateAction,
    },
    {
      id: 'run_failure_distribution',
      queue: 'manager_health',
      object: { type: 'manager_health_group', id: 'run_failure_distribution' },
      run_failure_distribution: {
        by_status: countRecordsBy(latestRuns, (runSession) => runSession.status),
        by_failure_kind: countRecordsBy(
          latestRuns.filter((runSession) => hasText(runSession.failure_kind)),
          (runSession) => runSession.failure_kind ?? 'unknown',
        ),
      },
      drilldown: {
        failed_runs: latestRuns
          .filter((runSession) => runSession.status === 'failed' || runSession.status === 'timed_out' || runSession.status === 'cancelled')
          .map((runSession) => ({ type: 'run_session', id: runSession.id })),
      },
      actions: aggregateAction,
    },
    {
      id: 'release_readiness_distribution',
      queue: 'manager_health',
      object: { type: 'manager_health_group', id: 'release_readiness_distribution' },
      release_readiness_distribution: {
        by_phase: countRecordsBy(releases, (release) => release.phase),
        by_gate_state: countRecordsBy(releases, (release) => release.gate_state),
        blocker_count: cockpitRows.reduce((count, row) => count + (row.cockpit?.blockers.length ?? 0), 0),
      },
      drilldown: {
        releases: releases.map((release) => ({ type: 'release', id: release.id })),
      },
      actions: aggregateAction,
    },
    {
      id: 'quality_gaps',
      queue: 'manager_health',
      object: { type: 'manager_health_group', id: 'quality_gaps' },
      quality_gaps: {
        packages_with_gaps: qualityGapPackages.filter((row) => row.hasGap).length,
        missing_required_checks: qualityGapPackages.reduce((count, row) => count + (row.checkSummary?.missing ?? 0), 0),
        failed_required_checks: qualityGapPackages.reduce((count, row) => count + (row.checkSummary?.failed ?? 0), 0),
        missing_required_artifacts: qualityGapPackages.reduce(
          (count, row) => count + (row.artifactSummary?.missing.length ?? 0),
          0,
        ),
      },
      drilldown: {
        execution_packages: qualityGapPackages
          .filter((row) => row.hasGap)
          .map((row) => ({ type: 'execution_package', id: row.executionPackage.id })),
      },
      actions: aggregateAction,
    },
  ];

  const result = response('manager-health', items, filters);
  result.summary = {
    ...result.summary,
    aggregate_only: true,
    work_item_count: workItems.length,
    execution_package_count: packages.length,
    release_count: releases.length,
  };
  return result;
}

const managerWorkbenchPath = (filters: RoleWorkbenchFilters): string => {
  const query = new URLSearchParams();
  for (const key of ['project_id', 'actor_id', 'kind', 'phase', 'status', 'risk'] as const) {
    const value = filters[key];
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const queryString = query.toString();
  return `/query/workbenches/manager-health${queryString.length === 0 ? '' : `?${queryString}`}`;
};

const countRecordsBy = <T>(items: readonly T[], selector: (item: T) => string): Record<string, number> =>
  items.reduce<Record<string, number>>((counts, item) => {
    const value = selector(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
