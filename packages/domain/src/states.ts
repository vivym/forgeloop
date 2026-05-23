import {
  DomainError,
  type ExecutionPackage,
  type Release,
  type ReleaseBlocker,
  type ReleaseBlockerSnapshot,
  type ReleaseDecisionIntent,
  type ReviewPacket,
  type RunSession,
  type SpecPlan,
  type SpecPlanEntityType,
  type WorkItem,
} from './types.js';
import type {
  ArtifactKind,
  ArtifactRef,
  ChangedFile,
  CheckResult,
  ExecutorResult,
  FailureKind,
  RequestedChange,
  RequiredCheckSpec,
  RunSpec,
  SelfReviewResult,
  WorkItemIntakeContext,
} from '@forgeloop/contracts';
import type { WorkItemCompletion } from './completion.js';
import {
  createReleaseBlockerSnapshot,
  deriveReleaseBlockers,
  isCompletedCloseObservationEvidence,
  isReleaseBlockerOverrideable,
  isReleaseBlockerSnapshotInternallyConsistent,
  type ReleaseGateContext,
} from './release-gates.js';

const DEFAULT_TIMESTAMP = '2026-05-05T00:00:00.000Z';

type Timestamped = {
  at?: string;
};

type RunRuntimeMetadataUpdate = Partial<NonNullable<RunSession['runtime_metadata']>>;

export type WorkItemTransition =
  | (Timestamped & {
      type: 'create';
      id: string;
      project_id: string;
      kind: WorkItem['kind'];
      title: string;
      goal: string;
      success_criteria: string[];
      priority: string;
      risk: string;
      driver_actor_id: string;
      intake_context: WorkItemIntakeContext;
      current_spec_id?: string;
      current_plan_id?: string;
    })
  | (Timestamped & {
      type:
        | 'submit_spec'
        | 'approve_spec'
        | 'request_spec_changes'
        | 'resubmit_spec'
        | 'submit_plan'
        | 'approve_plan'
        | 'request_plan_changes'
        | 'resubmit_plan'
    })
  | (Timestamped & {
      type: 'complete_execution';
      completion: WorkItemCompletion;
    });

export type SpecPlanTransition =
  | (Timestamped & {
      type: 'create';
      entity_type: SpecPlanEntityType;
      id: string;
      work_item_id: string;
    })
  | (Timestamped & {
      type:
        | 'generate_draft_start'
        | 'generate_draft_success'
        | 'generate_draft_failure'
        | 'submit_for_approval'
        | 'approve'
        | 'request_changes';
    });

export type ExecutionPackageTransition =
  | (Timestamped & {
      type: 'generate_package';
      id: string;
      work_item_id: string;
      spec_id: string;
      spec_revision_id: string;
      plan_id: string;
      plan_revision_id: string;
      project_id: string;
      repo_id: string;
      objective: string;
      owner_actor_id: string;
      reviewer_actor_id: string;
      qa_owner_actor_id: string;
      required_checks: RequiredCheckSpec[];
      required_artifact_kinds: ArtifactKind[];
      allowed_paths: string[];
      forbidden_paths: string[];
      source_mutation_policy?: ExecutionPackage['source_mutation_policy'];
    })
  | (Timestamped & {
      type: 'mark_ready' | 'workflow_start' | 'execution_succeeded' | 'review_approved' | 'review_changes_requested';
    })
  | (Timestamped & {
      type: 'run' | 'rerun';
      run_session_id: string;
    })
  | (Timestamped & {
      type: 'force_rerun';
      run_session_id: string;
      has_open_review_packet: boolean;
    })
  | (Timestamped & {
      type: 'execution_failed_retryable' | 'execution_failed_blocking_check';
      failure_summary: string;
    })
  | (Timestamped & {
      type: 'execution_failed_blocked';
      blocked_reason: string;
    });

type RunSessionTerminalExecutorResultTransition = Timestamped & {
  type: 'executor_success' | 'executor_failure' | 'executor_timeout';
  executor_result: ExecutorResult;
};

type RunSessionTerminalLegacyTransition =
  | (Timestamped & {
      type: 'executor_success';
      executor_result?: undefined;
      changed_files: ChangedFile[];
      check_results: CheckResult[];
      artifacts: ArtifactRef[];
      log_refs: ArtifactRef[];
      summary: string;
    })
  | (Timestamped & {
      type: 'executor_failure' | 'executor_timeout';
      executor_result?: undefined;
      changed_files: ChangedFile[];
      check_results: CheckResult[];
      artifacts: ArtifactRef[];
      log_refs: ArtifactRef[];
      summary: string;
      failure_kind: FailureKind;
      failure_reason: string;
    });

export type RunSessionTransition =
  | (Timestamped & {
      type: 'create';
      id: string;
      execution_package_id: string;
      requested_by_actor_id: string;
      executor_type?: RunSession['executor_type'];
      run_spec?: RunSpec;
      changed_files?: ChangedFile[];
      log_refs?: ArtifactRef[];
      summary?: string;
      failure_kind?: FailureKind;
      failure_reason?: string;
    })
  | (Timestamped & {
      type: 'workflow_start' | 'resume_requested' | 'cancel_requested' | 'cancel';
    })
  | (Timestamped & {
      type: 'worker_started';
      runtime_metadata?: RunRuntimeMetadataUpdate;
    })
  | (Timestamped & {
      type: 'waiting_for_input' | 'stalled';
      reason: string;
    })
  | (Timestamped & {
      type: 'recovered';
      runtime_metadata?: RunRuntimeMetadataUpdate;
    })
  | RunSessionTerminalExecutorResultTransition
  | RunSessionTerminalLegacyTransition;

export type ReviewPacketTransition =
  | (Timestamped & {
      type: 'create';
      id: string;
      run_session_id: string;
      execution_package_id: string;
      reviewer_actor_id: string;
      spec_revision_id: string;
      plan_revision_id: string;
      changed_files: ChangedFile[];
      check_result_summary: string;
      self_review: SelfReviewResult;
      risk_notes: string[];
    })
  | (Timestamped & {
      type: 'start_review' | 'archive_for_newer_run';
    })
  | (Timestamped & {
      type: 'approve';
      summary: string;
      reviewed_by_actor_id: string;
      reviewed_at: string;
    })
  | (Timestamped & {
      type: 'request_changes';
      summary: string;
      reviewed_by_actor_id: string;
      reviewed_at: string;
      requested_changes: RequestedChange[];
    });

