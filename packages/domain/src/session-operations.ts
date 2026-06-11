import type {
  CapsuleRetentionPin,
  OperatorSessionHealthProjection,
  PlanItemSessionDiagnostics,
  PlanItemSessionHealthSeverity,
  PlanItemSessionHealthState,
  RecoverSessionRequest,
  SessionOperationsFilter,
  SessionOperationsHealthQuery,
  SessionRecoveryCandidatePredicate,
  SessionRecoveryRecordDto,
} from '@forgeloop/contracts';
import { codexCanonicalDigest } from './codex-runtime.js';
import type {
  CodexRuntimeCapsule,
  CodexSession,
  CodexSessionLease,
  CodexSessionTurn,
  PlanItemWorkflow,
  PlanItemWorkflowQueuedAction,
} from './plan-item-workflow.js';
import { DomainError, type IsoDateTime, type ObjectEvent, type RunSession } from './types.js';

type ObservedRef<T> = { checked: true; state: 'present'; value: T } | { checked: true; state: 'absent' };
type PlanItemSessionHealthCore = Omit<OperatorSessionHealthProjection, 'codex_session_id'> & {
  codex_session_id?: string;
};

export type PlanItemSessionHealth = PlanItemSessionHealthCore & {
  diagnostics: PlanItemSessionDiagnostics;
};

export type SessionRecoveryOperation = RecoverSessionRequest['operation'] | 'scavenge';
export type SessionRecoveryResult = SessionRecoveryRecordDto['result'];

