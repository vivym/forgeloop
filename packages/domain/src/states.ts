import {
  DomainError,
  type ExecutionPackage,
  type ReviewPacket,
  type RunSession,
  type SpecPlan,
  type SpecPlanEntityType,
  type WorkItem,
} from './types';
import type {
  ArtifactKind,
  ArtifactRef,
  ChangedFile,
  FailureKind,
  RequestedChange,
  RequiredCheckSpec,
  RunSpec,
  SelfReviewResult,
} from '@forgeloop/contracts';
import type { WorkItemCompletion } from './completion';

const DEFAULT_TIMESTAMP = '2026-05-05T00:00:00.000Z';

type Timestamped = {
  at?: string;
};

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
      owner_actor_id: string;
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
    })
  | (Timestamped & {
      type: 'mark_ready' | 'run' | 'rerun' | 'workflow_start' | 'execution_succeeded' | 'review_approved' | 'review_changes_requested';
    })
  | (Timestamped & {
      type: 'force_rerun';
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
      type: 'workflow_start' | 'executor_success' | 'executor_failure' | 'executor_timeout' | 'cancel';
    });

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

const timestampFor = (event: Timestamped) => event.at ?? DEFAULT_TIMESTAMP;

const invalidTransition = (objectType: string, current: string, transition: string): never => {
  throw new DomainError('INVALID_TRANSITION', `Cannot apply ${transition} to ${objectType} in ${current}`);
};

const hasText = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0;

const cloneArtifactRef = (artifact: ArtifactRef): ArtifactRef => ({ ...artifact });

const cloneChangedFile = (changedFile: ChangedFile): ChangedFile => ({ ...changedFile });

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
  allowed_paths: [...runSpec.allowed_paths],
  forbidden_paths: [...runSpec.forbidden_paths],
  required_checks: runSpec.required_checks.map(cloneRequiredCheckSpec),
  artifact_policy: {
    requested_artifacts: [...runSpec.artifact_policy.requested_artifacts],
  },
});

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
};

const assertWorkItemCompletion = (workItem: WorkItem, completion: WorkItemCompletion | undefined): void => {
  if (completion?.done !== true || completion.resolution !== 'completed') {
    throw new DomainError('COMPLETION_BLOCKED', `Work item ${workItem.id} cannot be completed yet`, {
      work_item_id: workItem.id,
      incomplete_reasons: completion?.incomplete_reasons ?? ['completion evidence is required'],
    });
  }
};

export const transitionWorkItem = (workItem: WorkItem | undefined, event: WorkItemTransition): WorkItem => {
  const at = timestampFor(event);

  if (workItem === undefined) {
    if (event.type !== 'create') {
      return invalidTransition('WorkItem', 'none', event.type);
    }

    return {
      id: event.id,
      project_id: event.project_id,
      kind: event.kind,
      title: event.title,
      goal: event.goal,
      success_criteria: [...event.success_criteria],
      priority: event.priority,
      risk: event.risk,
      owner_actor_id: event.owner_actor_id,
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

  switch (event.type) {
    case 'mark_ready':
      if (executionPackage.phase === 'draft') {
        return { ...executionPackage, phase: 'ready', gate_state: 'not_submitted', updated_at: at };
      }
      break;
    case 'run':
    case 'rerun':
      if (executionPackage.phase === 'ready') {
        return {
          ...executionPackage,
          phase: 'queued',
          activity_state: 'awaiting_ai',
          gate_state: 'none',
          resolution: 'none',
          updated_at: at,
        };
      }
      break;
    case 'force_rerun':
      if (executionPackage.phase === 'review' && executionPackage.resolution === 'none' && event.has_open_review_packet) {
        return {
          ...executionPackage,
          phase: 'queued',
          activity_state: 'awaiting_ai',
          gate_state: 'none',
          resolution: 'none',
          updated_at: at,
        };
      }
      break;
    case 'workflow_start':
      if (executionPackage.phase === 'queued') {
        return { ...executionPackage, phase: 'execution', activity_state: 'ai_running', updated_at: at };
      }
      break;
    case 'execution_failed_retryable':
      if (isRunningExecution) {
        return {
          ...executionPackage,
          phase: 'ready',
          activity_state: 'idle',
          gate_state: 'none',
          last_failure_summary: event.failure_summary,
          updated_at: at,
        };
      }
      break;
    case 'execution_failed_blocked':
      if (isRunningExecution) {
        return {
          ...executionPackage,
          activity_state: 'blocked',
          blocked_reason: event.blocked_reason,
          updated_at: at,
        };
      }
      break;
    case 'execution_succeeded':
      if (isRunningExecution) {
        return {
          ...executionPackage,
          phase: 'review',
          activity_state: 'awaiting_human',
          gate_state: 'awaiting_human_review',
          resolution: 'none',
          updated_at: at,
        };
      }
      break;
    case 'execution_failed_blocking_check':
      if (isRunningExecution) {
        return {
          ...executionPackage,
          phase: 'ready',
          activity_state: 'idle',
          gate_state: 'none',
          last_failure_summary: event.failure_summary,
          updated_at: at,
        };
      }
      break;
    case 'review_approved':
      if (isAwaitingHumanReview) {
        return {
          ...executionPackage,
          activity_state: 'idle',
          gate_state: 'review_approved',
          resolution: 'completed',
          updated_at: at,
        };
      }
      break;
    case 'review_changes_requested':
      if (isAwaitingHumanReview) {
        return {
          ...executionPackage,
          phase: 'ready',
          activity_state: 'idle',
          gate_state: 'changes_requested',
          resolution: 'none',
          updated_at: at,
        };
      }
      break;
  }

  return invalidTransition(
    'ExecutionPackage',
    `${executionPackage.phase}/${executionPackage.activity_state}/${executionPackage.gate_state}`,
    event.type,
  );
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
      if (runSession.status === 'queued') {
        return { ...runSession, status: 'running', started_at: at, updated_at: at };
      }
      break;
    case 'executor_success':
      if (runSession.status === 'running') {
        return { ...runSession, status: 'succeeded', finished_at: at, updated_at: at };
      }
      break;
    case 'executor_failure':
      if (runSession.status === 'running') {
        return { ...runSession, status: 'failed', finished_at: at, updated_at: at };
      }
      break;
    case 'executor_timeout':
      if (runSession.status === 'running') {
        return { ...runSession, status: 'timed_out', finished_at: at, updated_at: at };
      }
      break;
    case 'cancel':
      if (runSession.status === 'queued' || runSession.status === 'running') {
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
        (reviewPacket.status === 'ready' || reviewPacket.status === 'in_review')
      ) {
        return { ...reviewPacket, status: 'archived', decision: 'none', updated_at: at };
      }
      break;
  }

  return invalidTransition('ReviewPacket', `${reviewPacket.status}/${reviewPacket.decision}`, event.type);
};