export type ReleaseTransition =
  | (Timestamped & {
      type: 'create';
      id: string;
      org_id: string;
      project_id: string;
      title: string;
      scope_summary?: string;
      release_owner_actor_id?: string;
      release_type?: string;
      created_by_actor_id: string;
      updated_by_actor_id?: string;
    })
  | (Timestamped & {
      type: 'patch';
      actor_id: string;
      title?: string;
      description?: string;
      scope_summary?: string;
      rollout_strategy?: string;
      rollback_plan?: string;
      observation_plan?: string;
      release_owner_actor_id?: string;
      release_type?: string;
    })
  | (Timestamped & {
      type: 'link_work_item';
      work_item_id: string;
      actor_id?: string;
    })
  | (Timestamped & {
      type: 'link_execution_package';
      execution_package_id: string;
      actor_id?: string;
    })
  | (Timestamped & {
      type: 'unlink_work_item';
      work_item_id: string;
      actor_id?: string;
    })
  | (Timestamped & {
      type: 'unlink_execution_package';
      execution_package_id: string;
      actor_id?: string;
    })
  | (Timestamped & {
      type: 'submit';
      gate_context: ReleaseGateContext;
      actor_id?: string;
    })
  | (Timestamped & {
      type: 'approve';
      approved_by_actor_id: string;
      gate_context: ReleaseGateContext;
    })
  | (Timestamped & {
      type: 'override_approve';
      approved_by_actor_id: string;
      rationale: string;
      blocker_snapshot: ReleaseBlockerSnapshot;
      gate_context: ReleaseGateContext;
    })
  | (Timestamped & {
      type: 'request_changes';
      actor_id: string;
      rationale: string;
    })
  | (Timestamped & {
      type: 'start_observing';
      actor_id?: string;
    })
  | (Timestamped & {
      type: 'close';
      resolution: 'completed';
      gate_context: ReleaseGateContext;
      actor_id?: string;
    })
  | (Timestamped & {
      type: 'close';
      resolution: 'rolled_back' | 'cancelled';
      actor_id?: string;
    })
  | (Timestamped & {
      type: 'close_override';
      resolution: 'completed' | 'rolled_back' | 'cancelled';
      actor_id: string;
      rationale: string;
      blocker_snapshot: ReleaseBlockerSnapshot;
      gate_context: ReleaseGateContext;
    });

export interface ReleaseTransitionResult {
  release: Release;
  decision_intents: ReleaseDecisionIntent[];
  blocker_snapshot?: ReleaseBlockerSnapshot;
}

const timestampFor = (event: Timestamped) => event.at ?? DEFAULT_TIMESTAMP;

const invalidTransition = (objectType: string, current: string, transition: string): never => {
  throw new DomainError('INVALID_TRANSITION', `Cannot apply ${transition} to ${objectType} in ${current}`);
};

const hasText = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0;

const cloneArtifactRef = (artifact: ArtifactRef): ArtifactRef => ({ ...artifact });

const cloneChangedFile = (changedFile: ChangedFile): ChangedFile => ({ ...changedFile });

const cloneCheckResult = (check: CheckResult): CheckResult => ({
  ...check,
  ...(check.stdout !== undefined ? { stdout: cloneArtifactRef(check.stdout) } : {}),
  ...(check.stderr !== undefined ? { stderr: cloneArtifactRef(check.stderr) } : {}),
});

const cloneJsonObject = <T extends Record<string, unknown>>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneExecutorResult = (result: ExecutorResult): ExecutorResult => ({
  ...result,
  changed_files: result.changed_files.map(cloneChangedFile),
  checks: result.checks.map(cloneCheckResult),
  artifacts: result.artifacts.map(cloneArtifactRef),
  ...(result.failure !== undefined ? { failure: { ...result.failure } } : {}),
  raw_metadata: cloneJsonObject(result.raw_metadata),
});

const cloneRequiredCheckSpec = (check: RequiredCheckSpec): RequiredCheckSpec => ({ ...check });

const cloneRequestedChange = (change: RequestedChange): RequestedChange => ({ ...change });

const cloneSelfReviewResult = (selfReview: SelfReviewResult): SelfReviewResult => ({
  ...selfReview,
  risk_notes: [...selfReview.risk_notes],
  follow_up_questions: [...selfReview.follow_up_questions],
});

const cloneRunSpec = (runSpec: RunSpec): RunSpec => ({
  ...runSpec,
  repo: { ...runSpec.repo },
  context: {
    ...runSpec.context,
    required_checks: runSpec.context.required_checks.map(cloneRequiredCheckSpec),
  },
  review_context: {
    ...runSpec.review_context,
    requested_changes: (runSpec.review_context.requested_changes ?? []).map(cloneRequestedChange),
  },
  source_mutation_policy: runSpec.source_mutation_policy ?? 'path_policy_scoped',
  allowed_paths: [...runSpec.allowed_paths],
  forbidden_paths: [...runSpec.forbidden_paths],
  required_checks: runSpec.required_checks.map(cloneRequiredCheckSpec),
  artifact_policy: {
    requested_artifacts: [...runSpec.artifact_policy.requested_artifacts],
  },
});

const expectedExecutorResultStatusByTransition: Record<
  RunSessionTerminalExecutorResultTransition['type'],
  ExecutorResult['status']
> = {
  executor_success: 'succeeded',
  executor_failure: 'failed',
  executor_timeout: 'timed_out',
};