export interface RuntimeJobRef {
  id: string;
  session_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'stale' | 'unknown';
  terminal_status?: 'succeeded' | 'failed' | 'cancelled' | 'expired';
  worker_id: string;
  launch_lease_id: string;
  worker_session_digest?: string;
  expires_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface LatestCheckpointRef {
  checkpoint_id: string;
  created_at: IsoDateTime;
  projection_digest?: string;
}

export interface CapsuleProductReference {
  id: string;
  kind:
    | 'brainstorming_boundary'
    | 'spec_doc'
    | 'implementation_plan_doc'
    | 'execution_checkpoint'
    | 'review_checkpoint'
    | 'workflow_transition'
    | 'fork_point';
  capsule_id?: string;
  capsule_digest?: string;
}

export interface CapsuleObjectEventReference {
  id: string;
  capsule_id?: string;
  capsule_digest?: string;
  event_type?: string;
}

export interface CapsuleEvidenceReference {
  id: string;
  capsule_id?: string;
  capsule_digest?: string;
}

export interface BuildCapsuleRetentionPinsInput {
  checked_at: IsoDateTime;
  capsules?: readonly CodexRuntimeCapsule[];
  active_session?: Pick<CodexSession, 'id' | 'latest_capsule_id' | 'latest_capsule_digest'>;
  product_checkpoints?: readonly CapsuleProductReference[];
  recovery_records?: readonly SessionRecoveryRecord[];
  object_events?: readonly (CapsuleObjectEventReference | ObjectEvent)[];
  unrecoverable_evidence?: readonly CapsuleEvidenceReference[];
}

export interface BuildSessionHealthProjectionInput {
  project_id: string;
  organization_id?: string;
  checked_at: IsoDateTime;
  workflow?: PlanItemWorkflow;
  session?: CodexSession;
  active_lease?: CodexSessionLease;
  pending_queued_action?: PlanItemWorkflowQueuedAction;
  latest_turn?: CodexSessionTurn;
  runtime_job?: RuntimeJobRef;
  run_session?: RunSession;
  latest_capsule?: CodexRuntimeCapsule;
  retention_pin_inputs?: Omit<BuildCapsuleRetentionPinsInput, 'checked_at'> & Partial<Pick<BuildCapsuleRetentionPinsInput, 'checked_at'>>;
  retention_pins?: readonly CapsuleRetentionPin[];
  stale_projection_reason?: string;
  latest_checkpoint?: LatestCheckpointRef;
  workflow_resolution?: PlanItemSessionDiagnostics['workflow_resolution'];
  plan_item_id?: string;
}

export interface SessionRecoveryRecord extends Omit<SessionRecoveryRecordDto, 'predicate_summary'> {
  predicate_summary: SessionRecoveryCandidatePredicate | SessionRecoveryRecordDto['predicate_summary'];
  workflow_id?: string;
  development_plan_item_id?: string;
}

export type ListSessionHealthProjectionsQuery = SessionOperationsHealthQuery;
export type ListSessionRecoveryRecordsQuery = {
  workflow_id?: string;
  development_plan_item_id?: string;
  codex_session_id?: string;
  recovered_state?: 'recovered' | 'unrecoverable';
  health_states?: PlanItemSessionHealthState[];
  limit?: number;
  operation?: SessionRecoveryRecord['operation'];
  result?: SessionRecoveryRecord['result'];
};

export interface RecoveryRequestIdentityInput {
  operation: RecoverSessionRequest['operation'] | 'scavenge';
  reason: string;
  operation_idempotency_key: string;
  candidate_predicate: SessionRecoveryCandidatePredicate;
  codex_session_id?: string;
  target_after_state?: PlanItemSessionHealthState;
  target_result?: SessionRecoveryResult;
}

type PinReason = CapsuleProductReference['kind'] | 'active_session_latest' | 'recovery_record' | 'object_event' | 'unrecoverable_evidence';

const recoveryStates = new Set<PlanItemSessionHealthState>([
  'blocked_stale_lease',
  'blocked_orphaned_action',
  'blocked_missing_capsule',
  'blocked_lineage_conflict',
]);
const notCleanableReasons = new Set<PinReason>(['recovery_record', 'unrecoverable_evidence']);

export const sessionRecoveryProjectionDigest = (value: unknown): string => codexCanonicalDigest(value);

export const capsuleDigestPrefix = (digest: string): string => digest.slice(0, 'sha256:'.length + 12);

export const buildSessionHealthProjection = (input: BuildSessionHealthProjectionInput): PlanItemSessionHealth => {
  const planItemId = resolvePlanItemId(input);
  const codexSessionId = input.session?.id ?? input.workflow?.active_codex_session_id;
  const state = deriveState(input);
  const severity = severityForState(state);
  const reasonCode = reasonCodeForState(state, input);
  const retentionPins = [...(input.retention_pins ?? buildCapsuleRetentionPins({ checked_at: input.checked_at, ...input.retention_pin_inputs }))];
  const retentionRisk = retentionPins.some((pin) => pin.pin_state === 'unknown' || pin.pin_state === 'not_cleanable');
  const lineageRisk = state === 'blocked_lineage_conflict';
  const workflowResolution = input.workflow_resolution ?? (input.workflow === undefined ? 'no_active_workflow' : 'active_workflow');
  const hasActiveWorkflowResolution = workflowResolution === 'active_workflow';
  const hasConcreteRecoveryTarget = input.workflow !== undefined && input.session !== undefined && codexSessionId !== undefined;
  const recoveryAvailable = hasActiveWorkflowResolution && hasConcreteRecoveryTarget && recoveryStates.has(state);
  const operatorInterventionRequired = !hasActiveWorkflowResolution || (state !== 'healthy' && state !== 'recovered');
  const normalWorkflowActionsAvailable = hasActiveWorkflowResolution && (state === 'healthy' || state === 'attention_needed');
  const base = optionalObject<PlanItemSessionHealthCore>({
    ...(codexSessionId === undefined ? {} : { codex_session_id: codexSessionId }),
    project_id: input.project_id,
    organization_id: input.organization_id,
    state,
    severity,
    reason_code: reasonCode,
    summary: summaryForState(state, input),
    projection_digest: '',
    checked_at: input.checked_at,
    recovery_available: recoveryAvailable,
    recovery_operation_labels: recoveryOperationLabelsForState(state, recoveryAvailable),
    operator_intervention_required: operatorInterventionRequired,
    normal_workflow_actions_available: normalWorkflowActionsAvailable,
    retention_risk: retentionRisk,
    lineage_risk: lineageRisk,
    latest_checkpoint: input.latest_checkpoint,
    retention_pins: retentionPins,
    workflow_id: input.workflow?.id,
    development_plan_id: input.workflow?.development_plan_id,
    development_plan_item_id: input.workflow?.development_plan_item_id,
  });
  const projectionDigest = sessionRecoveryProjectionDigest({
    schema_version: 'session_health_projection.v1',
    ...base,
    projection_digest: undefined,
    observed_facts: buildObservedFactsSnapshot(input, retentionPins),
  });
  const withDigest = { ...base, projection_digest: projectionDigest };
  const candidate_predicate = recoveryAvailable
    ? buildSessionRecoveryCandidatePredicate(input, state, projectionDigest)
    : undefined;
  const diagnostics = redactPlanItemSessionDiagnostics({
    ...withDigest,
    ...(candidate_predicate === undefined ? {} : { candidate_predicate }),
    diagnostics: {
      plan_item_id: planItemId,
      workflow_resolution: workflowResolution,
      summary: withDigest.summary,
      operator_intervention_required: operatorInterventionRequired,
      normal_workflow_actions_available: normalWorkflowActionsAvailable,
      recovery_request_available: recoveryAvailable,
      ...(input.workflow === undefined ? {} : { workflow_id: input.workflow.id }),
    },
  } as PlanItemSessionHealth);
  return optionalObject<PlanItemSessionHealth>({
    ...withDigest,
    candidate_predicate,
    diagnostics,
  });
};

export const buildSessionRecoveryCandidatePredicate = (
  input: BuildSessionHealthProjectionInput,
  state: PlanItemSessionHealthState,
  projectionDigest: string,
): SessionRecoveryCandidatePredicate => {
  const codexSessionId = input.session?.id ?? input.workflow?.active_codex_session_id;
  const workflowId = input.workflow?.id ?? input.session?.owner_id;
  if (codexSessionId === undefined || workflowId === undefined) {
    throw new DomainError(
      'session_operations_stale_candidate',
      'session_operations_stale_candidate: recovery candidate requires concrete workflow and Codex session identity',
    );
  }
  return {
    codex_session_id: codexSessionId,
    workflow_id: workflowId,
    expected_health_state: state,
    operation_idempotency_key: codexCanonicalDigest({
      predicate_kind: 'session_recovery_candidate',
      codex_session_id: codexSessionId,
      workflow_id: workflowId,
      projection_digest: projectionDigest,
      state,
    }),
    projection_digest: projectionDigest,
    workflow: observed(input.workflow, (workflow) =>
      ({
        id: workflow.id,
        development_plan_id: workflow.development_plan_id,
        development_plan_item_id: workflow.development_plan_item_id,
        status: workflow.status,
        active_codex_session_id: workflow.active_codex_session_id ?? null,
        active_boundary_summary_revision_id: workflow.active_boundary_summary_revision_id ?? null,
        active_spec_doc_revision_id: workflow.active_spec_doc_revision_id ?? null,
        active_implementation_plan_doc_revision_id: workflow.active_implementation_plan_doc_revision_id ?? null,
        execution_package_id: workflow.execution_package_id ?? null,
        updated_at: workflow.updated_at,
      }),
    ),
    session: observed(input.session, (session) =>
      ({
        id: session.id,
        workflow_id: session.owner_id,
        status: session.status,
        role: session.role,
        lease_epoch: session.lease_epoch,
        active_lease_id: session.active_lease_id ?? null,
        latest_turn_id: session.latest_turn_id ?? null,
        latest_capsule_id: session.latest_capsule_id ?? null,
        latest_capsule_digest: session.latest_capsule_digest ?? null,
        ...(session.codex_thread_id_digest === undefined ? {} : { codex_thread_id_digest: session.codex_thread_id_digest }),
        runner_worker_id: session.runner_worker_id ?? null,
        runner_launch_lease_id: session.runner_launch_lease_id ?? null,
        runner_runtime_job_id: session.runner_runtime_job_id ?? null,
        runner_expires_at: session.runner_expires_at ?? null,
        updated_at: session.updated_at,
      }),
    ),
    active_lease: observed(input.active_lease, (lease) =>
      ({
        id: lease.id,
        session_id: lease.codex_session_id,
        status: lease.status,
        lease_epoch: lease.lease_epoch,
        worker_id: lease.worker_id,
        worker_session_digest: lease.worker_session_digest,
        heartbeat_at: lease.heartbeat_at ?? null,
        expires_at: lease.expires_at,
        updated_at: lease.updated_at,
      }),
    ),
    pending_queued_action: observed(input.pending_queued_action, (action) =>
      ({
        id: action.id,
        workflow_id: action.workflow_id,
        codex_session_id: action.codex_session_id,
        kind: action.kind,
        status: action.status,
        idempotency_key: action.idempotency_key,
        codex_session_turn_id: action.codex_session_turn_id ?? null,
        expected_input_capsule_digest: action.expected_input_capsule_digest ?? null,
        updated_at: action.updated_at,
      }),
    ),
    latest_turn: observed(input.latest_turn, (turn) =>
      ({
        id: turn.id,
        session_id: turn.codex_session_id,
        workflow_id: turn.workflow_id,
        status: turn.status,
        input_digest: turn.input_digest,
        input_capsule_digest: turn.input_capsule_digest ?? null,
        output_capsule_digest: turn.output_capsule_digest ?? null,
        runtime_job_id: turn.runtime_job_id ?? null,
        updated_at: turn.updated_at,
      }),
    ),
    runtime_job: observed(input.runtime_job, (job) =>
      ({
        id: job.id,
        session_id: job.session_id,
        status: job.status,
        terminal_status: job.terminal_status ?? null,
        worker_id: job.worker_id,
        launch_lease_id: job.launch_lease_id,
        worker_session_digest: job.worker_session_digest ?? null,
        expires_at: job.expires_at,
        updated_at: job.updated_at,
      }),
    ),
    run_session: observed(input.run_session, (runSession) =>
      ({
        id: runSession.id,
        workflow_id: runSession.workflow_id ?? null,
        codex_session_id: runSession.codex_session_id ?? null,
        codex_session_turn_id: runSession.codex_session_turn_id ?? null,
        status: runSession.status,
        remote_runtime_job_id: runSession.runtime_metadata?.remote_runtime_job_id ?? null,
        remote_run_worker_lease_id: runSession.runtime_metadata?.remote_run_worker_lease_id ?? null,
        input_capsule_digest: digestFromRuntimeMetadata(runSession, 'input_capsule_digest') ?? null,
        output_capsule_digest: digestFromRuntimeMetadata(runSession, 'output_capsule_digest') ?? null,
        updated_at: runSession.updated_at,
      }),
    ),
    latest_capsule: observed(input.latest_capsule, (capsule) =>
      optionalObject({
        id: capsule.id,
        digest: capsule.digest,
        sequence: capsule.sequence,
        retention_pin: retentionPinForCapsule(input, capsule),
        created_at: capsule.created_at,
      }),
    ),
    observed_at: input.checked_at,
  };
};

export const buildCapsuleRetentionPins = (input: BuildCapsuleRetentionPinsInput): CapsuleRetentionPin[] => {
  const records = new Map<string, CapsuleRetentionPin & { inconsistent: boolean }>();
  const ensure = (capsule_id: string, capsule_digest: string): CapsuleRetentionPin & { inconsistent: boolean } => {
    const key = `${capsule_id}\n${capsule_digest}`;
    const existing = records.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const pin: CapsuleRetentionPin & { inconsistent: boolean } = {
      capsule_id,
      capsule_digest,
      pin_state: 'unpinned_candidate',
      pin_reasons: [],
      referenced_by: [],
      checked_at: input.checked_at,
      inconsistent: false,
    };
    records.set(key, pin);
    return pin;
  };
  const markInconsistentCapsuleId = (capsule_id: string): void => {
    for (const pin of records.values()) {
      if (pin.capsule_id === capsule_id) {
        pin.inconsistent = true;
      }
    }
  };
  for (const capsule of input.capsules ?? []) {
    ensure(capsule.id, capsule.digest);
  }
  const addRef = (capsule_id: string | undefined, capsule_digest: string | undefined, reason: PinReason, object_type: string, object_id: string): void => {
    if (capsule_id === undefined || capsule_digest === undefined) {
      return;
    }
    const existingForId = [...records.values()].filter((pin) => pin.capsule_id === capsule_id);
    const matchingExisting = existingForId.find((pin) => pin.capsule_digest === capsule_digest);
    const mismatchedExisting = existingForId.find((pin) => pin.capsule_digest !== capsule_digest);
    if (mismatchedExisting !== undefined && matchingExisting === undefined) {
      markInconsistentCapsuleId(capsule_id);
      addUnique(mismatchedExisting.pin_reasons, reason);
      addUniqueRef(mismatchedExisting.referenced_by, { object_type, object_id, relation: reason });
      return;
    }
    const pin = matchingExisting ?? ensure(capsule_id, capsule_digest);
    addUnique(pin.pin_reasons, reason);
    addUniqueRef(pin.referenced_by, { object_type, object_id, relation: reason });
  };
  const active = input.active_session;
  addRef(active?.latest_capsule_id, active?.latest_capsule_digest, 'active_session_latest', 'codex_session', active?.id ?? '');
  for (const ref of input.product_checkpoints ?? []) {
    addRef(ref.capsule_id, ref.capsule_digest, ref.kind, ref.kind, ref.id);
  }
  for (const record of input.recovery_records ?? []) {
    for (const capsuleId of record.affected_capsule_ids ?? []) {
      const matching = [...records.values()].find((pin) => pin.capsule_id === capsuleId);
      addRef(capsuleId, matching?.capsule_digest, 'recovery_record', 'session_recovery_record', record.id);
    }
  }
  for (const event of input.object_events ?? []) {
    const capsuleId = capsuleReferenceField(event, 'capsule_id');
    const capsuleDigest = capsuleReferenceField(event, 'capsule_digest');
    addRef(capsuleId, capsuleDigest, 'object_event', 'object_event', event.id);
  }
  for (const evidence of input.unrecoverable_evidence ?? []) {
    addRef(evidence.capsule_id, evidence.capsule_digest, 'unrecoverable_evidence', 'unrecoverable_evidence', evidence.id);
  }
  return [...records.values()]
    .map((pin) => {
      const { inconsistent: _inconsistent, ...publicPin } = pin;
      return {
        ...publicPin,
        pin_state: pin.inconsistent ? 'unknown' : pinStateForReasons(pin.pin_reasons as PinReason[]),
        pin_reasons: [...pin.pin_reasons].sort(compareCodeUnits),
        referenced_by: [...pin.referenced_by].sort(compareReferences),
      } satisfies CapsuleRetentionPin;
    })
    .sort((left, right) => compareCodeUnits(left.capsule_id, right.capsule_id) || compareCodeUnits(left.capsule_digest, right.capsule_digest));
};

export const redactPlanItemSessionDiagnostics = (projection: PlanItemSessionHealth): PlanItemSessionDiagnostics =>
  optionalObject({
    plan_item_id: projection.development_plan_item_id ?? projection.diagnostics?.plan_item_id ?? requirePlanItemId(projection),
    workflow_resolution: projection.diagnostics?.workflow_resolution ?? (projection.workflow_id === undefined ? 'no_active_workflow' : 'active_workflow'),
    state: projection.state,
    severity: projection.severity,
    summary: projection.summary,
    operator_intervention_required: projection.operator_intervention_required,
    normal_workflow_actions_available: projection.normal_workflow_actions_available,
    recovery_request_available: projection.recovery_available,
    latest_checkpoint: projection.latest_checkpoint,
  });

export const redactOperatorSessionHealthProjection = (projection: PlanItemSessionHealth): OperatorSessionHealthProjection =>
  optionalObject({
    codex_session_id: requireCodexSessionId(projection),
    project_id: projection.project_id,
    organization_id: projection.organization_id,
    state: projection.state,
    severity: projection.severity,
    reason_code: projection.reason_code,
    summary: projection.summary,
    projection_digest: projection.projection_digest,
    checked_at: projection.checked_at,
    recovery_available: projection.recovery_available,
    recovery_operation_labels: projection.recovery_operation_labels,
    operator_intervention_required: projection.operator_intervention_required,
    normal_workflow_actions_available: projection.normal_workflow_actions_available,
    retention_risk: projection.retention_risk,
    lineage_risk: projection.lineage_risk,
    latest_checkpoint: projection.latest_checkpoint,
    retention_pins: projection.retention_pins,
    candidate_predicate: projection.candidate_predicate,
    workflow_id: projection.workflow_id,
    development_plan_id: projection.development_plan_id,
    development_plan_item_id: projection.development_plan_item_id,
    diagnostics: redactPlanItemSessionDiagnostics(projection),
  });

export const assertRecoveryPredicateStillMatches = (
  currentProjection: Pick<PlanItemSessionHealth, 'codex_session_id' | 'state' | 'projection_digest' | 'candidate_predicate'>,
  predicate: SessionRecoveryCandidatePredicate,
): void => {
  const freshPredicate = currentProjection.candidate_predicate;
  if (
    freshPredicate === undefined ||
    predicate.codex_session_id !== currentProjection.codex_session_id ||
    predicate.expected_health_state !== currentProjection.state ||
    predicate.projection_digest !== currentProjection.projection_digest ||
    sessionRecoveryProjectionDigest(freshPredicate) !== sessionRecoveryProjectionDigest(predicate)
  ) {
    throw new DomainError('session_operations_stale_candidate', 'session_operations_stale_candidate: recovery predicate no longer matches projection', {
      codex_session_id: currentProjection.codex_session_id,
      state: currentProjection.state,
      projection_digest: currentProjection.projection_digest,
    });
  }
};

export const recoveryRequestMatchesExistingRecord = (
  existing: SessionRecoveryRecord,
  incoming: RecoveryRequestIdentityInput,
): boolean => {
  if (existing.operation_idempotency_key !== incoming.operation_idempotency_key) {
    return false;
  }
  return (
    existing.reason === incoming.reason &&
    existing.codex_session_id === (incoming.codex_session_id ?? incoming.candidate_predicate.codex_session_id) &&
    existing.operation === incoming.operation &&
    existing.result === (incoming.target_result ?? 'applied') &&
    existing.after_state === (incoming.target_after_state ?? targetAfterStateForOperation(incoming.operation)) &&
    predicateSummariesMatch(existing.predicate_summary, incoming.candidate_predicate)
  );
};

export const assertRecoveryIdempotencyNotConflicting = (
  existing: SessionRecoveryRecord | undefined,
  incoming: RecoveryRequestIdentityInput,
): void => {
  if (existing === undefined || recoveryRequestMatchesExistingRecord(existing, incoming)) {
    return;
  }
  throw new DomainError(
    'session_operations_idempotency_conflict',
    'session_operations_idempotency_conflict: operation idempotency key was reused for different recovery input',
    {
      operation_idempotency_key: incoming.operation_idempotency_key,
      existing_record_id: existing.id,
    },
  );
};

const deriveState = (input: BuildSessionHealthProjectionInput): PlanItemSessionHealthState => {
  if (input.session === undefined || input.workflow === undefined) {
    return 'blocked_lineage_conflict';
  }
  if (input.workflow.active_codex_session_id !== input.session.id || input.session.owner_id !== input.workflow.id) {
    return 'blocked_lineage_conflict';
  }
  if (input.session.latest_capsule_id !== undefined && input.latest_capsule === undefined) {
    return 'blocked_missing_capsule';
  }
  if (
    input.latest_capsule !== undefined &&
    input.session.latest_capsule_digest !== undefined &&
    input.latest_capsule.digest !== input.session.latest_capsule_digest
  ) {
    return 'blocked_missing_capsule';
  }
  if (
    input.active_lease !== undefined &&
    input.active_lease.status === 'active' &&
    Date.parse(input.active_lease.expires_at) <= Date.parse(input.checked_at)
  ) {
    return 'blocked_stale_lease';
  }
  if (input.pending_queued_action !== undefined && input.active_lease === undefined) {
    return 'blocked_orphaned_action';
  }
  if (input.runtime_job !== undefined && input.run_session === undefined) {
    return 'blocked_orphaned_action';
  }
  if (input.runtime_job !== undefined && input.run_session !== undefined && input.active_lease === undefined) {
    return 'blocked_orphaned_action';
  }
  if (input.stale_projection_reason !== undefined) {
    return 'attention_needed';
  }
  return 'healthy';
};

const severityForState = (state: PlanItemSessionHealthState): PlanItemSessionHealthSeverity => {
  switch (state) {
    case 'healthy':
      return 'none';
    case 'attention_needed':
      return 'warning';
    case 'blocked_lineage_conflict':
      return 'critical';
    case 'blocked_stale_lease':
    case 'blocked_orphaned_action':
    case 'blocked_missing_capsule':
      return 'blocked';
    case 'recovered':
      return 'info';
    case 'unrecoverable':
      return 'critical';
  }
};

const recoveryOperationLabelsForState = (
  state: PlanItemSessionHealthState,
  recoveryAvailable: boolean,
): PlanItemSessionHealthCore['recovery_operation_labels'] => {
  if (!recoveryAvailable) {
    return [];
  }
  if (state === 'blocked_missing_capsule' || state === 'blocked_lineage_conflict') {
    return ['mark_unrecoverable'];
  }
  return ['recover'];
};

const reasonCodeForState = (state: PlanItemSessionHealthState, input: BuildSessionHealthProjectionInput): string | undefined => {
  switch (state) {
    case 'healthy':
      return undefined;
    case 'attention_needed':
      return 'stale_projection_reason';
    case 'blocked_lineage_conflict':
      return 'lineage_conflict';
    case 'blocked_stale_lease':
      return 'stale_lease';
    case 'blocked_orphaned_action':
      return 'orphaned_action';
    case 'blocked_missing_capsule':
      return 'missing_capsule';
    case 'recovered':
    case 'unrecoverable':
      return input.stale_projection_reason;
  }
};

const summaryForState = (state: PlanItemSessionHealthState, input: BuildSessionHealthProjectionInput): string => {
  switch (state) {
    case 'healthy':
      return 'The active Codex session is aligned with its workflow and latest capsule.';
    case 'attention_needed':
      return 'The session health projection needs operator attention.';
    case 'blocked_lineage_conflict':
      return 'The active workflow and Codex session lineage do not match.';
    case 'blocked_stale_lease':
      return 'The active session lease expired before the projection check.';
    case 'blocked_orphaned_action':
      return 'A queued action or runtime job is not attached to an active run boundary.';
    case 'blocked_missing_capsule':
      return 'The session latest capsule is missing or does not match the recorded digest.';
    case 'recovered':
      return 'The session was recovered.';
    case 'unrecoverable':
      return 'The session was marked unrecoverable.';
  }
};

const retentionPinForCapsule = (input: BuildSessionHealthProjectionInput, capsule: CodexRuntimeCapsule): CapsuleRetentionPin => {
  const pins = input.retention_pins ?? buildCapsuleRetentionPins({ checked_at: input.checked_at, ...input.retention_pin_inputs });
  return (
    pins.find((pin) => pin.capsule_id === capsule.id && pin.capsule_digest === capsule.digest) ?? {
      capsule_id: capsule.id,
      capsule_digest: capsule.digest,
      pin_state: 'unpinned_candidate',
      pin_reasons: [],
      referenced_by: [],
      checked_at: input.checked_at,
    }
  );
};

const observed = <Input, Output>(value: Input | undefined, project: (value: Input) => Output): ObservedRef<Output> =>
  value === undefined ? { checked: true, state: 'absent' } : { checked: true, state: 'present', value: project(value) };

const optionalObject = <T extends Record<string, unknown>>(value: T): T => {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      result[key] = entry;
    }
  }
  return result as T;
};