const cloneRunSessionTerminalEvidence = (
  runSessionId: string,
  event: Extract<RunSessionTransition, { type: 'executor_success' | 'executor_failure' | 'executor_timeout' }>,
): Pick<RunSession, 'changed_files' | 'check_results' | 'artifacts' | 'summary'> &
  Partial<Pick<RunSession, 'executor_result' | 'executor_type' | 'failure_kind' | 'failure_reason' | 'log_refs'>> => {
  if (event.executor_result !== undefined) {
    const expectedStatus = expectedExecutorResultStatusByTransition[event.type];
    if (event.executor_result.status !== expectedStatus) {
      return invalidTransition('RunSession', `executor_result/${event.executor_result.status}`, event.type);
    }
    if (event.executor_result.run_session_id !== runSessionId) {
      return invalidTransition('RunSession', `executor_result/${event.executor_result.run_session_id}`, event.type);
    }

    const executorResult = cloneExecutorResult(event.executor_result);
    return {
      executor_result: executorResult,
      executor_type: executorResult.executor_type,
      changed_files: executorResult.changed_files.map(cloneChangedFile),
      check_results: executorResult.checks.map(cloneCheckResult),
      artifacts: executorResult.artifacts.map(cloneArtifactRef),
      summary: executorResult.summary,
      ...(executorResult.failure !== undefined
        ? {
            failure_kind: executorResult.failure.kind,
            failure_reason: executorResult.failure.message,
          }
        : {}),
    };
  }

  if (
    event.changed_files === undefined ||
    event.check_results === undefined ||
    event.artifacts === undefined ||
    event.log_refs === undefined ||
    event.summary === undefined
  ) {
    return invalidTransition('RunSession', 'invalid_terminal_payload', event.type);
  }

  return {
    changed_files: event.changed_files.map(cloneChangedFile),
    check_results: event.check_results.map(cloneCheckResult),
    artifacts: event.artifacts.map(cloneArtifactRef),
    log_refs: event.log_refs.map(cloneArtifactRef),
    summary: event.summary,
  };
};

const assertReviewDecision = (
  event: Extract<ReviewPacketTransition, { type: 'approve' | 'request_changes' }>,
): void => {
  if (!hasText(event.summary) || !hasText(event.reviewed_by_actor_id) || !hasText(event.reviewed_at)) {
    return invalidTransition('ReviewPacket', 'invalid_decision_payload', event.type);
  }

  if (
    event.type === 'request_changes' &&
    (!Array.isArray(event.requested_changes) || event.requested_changes.length === 0)
  ) {
    return invalidTransition('ReviewPacket', 'invalid_decision_payload', event.type);
  }

  if (event.type === 'request_changes') {
    for (const change of event.requested_changes) {
      if (
        !hasText(change.title) ||
        !hasText(change.description) ||
        (change.file_path !== undefined && !hasText(change.file_path)) ||
        (change.suggested_validation !== undefined && !hasText(change.suggested_validation))
      ) {
        return invalidTransition('ReviewPacket', 'invalid_decision_payload', event.type);
      }
    }
  }
};

const assertWorkItemCompletion = (workItem: WorkItem, completion: WorkItemCompletion | undefined): void => {
  if (completion?.done !== true || completion.resolution !== 'completed') {
    throw new DomainError('COMPLETION_BLOCKED', `Work item ${workItem.id} cannot be completed yet`, {
      work_item_id: workItem.id,
      incomplete_reasons: completion?.incomplete_reasons ?? ['completion evidence is required'],
    });
  }
};

const isNonTerminalRunSessionStatus = (status: RunSession['status']): boolean =>
  status === 'queued' ||
  status === 'running' ||
  status === 'waiting_for_input' ||
  status === 'stalled' ||
  status === 'resuming' ||
  status === 'cancel_requested';

const defaultRunRuntimeMetadata = (): NonNullable<RunSession['runtime_metadata']> => ({
  durability_mode: 'durable',
  recovery_attempt_count: 0,
  effective_dangerous_mode: 'not_requested',
});

const mergeRunRuntimeMetadata = (
  existing: RunSession['runtime_metadata'],
  updates: RunRuntimeMetadataUpdate,
): NonNullable<RunSession['runtime_metadata']> => ({
  ...(existing ?? defaultRunRuntimeMetadata()),
  ...updates,
});

export const transitionWorkItem = (workItem: WorkItem | undefined, event: WorkItemTransition): WorkItem => {
  const at = timestampFor(event);

  if (workItem === undefined) {
    if (event.type !== 'create') {
      return invalidTransition('WorkItem', 'none', event.type);
    }

    if (event.kind !== event.intake_context.type) {
      return invalidTransition('WorkItem', `kind/${event.kind}`, `create/${event.intake_context.type}`);
    }

    return {
      id: event.id,
      project_id: event.project_id,
      kind: event.kind,
      title: event.title,
      narrative_markdown: '',
      goal: event.goal,
      success_criteria: [...event.success_criteria],
      priority: event.priority,
      risk: event.risk,
      driver_actor_id: event.driver_actor_id,
      intake_context: cloneJsonObject(event.intake_context),
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'none',
      resolution: 'none',
      ...(event.current_spec_id !== undefined ? { current_spec_id: event.current_spec_id } : {}),
      ...(event.current_plan_id !== undefined ? { current_plan_id: event.current_plan_id } : {}),
      created_at: at,
      updated_at: at,
    };
  }

  if (event.type === 'create') {
    return invalidTransition('WorkItem', workItem.phase, event.type);
  }

  switch (event.type) {
    case 'submit_spec':
      if (workItem.phase === 'draft' || workItem.phase === 'triage') {
        return {
          ...workItem,
          phase: 'spec',
          gate_state: 'awaiting_spec_approval',
          resolution: 'none',
          updated_at: at,
        };
      }
      break;
    case 'approve_spec':
      if (workItem.phase === 'spec') {
        return { ...workItem, phase: 'plan', gate_state: 'none', updated_at: at };
      }
      break;
    case 'request_spec_changes':
      if (workItem.phase === 'spec') {
        return { ...workItem, gate_state: 'spec_changes_requested', updated_at: at };
      }
      break;
    case 'resubmit_spec':
      if (workItem.phase === 'spec' && workItem.gate_state === 'spec_changes_requested') {
        return { ...workItem, gate_state: 'awaiting_spec_approval', updated_at: at };
      }
      break;
    case 'submit_plan':
      if (workItem.phase === 'plan') {
        return { ...workItem, gate_state: 'awaiting_plan_approval', updated_at: at };
      }
      break;
    case 'approve_plan':
      if (workItem.phase === 'plan') {
        return { ...workItem, phase: 'execution', gate_state: 'none', updated_at: at };
      }
      break;
    case 'request_plan_changes':
      if (workItem.phase === 'plan') {
        return { ...workItem, gate_state: 'plan_changes_requested', updated_at: at };
      }
      break;
    case 'resubmit_plan':
      if (workItem.phase === 'plan' && workItem.gate_state === 'plan_changes_requested') {
        return { ...workItem, gate_state: 'awaiting_plan_approval', updated_at: at };
      }
      break;
    case 'complete_execution':
      if (workItem.phase === 'execution') {
        assertWorkItemCompletion(workItem, event.completion);
        return { ...workItem, phase: 'done', resolution: 'completed', gate_state: 'none', updated_at: at };
      }
      break;
  }

  return invalidTransition('WorkItem', `${workItem.phase}/${workItem.gate_state}`, event.type);
};

export const transitionSpecPlan = (entity: SpecPlan | undefined, event: SpecPlanTransition): SpecPlan => {
  const at = timestampFor(event);

  if (entity === undefined) {
    if (event.type !== 'create') {
      return invalidTransition('SpecPlan', 'none', event.type);
    }

    return {
      id: event.id,
      work_item_id: event.work_item_id,
      entity_type: event.entity_type,
      status: 'draft',
      editing_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      created_at: at,
      updated_at: at,
    } as SpecPlan;
  }

  if (event.type === 'create') {
    return invalidTransition('SpecPlan', entity.status, event.type);
  }

  switch (event.type) {
    case 'generate_draft_start':
      if (entity.status === 'draft') {
        return { ...entity, editing_state: 'ai_drafting', updated_at: at };
      }
      break;
    case 'generate_draft_success':
    case 'generate_draft_failure':
      if (entity.editing_state === 'ai_drafting') {
        return { ...entity, editing_state: 'idle', updated_at: at };
      }
      break;
    case 'submit_for_approval':
      if (entity.status === 'draft') {
        return {
          ...entity,
          status: 'in_review',
          editing_state: 'idle',
          gate_state: 'awaiting_approval',
          resolution: 'none',
          updated_at: at,
        };
      }
      break;
    case 'approve':
      if (entity.status === 'in_review') {
        return {
          ...entity,
          status: 'approved',
          editing_state: 'idle',
          gate_state: 'approved',
          resolution: 'approved',
          updated_at: at,
        };
      }
      break;
    case 'request_changes':
      if (entity.status === 'in_review') {
        return {
          ...entity,
          status: 'draft',
          editing_state: 'idle',
          gate_state: 'changes_requested',
          resolution: 'none',
          updated_at: at,
        };
      }
      break;
  }

  return invalidTransition('SpecPlan', `${entity.status}/${entity.editing_state}/${entity.gate_state}`, event.type);
};

export const transitionExecutionPackage = (
  executionPackage: ExecutionPackage | undefined,
  event: ExecutionPackageTransition,
): ExecutionPackage => {
  const at = timestampFor(event);

  if (executionPackage === undefined) {
    if (event.type !== 'generate_package') {
      return invalidTransition('ExecutionPackage', 'none', event.type);
    }

    return {
      id: event.id,
      work_item_id: event.work_item_id,
      spec_id: event.spec_id,
      spec_revision_id: event.spec_revision_id,
      plan_id: event.plan_id,
      plan_revision_id: event.plan_revision_id,
      project_id: event.project_id,
      repo_id: event.repo_id,
      objective: event.objective,
      owner_actor_id: event.owner_actor_id,
      reviewer_actor_id: event.reviewer_actor_id,
      qa_owner_actor_id: event.qa_owner_actor_id,
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      required_checks: event.required_checks.map((check) => ({ ...check })),
      required_artifact_kinds: [...event.required_artifact_kinds],
      allowed_paths: [...event.allowed_paths],
      forbidden_paths: [...event.forbidden_paths],
      source_mutation_policy: event.source_mutation_policy ?? 'path_policy_scoped',
      version: 0,
      created_at: at,
      updated_at: at,
    };
  }

  if (event.type === 'generate_package') {
    return invalidTransition('ExecutionPackage', executionPackage.phase, event.type);
  }

  const isRunningExecution = executionPackage.phase === 'execution' && executionPackage.activity_state === 'ai_running';
  const isAwaitingHumanReview =
    executionPackage.phase === 'review' &&
    executionPackage.activity_state === 'awaiting_human' &&
    executionPackage.gate_state === 'awaiting_human_review' &&
    executionPackage.resolution === 'none';
  const advance = (patch: Partial<ExecutionPackage>): ExecutionPackage => ({
    ...executionPackage,
    ...patch,
    version: executionPackage.version + 1,
    updated_at: at,
  });

  switch (event.type) {
    case 'mark_ready':
      if (executionPackage.phase === 'draft') {
        return advance({ phase: 'ready', gate_state: 'not_submitted' });
      }
      break;
    case 'run':
    case 'rerun':
      if (executionPackage.phase === 'ready') {
        return advance({
          phase: 'queued',
          activity_state: 'idle',
          gate_state: 'not_submitted',
          resolution: 'none',
          last_run_session_id: event.run_session_id,
        });
      }
      break;
    case 'force_rerun':
      if (executionPackage.phase === 'review' && executionPackage.resolution === 'none' && event.has_open_review_packet) {
        return advance({
          phase: 'queued',
          activity_state: 'idle',
          gate_state: 'not_submitted',
          resolution: 'none',
          last_run_session_id: event.run_session_id,
        });
      }
      break;
    case 'workflow_start':
      if (executionPackage.phase === 'queued') {
        return advance({ phase: 'execution', activity_state: 'ai_running' });
      }
      break;
    case 'execution_failed_retryable':
      if (isRunningExecution) {
        return advance({
          phase: 'ready',
          activity_state: 'idle',
          gate_state: 'not_submitted',
          last_failure_summary: event.failure_summary,
        });
      }
      break;
    case 'execution_failed_blocked':
      if (isRunningExecution) {
        return advance({
          activity_state: 'blocked',
          blocked_reason: event.blocked_reason,
        });
      }
      break;
    case 'execution_succeeded':
      if (isRunningExecution) {
        return advance({
          phase: 'review',
          activity_state: 'awaiting_human',
          gate_state: 'awaiting_human_review',
          resolution: 'none',
        });
      }
      break;
    case 'execution_failed_blocking_check':
      if (isRunningExecution) {
        return advance({
          phase: 'ready',
          activity_state: 'idle',
          gate_state: 'not_submitted',
          last_failure_summary: event.failure_summary,
        });
      }
      break;
    case 'review_approved':
      if (isAwaitingHumanReview) {
        return advance({
          phase: 'release',
          activity_state: 'idle',
          gate_state: 'release_ready',
          resolution: 'completed',
        });
      }
      break;
    case 'review_changes_requested':
      if (isAwaitingHumanReview) {
        return advance({
          phase: 'ready',
          activity_state: 'idle',
          gate_state: 'changes_requested',
          resolution: 'none',
        });
      }
      break;
  }

  return invalidTransition(
    'ExecutionPackage',
    `${executionPackage.phase}/${executionPackage.activity_state}/${executionPackage.gate_state}`,
    event.type,
  );
};