const pinStateForReasons = (reasons: readonly PinReason[]): CapsuleRetentionPin['pin_state'] => {
  if (reasons.some((reason) => notCleanableReasons.has(reason))) {
    return 'not_cleanable';
  }
  return reasons.length === 0 ? 'unpinned_candidate' : 'pinned';
};

const addUnique = <T>(values: T[], value: T): void => {
  if (!values.includes(value)) {
    values.push(value);
  }
};

const addUniqueRef = (values: CapsuleRetentionPin['referenced_by'], value: CapsuleRetentionPin['referenced_by'][number]): void => {
  if (!values.some((existing) => existing.object_type === value.object_type && existing.object_id === value.object_id && existing.relation === value.relation)) {
    values.push(value);
  }
};

const capsuleReferenceField = (value: unknown, key: 'capsule_id' | 'capsule_digest'): string | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const direct = (value as Record<string, unknown>)[key];
  if (typeof direct === 'string') {
    return direct;
  }
  const payload = (value as Record<string, unknown>).payload;
  if (typeof payload === 'object' && payload !== null) {
    const payloadValue = (payload as Record<string, unknown>)[key];
    if (typeof payloadValue === 'string') {
      return payloadValue;
    }
  }
  const metadata = (value as Record<string, unknown>).metadata;
  if (typeof metadata === 'object' && metadata !== null) {
    const metadataValue = (metadata as Record<string, unknown>)[key];
    if (typeof metadataValue === 'string') {
      return metadataValue;
    }
  }
  return undefined;
};