const releaseResult = (
  release: Release,
  decisionIntents: ReleaseDecisionIntent[] = [],
  blockerSnapshot?: ReleaseBlockerSnapshot,
): ReleaseTransitionResult => ({
  release,
  decision_intents: decisionIntents,
  ...(blockerSnapshot !== undefined ? { blocker_snapshot: blockerSnapshot } : {}),
});

const hasBlockingReleaseBlockers = (blockers: readonly ReleaseBlocker[]): boolean => blockers.length > 0;

const hasNonOverrideableReleaseBlockers = (blockers: readonly ReleaseBlocker[]): boolean =>
  blockers.some((blocker) => !isReleaseBlockerOverrideable(blocker.code) || !blocker.overrideable);

const canSubmitReleaseForApproval = (blockers: readonly ReleaseBlocker[]): boolean =>
  !hasNonOverrideableReleaseBlockers(blockers);

const candidateOverrideableTestAcceptanceCodes = new Set<ReleaseBlocker['code']>([
  'failed_required_check',
  'missing_required_artifact',
  'missing_required_evidence_backlink',
]);

const canOverrideApproveCandidateRelease = (blockers: readonly ReleaseBlocker[]): boolean =>
  blockers.length > 0 &&
  blockers.every(
    (blocker) =>
      blocker.overrideable &&
      isReleaseBlockerOverrideable(blocker.code) &&
      candidateOverrideableTestAcceptanceCodes.has(blocker.code),
  );

const currentReleaseBlockerSnapshot = (
  release: Release,
  gateContext: ReleaseGateContext,
  generatedAt: string,
): ReleaseBlockerSnapshot =>
  createReleaseBlockerSnapshot({
    release_id: release.id,
    generated_at: generatedAt,
    blockers: deriveReleaseBlockers({ ...gateContext, release }),
  });

const assertRequestSnapshotMatchesCurrent = (
  release: Release,
  requestSnapshot: ReleaseBlockerSnapshot,
  currentSnapshot: ReleaseBlockerSnapshot,
): void => {
  if (
    requestSnapshot.release_id !== release.id ||
    requestSnapshot.release_id !== currentSnapshot.release_id ||
    !hasText(requestSnapshot.generated_at) ||
    !isReleaseBlockerSnapshotInternallyConsistent(requestSnapshot) ||
    requestSnapshot.blocker_fingerprint !== currentSnapshot.blocker_fingerprint
  ) {
    return invalidTransition('Release', `${release.phase}/stale_blocker_snapshot`, 'blocker_snapshot');
  }
};

const actorIdForReleaseDecision = (release: Release, actorId: string | undefined): string =>
  actorId ?? release.updated_by_actor_id ?? release.created_by_actor_id;

const releaseCloseDecisionIntent = (
  release: Release,
  actorId: string | undefined,
  outcome: 'completed' | 'rolled_back' | 'cancelled',
  extras: Pick<ReleaseDecisionIntent, 'reason' | 'blocker_snapshot'> = {},
): ReleaseDecisionIntent => ({
  object_type: 'release',
  object_id: release.id,
  actor_id: actorIdForReleaseDecision(release, actorId),
  decision_type: 'release_close',
  outcome,
  ...extras,
});

export const transitionRelease = (
  release: Release | undefined,
  event: ReleaseTransition,
): ReleaseTransitionResult => {
  const at = timestampFor(event);

  if (release === undefined) {
    if (event.type !== 'create') {
      return invalidTransition('Release', 'none', event.type);
    }

    return releaseResult({
      id: event.id,
      org_id: event.org_id,
      project_id: event.project_id,
      title: event.title,
      ...(event.scope_summary !== undefined ? { scope_summary: event.scope_summary } : {}),
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      work_item_ids: [],
      execution_package_ids: [],
      release_owner_actor_id: event.release_owner_actor_id ?? event.created_by_actor_id,
      release_type: event.release_type ?? 'normal',
      created_by_actor_id: event.created_by_actor_id,
      created_at: at,
      updated_at: at,
      updated_by_actor_id: event.updated_by_actor_id ?? event.created_by_actor_id,
    });
  }

  if (event.type === 'create') {
    return invalidTransition('Release', release.phase, event.type);
  }

  switch (event.type) {
    case 'patch': {
      if (release.phase === 'completed' || release.phase === 'closed') {
        break;
      }
      return releaseResult({
        ...release,
        ...(event.title !== undefined ? { title: event.title } : {}),
        ...(event.description !== undefined ? { description: event.description } : {}),
        ...(event.scope_summary !== undefined ? { scope_summary: event.scope_summary } : {}),
        ...(event.rollout_strategy !== undefined ? { rollout_strategy: event.rollout_strategy } : {}),
        ...(event.rollback_plan !== undefined ? { rollback_plan: event.rollback_plan } : {}),
        ...(event.observation_plan !== undefined ? { observation_plan: event.observation_plan } : {}),
        ...(event.release_owner_actor_id !== undefined ? { release_owner_actor_id: event.release_owner_actor_id } : {}),
        ...(event.release_type !== undefined ? { release_type: event.release_type } : {}),
        updated_at: at,
        updated_by_actor_id: event.actor_id,
      });
    }
    case 'link_work_item': {
      if (release.phase !== 'draft' && release.phase !== 'candidate') {
        break;
      }
      const workItemIds = release.work_item_ids.includes(event.work_item_id)
        ? release.work_item_ids
        : [...release.work_item_ids, event.work_item_id];
      return releaseResult({
        ...release,
        phase: 'candidate',
        activity_state: 'idle',
        gate_state: 'not_submitted',
        resolution: 'none',
        work_item_ids: workItemIds,
        updated_at: at,
        ...(event.actor_id !== undefined ? { updated_by_actor_id: event.actor_id } : {}),
      });
    }
    case 'link_execution_package': {
      if (release.phase !== 'draft' && release.phase !== 'candidate') {
        break;
      }
      const executionPackageIds = release.execution_package_ids.includes(event.execution_package_id)
        ? release.execution_package_ids
        : [...release.execution_package_ids, event.execution_package_id];
      return releaseResult({
        ...release,
        phase: 'candidate',
        activity_state: 'idle',
        gate_state: 'not_submitted',
        resolution: 'none',
        execution_package_ids: executionPackageIds,
        updated_at: at,
        ...(event.actor_id !== undefined ? { updated_by_actor_id: event.actor_id } : {}),
      });
    }
    case 'unlink_work_item': {
      if (release.phase !== 'draft' && release.phase !== 'candidate') {
        break;
      }
      const workItemIds = release.work_item_ids.filter((id) => id !== event.work_item_id);
      return releaseResult({
        ...release,
        phase: workItemIds.length > 0 || release.execution_package_ids.length > 0 ? 'candidate' : 'draft',
        activity_state: 'idle',
        gate_state: 'not_submitted',
        resolution: 'none',
        work_item_ids: workItemIds,
        updated_at: at,
        ...(event.actor_id !== undefined ? { updated_by_actor_id: event.actor_id } : {}),
      });
    }
    case 'unlink_execution_package': {
      if (release.phase !== 'draft' && release.phase !== 'candidate') {
        break;
      }
      const executionPackageIds = release.execution_package_ids.filter((id) => id !== event.execution_package_id);
      return releaseResult({
        ...release,
        phase: release.work_item_ids.length > 0 || executionPackageIds.length > 0 ? 'candidate' : 'draft',
        activity_state: 'idle',
        gate_state: 'not_submitted',
        resolution: 'none',
        execution_package_ids: executionPackageIds,
        updated_at: at,
        ...(event.actor_id !== undefined ? { updated_by_actor_id: event.actor_id } : {}),
      });
    }
    case 'submit':
      if (release.phase === 'candidate' || (release.phase === 'approval' && release.gate_state === 'changes_requested')) {
        const snapshot = currentReleaseBlockerSnapshot(release, event.gate_context, at);
        if (canSubmitReleaseForApproval(snapshot.blockers)) {
          return releaseResult(
            {
              ...release,
              phase: 'approval',
              activity_state: 'awaiting_human',
              gate_state: 'awaiting_approval',
              resolution: 'none',
              updated_at: at,
              ...(event.actor_id !== undefined ? { updated_by_actor_id: event.actor_id } : {}),
            },
            [],
            snapshot,
          );
        }
      }
      break;
    case 'approve':
      if (release.phase === 'approval' && release.gate_state === 'awaiting_approval') {
        const snapshot = currentReleaseBlockerSnapshot(release, event.gate_context, at);
        if (!hasBlockingReleaseBlockers(snapshot.blockers)) {
          return releaseResult(
            {
              ...release,
              phase: 'rollout',
              activity_state: 'idle',
              gate_state: 'approved',
              resolution: 'none',
              updated_at: at,
              updated_by_actor_id: event.approved_by_actor_id,
            },
            [
              {
                object_type: 'release',
                object_id: release.id,
                actor_id: event.approved_by_actor_id,
                decision_type: 'release_approval',
                outcome: 'approved',
              },
            ],
            snapshot,
          );
        }
      }
      break;
    case 'override_approve':
      if (
        (release.phase === 'approval' && release.gate_state === 'awaiting_approval') ||
        (release.phase === 'candidate' && release.gate_state === 'not_submitted')
      ) {
        const snapshot = currentReleaseBlockerSnapshot(release, event.gate_context, at);
        assertRequestSnapshotMatchesCurrent(release, event.blocker_snapshot, snapshot);
        const candidateOverride =
          release.phase === 'candidate' && release.gate_state === 'not_submitted'
            ? canOverrideApproveCandidateRelease(snapshot.blockers)
            : true;
        if (
          !hasText(event.rationale) ||
          snapshot.blockers.length === 0 ||
          hasNonOverrideableReleaseBlockers(snapshot.blockers) ||
          !candidateOverride
        ) {
          break;
        }
        const intentBase = {
          object_type: 'release' as const,
          object_id: release.id,
          actor_id: event.approved_by_actor_id,
          outcome: 'override_approved' as const,
          reason: event.rationale,
          blocker_snapshot: snapshot,
        };
        return releaseResult(
          {
            ...release,
            phase: 'rollout',
            activity_state: 'idle',
            gate_state: 'approved',
            resolution: 'none',
            updated_at: at,
            updated_by_actor_id: event.approved_by_actor_id,
          },
          [
            {
              ...intentBase,
              decision_type: 'manual_override',
            },
            {
              ...intentBase,
              decision_type: 'release_approval',
            },
          ],
          snapshot,
        );
      }
      break;
    case 'request_changes':
      if (release.phase === 'approval' && release.gate_state === 'awaiting_approval' && hasText(event.rationale)) {
        return releaseResult(
          {
            ...release,
            phase: 'approval',
            activity_state: 'awaiting_human',
            gate_state: 'changes_requested',
            resolution: 'none',
            updated_at: at,
            updated_by_actor_id: event.actor_id,
          },
          [
            {
              object_type: 'release',
              object_id: release.id,
              actor_id: event.actor_id,
              decision_type: 'release_changes_requested',
              outcome: 'changes_requested',
              reason: event.rationale,
            },
          ],
        );
      }
      break;
    case 'start_observing':
      if (release.phase === 'rollout' && release.gate_state === 'approved') {
        return releaseResult({
          ...release,
          phase: 'observing',
          activity_state: 'idle',
          gate_state: 'rollout_succeeded',
          resolution: 'none',
          updated_at: at,
          ...(event.actor_id !== undefined ? { updated_by_actor_id: event.actor_id } : {}),
        });
      }
      break;
    case 'close':
      if (event.resolution === 'completed' && release.phase === 'observing' && release.gate_state === 'rollout_succeeded') {
        const hasObservationEvidence =
          event.gate_context.evidence?.some((item) =>
            isCompletedCloseObservationEvidence(item, { ...event.gate_context, release }),
          ) === true;
        if (hasObservationEvidence) {
          return releaseResult(
            {
              ...release,
              phase: 'completed',
              activity_state: 'idle',
              resolution: 'completed',
              closed_at: at,
              updated_at: at,
              ...(event.actor_id !== undefined ? { updated_by_actor_id: event.actor_id } : {}),
            },
            [releaseCloseDecisionIntent(release, event.actor_id, 'completed')],
          );
        }
      }
      if (
        event.resolution === 'rolled_back' &&
        (release.phase === 'rollout' || release.phase === 'observing')
      ) {
        return releaseResult(
          {
            ...release,
            phase: 'closed',
            activity_state: 'idle',
            gate_state: 'rollout_failed',
            resolution: event.resolution,
            closed_at: at,
            updated_at: at,
            ...(event.actor_id !== undefined ? { updated_by_actor_id: event.actor_id } : {}),
          },
          [releaseCloseDecisionIntent(release, event.actor_id, event.resolution)],
        );
      }
      if (
        event.resolution === 'cancelled' &&
        (release.phase === 'draft' ||
          release.phase === 'candidate' ||
          release.phase === 'approval' ||
          release.phase === 'rollout' ||
          release.phase === 'observing')
      ) {
        return releaseResult(
          {
            ...release,
            phase: 'closed',
            activity_state: 'idle',
            resolution: event.resolution,
            closed_at: at,
            updated_at: at,
            ...(event.actor_id !== undefined ? { updated_by_actor_id: event.actor_id } : {}),
          },
          [releaseCloseDecisionIntent(release, event.actor_id, event.resolution)],
        );
      }
      break;
    case 'close_override':
      if (release.phase === 'observing' && release.gate_state === 'rollout_succeeded' && hasText(event.rationale)) {
        const snapshot = currentReleaseBlockerSnapshot(release, event.gate_context, at);
        assertRequestSnapshotMatchesCurrent(release, event.blocker_snapshot, snapshot);
        if (snapshot.blockers.length === 0 || hasNonOverrideableReleaseBlockers(snapshot.blockers)) {
          break;
        }
        return releaseResult(
          {
            ...release,
            phase: event.resolution === 'completed' ? 'completed' : 'closed',
            activity_state: 'idle',
            gate_state: event.resolution === 'rolled_back' ? 'rollout_failed' : release.gate_state,
            resolution: event.resolution,
            closed_at: at,
            updated_at: at,
            updated_by_actor_id: event.actor_id,
          },
          [
            {
              object_type: 'release',
              object_id: release.id,
              actor_id: event.actor_id,
              decision_type: 'manual_override',
              outcome: 'override_approved',
              reason: event.rationale,
              blocker_snapshot: snapshot,
            },
            releaseCloseDecisionIntent(release, event.actor_id, event.resolution, {
              reason: event.rationale,
              blocker_snapshot: snapshot,
            }),
          ],
          snapshot,
        );
      }
      break;
  }

  return invalidTransition('Release', `${release.phase}/${release.activity_state}/${release.gate_state}`, event.type);
};