const digestFromRuntimeMetadata = (runSession: RunSession, key: 'input_capsule_digest' | 'output_capsule_digest'): string | undefined => {
  const value = runSession.runtime_metadata?.[key as keyof NonNullable<RunSession['runtime_metadata']>];
  return typeof value === 'string' ? value : undefined;
};

const buildObservedFactsSnapshot = (
  input: BuildSessionHealthProjectionInput,
  retentionPins: readonly CapsuleRetentionPin[],
): Record<string, unknown> => ({
  workflow: observed(input.workflow, (workflow) =>
    ({
      id: workflow.id,
      development_plan_id: workflow.development_plan_id,
      development_plan_item_id: workflow.development_plan_item_id,
      status: workflow.status,
      active_codex_session_id: workflow.active_codex_session_id ?? null,
      active_boundary_summary_revision_id: workflow.active_boundary_summary_revision_id ?? null,
      active_spec_doc_revision_id: workflow.active_spec_doc_revision_id ?? null,
      active_implementation_plan_doc_revision_id: workflow.active_implementation_plan_doc_revision_id ?? null,
      execution_package_id: workflow.execution_package_id ?? null,
      updated_at: workflow.updated_at,
    }),
  ),
  session: observed(input.session, (session) =>
    ({
      id: session.id,
      owner_id: session.owner_id,
      status: session.status,
      role: session.role,
      lease_epoch: session.lease_epoch,
      latest_capsule_id: session.latest_capsule_id ?? null,
      latest_capsule_digest: session.latest_capsule_digest ?? null,
      latest_turn_id: session.latest_turn_id ?? null,
      active_lease_id: session.active_lease_id ?? null,
      codex_thread_id_digest: session.codex_thread_id_digest ?? null,
      runner_worker_id: session.runner_worker_id ?? null,
      runner_launch_lease_id: session.runner_launch_lease_id ?? null,
      runner_runtime_job_id: session.runner_runtime_job_id ?? null,
      runner_expires_at: session.runner_expires_at ?? null,
      updated_at: session.updated_at,
    }),
  ),
  active_lease: observed(input.active_lease, (lease) =>
    optionalObject({
      id: lease.id,
      codex_session_id: lease.codex_session_id,
      lease_epoch: lease.lease_epoch,
      worker_id: lease.worker_id,
      worker_session_digest: lease.worker_session_digest,
      status: lease.status,
      heartbeat_at: lease.heartbeat_at,
      expires_at: lease.expires_at,
      updated_at: lease.updated_at,
    }),
  ),
  pending_queued_action: observed(input.pending_queued_action, (action) =>
    optionalObject({
      id: action.id,
      workflow_id: action.workflow_id,
      codex_session_id: action.codex_session_id,
      kind: action.kind,
      status: action.status,
      expected_input_capsule_digest: action.expected_input_capsule_digest,
      idempotency_key: action.idempotency_key,
      codex_session_turn_id: action.codex_session_turn_id,
      updated_at: action.updated_at,
    }),
  ),
  latest_turn: observed(input.latest_turn, (turn) =>
    optionalObject({
      id: turn.id,
      codex_session_id: turn.codex_session_id,
      workflow_id: turn.workflow_id,
      status: turn.status,
      input_digest: turn.input_digest,
      input_capsule_id: turn.input_capsule_id,
      input_capsule_digest: turn.input_capsule_digest,
      output_capsule_id: turn.output_capsule_id,
      output_capsule_digest: turn.output_capsule_digest,
      runtime_job_id: turn.runtime_job_id,
      updated_at: turn.updated_at,
    }),
  ),
  runtime_job: observed(input.runtime_job, (job) =>
    ({
      id: job.id,
      session_id: job.session_id,
      status: job.status,
      terminal_status: job.terminal_status ?? null,
      worker_id: job.worker_id,
      launch_lease_id: job.launch_lease_id,
      worker_session_digest: job.worker_session_digest ?? null,
      expires_at: job.expires_at,
      updated_at: job.updated_at,
    }),
  ),
  run_session: observed(input.run_session, (runSession) =>
    ({
      id: runSession.id,
      workflow_id: runSession.workflow_id ?? null,
      codex_session_id: runSession.codex_session_id ?? null,
      codex_session_turn_id: runSession.codex_session_turn_id ?? null,
      status: runSession.status,
      updated_at: runSession.updated_at,
      remote_runtime_job_id: runSession.runtime_metadata?.remote_runtime_job_id ?? null,
      remote_run_worker_lease_id: runSession.runtime_metadata?.remote_run_worker_lease_id ?? null,
      input_capsule_digest: digestFromRuntimeMetadata(runSession, 'input_capsule_digest') ?? null,
      output_capsule_digest: digestFromRuntimeMetadata(runSession, 'output_capsule_digest') ?? null,
    }),
  ),
  latest_capsule: observed(input.latest_capsule, (capsule) =>
    optionalObject({
      id: capsule.id,
      codex_session_id: capsule.codex_session_id,
      created_from_turn_id: capsule.created_from_turn_id,
      sequence: capsule.sequence,
      digest: capsule.digest,
      manifest_digest: capsule.manifest_digest,
      thread_state_digest: capsule.thread_state_digest,
      memory_state_digest: capsule.memory_state_digest,
      environment_manifest_digest: capsule.environment_manifest_digest,
      codex_thread_id_digest: capsule.codex_thread_id_digest,
      created_at: capsule.created_at,
    }),
  ),
  retention_pins: retentionPins,
});