export const transitionRunSession = (runSession: RunSession | undefined, event: RunSessionTransition): RunSession => {
  const at = timestampFor(event);

  if (runSession === undefined) {
    if (event.type !== 'create') {
      return invalidTransition('RunSession', 'none', event.type);
    }

    return {
      id: event.id,
      execution_package_id: event.execution_package_id,
      requested_by_actor_id: event.requested_by_actor_id,
      status: 'queued',
      changed_files: (event.changed_files ?? []).map(cloneChangedFile),
      check_results: [],
      artifacts: [],
      log_refs: (event.log_refs ?? []).map(cloneArtifactRef),
      created_at: at,
      updated_at: at,
      ...(event.executor_type !== undefined ? { executor_type: event.executor_type } : {}),
      ...(event.run_spec !== undefined ? { run_spec: cloneRunSpec(event.run_spec) } : {}),
      ...(event.summary !== undefined ? { summary: event.summary } : {}),
      ...(event.failure_kind !== undefined ? { failure_kind: event.failure_kind } : {}),
      ...(event.failure_reason !== undefined ? { failure_reason: event.failure_reason } : {}),
    };
  }

  if (event.type === 'create') {
    return invalidTransition('RunSession', runSession.status, event.type);
  }

  switch (event.type) {
    case 'workflow_start':
      if (runSession.status === 'queued' || runSession.status === 'stalled' || runSession.status === 'resuming') {
        return {
          ...runSession,
          status: 'running',
          ...(runSession.started_at === undefined ? { started_at: at } : {}),
          updated_at: at,
        };
      }
      break;
    case 'worker_started':
      if (runSession.status === 'queued' || runSession.status === 'stalled' || runSession.status === 'resuming') {
        return {
          ...runSession,
          status: 'running',
          ...(runSession.started_at === undefined ? { started_at: at } : {}),
          ...(event.runtime_metadata !== undefined
            ? { runtime_metadata: mergeRunRuntimeMetadata(runSession.runtime_metadata, event.runtime_metadata) }
            : {}),
          updated_at: at,
        };
      }
      break;
    case 'waiting_for_input':
      if (runSession.status === 'running' || runSession.status === 'resuming') {
        return { ...runSession, status: 'waiting_for_input', updated_at: at };
      }
      break;
    case 'stalled':
      if (runSession.status === 'running' || runSession.status === 'resuming' || runSession.status === 'waiting_for_input') {
        return { ...runSession, status: 'stalled', updated_at: at };
      }
      break;
    case 'resume_requested':
      if (runSession.status === 'waiting_for_input' || runSession.status === 'stalled' || runSession.status === 'resuming') {
        return { ...runSession, status: 'resuming', updated_at: at };
      }
      break;
    case 'recovered':
      if (runSession.status === 'stalled' || runSession.status === 'resuming') {
        return {
          ...runSession,
          status: 'running',
          ...(event.runtime_metadata !== undefined
            ? { runtime_metadata: mergeRunRuntimeMetadata(runSession.runtime_metadata, event.runtime_metadata) }
            : {}),
          updated_at: at,
        };
      }
      break;
    case 'cancel_requested':
      if (isNonTerminalRunSessionStatus(runSession.status)) {
        return { ...runSession, status: 'cancel_requested', updated_at: at };
      }
      break;
    case 'executor_success':
      if (runSession.status === 'running') {
        const runSessionWithoutFailure = { ...runSession };
        delete runSessionWithoutFailure.failure_kind;
        delete runSessionWithoutFailure.failure_reason;

        return {
          ...runSessionWithoutFailure,
          ...cloneRunSessionTerminalEvidence(runSession.id, event),
          status: 'succeeded',
          finished_at: at,
          updated_at: at,
        };
      }
      break;
    case 'executor_failure':
      if (runSession.status === 'running') {
        const terminalEvidence = cloneRunSessionTerminalEvidence(runSession.id, event);
        const legacyFailureKind = 'failure_kind' in event ? event.failure_kind : undefined;
        const legacyFailureReason = 'failure_reason' in event ? event.failure_reason : undefined;
        const failureKind = terminalEvidence.failure_kind ?? legacyFailureKind;
        const failureReason = terminalEvidence.failure_reason ?? legacyFailureReason;

        if (failureKind === undefined || failureReason === undefined) {
          return invalidTransition('RunSession', 'invalid_terminal_payload', event.type);
        }

        return {
          ...runSession,
          ...terminalEvidence,
          status: 'failed',
          failure_kind: failureKind,
          failure_reason: failureReason,
          finished_at: at,
          updated_at: at,
        };
      }
      break;
    case 'executor_timeout':
      if (runSession.status === 'running') {
        const terminalEvidence = cloneRunSessionTerminalEvidence(runSession.id, event);
        const legacyFailureKind = 'failure_kind' in event ? event.failure_kind : undefined;
        const legacyFailureReason = 'failure_reason' in event ? event.failure_reason : undefined;
        const failureKind = terminalEvidence.failure_kind ?? legacyFailureKind;
        const failureReason = terminalEvidence.failure_reason ?? legacyFailureReason;

        if (failureKind === undefined || failureReason === undefined) {
          return invalidTransition('RunSession', 'invalid_terminal_payload', event.type);
        }

        return {
          ...runSession,
          ...terminalEvidence,
          status: 'timed_out',
          failure_kind: failureKind,
          failure_reason: failureReason,
          finished_at: at,
          updated_at: at,
        };
      }
      break;
    case 'cancel':
      if (
        runSession.status === 'running' ||
        runSession.status === 'waiting_for_input' ||
        runSession.status === 'stalled' ||
        runSession.status === 'resuming' ||
        runSession.status === 'cancel_requested'
      ) {
        return { ...runSession, status: 'cancelled', finished_at: at, updated_at: at };
      }
      break;
  }

  return invalidTransition('RunSession', runSession.status, event.type);
};