const predicateSummary = (predicate: SessionRecoveryRecord['predicate_summary']): SessionRecoveryRecordDto['predicate_summary'] => {
  if ('workflow' in predicate) {
    return {
      operation_idempotency_key: predicate.operation_idempotency_key,
      projection_digest: predicate.projection_digest,
      expected_health_state: predicate.expected_health_state,
      observed_at: predicate.observed_at,
      workflow_state: predicate.workflow.state,
      session_state: predicate.session.state,
      active_lease_state: predicate.active_lease.state,
      pending_queued_action_state: predicate.pending_queued_action.state,
      latest_turn_state: predicate.latest_turn.state,
      runtime_job_state: predicate.runtime_job.state,
      run_session_state: predicate.run_session.state,
      latest_capsule_state: predicate.latest_capsule.state,
    };
  }
  return predicate;
};

const predicateSummariesMatch = (
  existing: SessionRecoveryRecord['predicate_summary'],
  incoming: SessionRecoveryCandidatePredicate,
): boolean => codexCanonicalDigest(predicateSummary(existing)) === codexCanonicalDigest(predicateSummary(incoming));

const resolvePlanItemId = (input: Pick<BuildSessionHealthProjectionInput, 'plan_item_id' | 'workflow'>): string => {
  const planItemId = input.plan_item_id ?? input.workflow?.development_plan_item_id;
  if (planItemId === undefined) {
    throw new DomainError(
      'session_operations_no_active_workflow',
      'session_operations_no_active_workflow: session health projection requires a concrete Plan Item identity',
    );
  }
  return planItemId;
};

const requirePlanItemId = (projection: Pick<PlanItemSessionHealth, 'development_plan_item_id' | 'diagnostics'>): string => {
  const planItemId = projection.development_plan_item_id ?? projection.diagnostics?.plan_item_id;
  if (planItemId === undefined) {
    throw new DomainError(
      'session_operations_no_active_workflow',
      'session_operations_no_active_workflow: Plan Item diagnostics require a concrete Plan Item identity',
    );
  }
  return planItemId;
};

const requireCodexSessionId = (projection: Pick<PlanItemSessionHealth, 'codex_session_id'>): string => {
  if (projection.codex_session_id === undefined) {
    throw new DomainError(
      'session_operations_no_active_workflow',
      'session_operations_no_active_workflow: operator session health requires a concrete Codex session identity',
    );
  }
  return projection.codex_session_id;
};

const targetAfterStateForOperation = (operation: RecoveryRequestIdentityInput['operation']): PlanItemSessionHealthState =>
  operation === 'mark_unrecoverable' ? 'unrecoverable' : 'recovered';

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const compareReferences = (left: CapsuleRetentionPin['referenced_by'][number], right: CapsuleRetentionPin['referenced_by'][number]): number =>
  compareCodeUnits(left.object_type, right.object_type) ||
  compareCodeUnits(left.object_id, right.object_id) ||
  compareCodeUnits(left.relation, right.relation);