export const transitionReviewPacket = (
  reviewPacket: ReviewPacket | undefined,
  event: ReviewPacketTransition,
): ReviewPacket => {
  const at = timestampFor(event);

  if (reviewPacket === undefined) {
    if (event.type !== 'create') {
      return invalidTransition('ReviewPacket', 'none', event.type);
    }

    return {
      id: event.id,
      run_session_id: event.run_session_id,
      execution_package_id: event.execution_package_id,
      reviewer_actor_id: event.reviewer_actor_id,
      spec_revision_id: event.spec_revision_id,
      plan_revision_id: event.plan_revision_id,
      status: 'ready',
      decision: 'none',
      changed_files: event.changed_files.map(cloneChangedFile),
      check_result_summary: event.check_result_summary,
      self_review: cloneSelfReviewResult(event.self_review),
      risk_notes: [...event.risk_notes],
      requested_changes: [],
      created_at: at,
      updated_at: at,
    };
  }

  if (event.type === 'create') {
    return invalidTransition('ReviewPacket', reviewPacket.status, event.type);
  }

  switch (event.type) {
    case 'start_review':
      if (reviewPacket.status === 'ready' && reviewPacket.decision === 'none') {
        return { ...reviewPacket, status: 'in_review', decision: 'none', updated_at: at };
      }
      break;
    case 'approve':
      if (
        reviewPacket.decision === 'none' &&
        (reviewPacket.status === 'ready' || reviewPacket.status === 'in_review')
      ) {
        assertReviewDecision(event);
        return {
          ...reviewPacket,
          status: 'completed',
          decision: 'approved',
          requested_changes: [],
          completed_at: at,
          updated_at: at,
          summary: event.summary,
          reviewed_by_actor_id: event.reviewed_by_actor_id,
          reviewed_at: event.reviewed_at,
        };
      }
      break;
    case 'request_changes':
      if (
        reviewPacket.decision === 'none' &&
        (reviewPacket.status === 'ready' || reviewPacket.status === 'in_review')
      ) {
        assertReviewDecision(event);
        return {
          ...reviewPacket,
          status: 'completed',
          decision: 'changes_requested',
          requested_changes: event.requested_changes.map(cloneRequestedChange),
          completed_at: at,
          updated_at: at,
          summary: event.summary,
          reviewed_by_actor_id: event.reviewed_by_actor_id,
          reviewed_at: event.reviewed_at,
        };
      }
      break;
    case 'archive_for_newer_run':
      if (
        reviewPacket.decision === 'none' &&
        (reviewPacket.status === 'draft' ||
          reviewPacket.status === 'ready' ||
          reviewPacket.status === 'in_review' ||
          reviewPacket.status === 'escalated')
      ) {
        return { ...reviewPacket, status: 'archived', decision: 'none', updated_at: at };
      }
      break;
  }

  return invalidTransition('ReviewPacket', `${reviewPacket.status}/${reviewPacket.decision}`, event.type);
};
