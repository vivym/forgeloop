import { z } from 'zod';

import {
  codexSessionLeaseStatusSchema,
  codexSessionRoleSchema,
  codexSessionStatusSchema,
  codexSessionTurnStatusSchema,
  planItemWorkflowQueuedActionKindSchema,
  planItemWorkflowQueuedActionStatusSchema,
  planItemWorkflowStatusSchema,
} from './plan-item-workflow.js';

const nonEmpty = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();
const safeDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const numericStringSchema = z.string().trim().min(1).regex(/^-?\d+(?:\.\d+)?$/);
const numericInputSchema = z.union([z.number(), numericStringSchema]).pipe(z.coerce.number());
const strictNonNegativeIntegerSchema = numericInputSchema.pipe(z.number().int().nonnegative());
const strictPositiveLimitSchema = numericInputSchema.pipe(z.number().int().positive().max(100));

export const planItemSessionHealthStateSchema = z.enum([
  'healthy',
  'attention_needed',
  'blocked_stale_lease',
  'blocked_orphaned_action',
  'blocked_missing_capsule',
  'blocked_lineage_conflict',
  'recovered',
  'unrecoverable',
]);
export type PlanItemSessionHealthState = z.infer<typeof planItemSessionHealthStateSchema>;

export const planItemSessionHealthSeveritySchema = z.enum(['none', 'info', 'warning', 'blocked', 'critical']);
export type PlanItemSessionHealthSeverity = z.infer<typeof planItemSessionHealthSeveritySchema>;

export const observedAbsentSchema = z
  .object({
    checked: z.literal(true),
    state: z.literal('absent'),
  })
  .strict();
export type ObservedAbsent = z.infer<typeof observedAbsentSchema>;

export const observedPresentSchema = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({
      checked: z.literal(true),
      state: z.literal('present'),
      value: z.object(shape).strict(),
    })
    .strict();
export type ObservedPresent<T> = {
  checked: true;
  state: 'present';
  value: T;
};

export const observedRefSchema = <T extends z.ZodRawShape>(shape: T) =>
  z.discriminatedUnion('state', [observedPresentSchema(shape), observedAbsentSchema]);
export type ObservedRef<T> = ObservedPresent<T> | ObservedAbsent;

export const capsuleRetentionPinSchema = z
  .object({
    capsule_id: nonEmpty,
    capsule_digest: safeDigestSchema,
    pin_state: z.enum(['pinned', 'not_cleanable', 'unpinned_candidate', 'unknown']),
    pin_reasons: z.array(nonEmpty).default([]),
    referenced_by: z
      .array(
        z
          .object({
            object_type: nonEmpty,
            object_id: nonEmpty,
            relation: nonEmpty,
          })
          .strict(),
      )
      .default([]),
    checked_at: isoDateTimeSchema,
  })
  .strict();
export type CapsuleRetentionPin = z.infer<typeof capsuleRetentionPinSchema>;

const workflowPredicateValueShape = {
  id: nonEmpty,
  development_plan_id: nonEmpty,
  development_plan_item_id: nonEmpty,
  status: planItemWorkflowStatusSchema,
  active_codex_session_id: nonEmpty.nullable(),
  active_boundary_summary_revision_id: nonEmpty.nullable(),
  active_spec_doc_revision_id: nonEmpty.nullable(),
  active_implementation_plan_doc_revision_id: nonEmpty.nullable(),
  execution_package_id: nonEmpty.nullable(),
  updated_at: isoDateTimeSchema,
} satisfies z.ZodRawShape;

const sessionPredicateValueShape = {
  id: nonEmpty,
  workflow_id: nonEmpty,
  status: codexSessionStatusSchema,
  role: codexSessionRoleSchema,
  lease_epoch: nonNegativeIntegerSchema,
  active_lease_id: nonEmpty.nullable(),
  latest_turn_id: nonEmpty.nullable(),
  latest_capsule_id: nonEmpty.nullable(),
  latest_capsule_digest: safeDigestSchema.nullable(),
  codex_thread_id_digest: safeDigestSchema.optional(),
  runner_worker_id: nonEmpty.nullable(),
  runner_launch_lease_id: nonEmpty.nullable(),
  runner_runtime_job_id: nonEmpty.nullable(),
  runner_expires_at: isoDateTimeSchema.nullable(),
  updated_at: isoDateTimeSchema,
} satisfies z.ZodRawShape;

const activeLeasePredicateValueShape = {
  id: nonEmpty,
  session_id: nonEmpty,
  status: codexSessionLeaseStatusSchema,
  lease_epoch: nonNegativeIntegerSchema,
  worker_id: nonEmpty,
  worker_session_digest: safeDigestSchema,
  heartbeat_at: isoDateTimeSchema.nullable(),
  expires_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
} satisfies z.ZodRawShape;

const pendingQueuedActionPredicateValueShape = {
  id: nonEmpty,
  workflow_id: nonEmpty.nullable(),
  codex_session_id: nonEmpty.nullable(),
  kind: planItemWorkflowQueuedActionKindSchema,
  status: planItemWorkflowQueuedActionStatusSchema,
  idempotency_key: safeDigestSchema,
  codex_session_turn_id: nonEmpty.nullable(),
  expected_input_capsule_digest: safeDigestSchema.nullable(),
  updated_at: isoDateTimeSchema,
} satisfies z.ZodRawShape;

const latestTurnPredicateValueShape = {
  id: nonEmpty,
  session_id: nonEmpty,
  workflow_id: nonEmpty,
  status: codexSessionTurnStatusSchema,
  input_digest: safeDigestSchema,
  input_capsule_digest: safeDigestSchema.nullable(),
  output_capsule_digest: safeDigestSchema.nullable(),
  runtime_job_id: nonEmpty.nullable(),
  updated_at: isoDateTimeSchema,
} satisfies z.ZodRawShape;

const runtimeJobPredicateValueShape = {
  id: nonEmpty,
  session_id: nonEmpty,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale', 'unknown']),
  terminal_status: z.enum(['succeeded', 'failed', 'cancelled', 'expired']).nullable(),
  worker_id: nonEmpty,
  launch_lease_id: nonEmpty,
  worker_session_digest: safeDigestSchema.nullable(),
  expires_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
} satisfies z.ZodRawShape;

const runSessionPredicateValueShape = {
  id: nonEmpty,
  workflow_id: nonEmpty.nullable(),
  codex_session_id: nonEmpty.nullable(),
  codex_session_turn_id: nonEmpty.nullable(),
  status: nonEmpty,
  remote_runtime_job_id: nonEmpty.nullable(),
  remote_run_worker_lease_id: nonEmpty.nullable(),
  input_capsule_digest: safeDigestSchema.nullable(),
  output_capsule_digest: safeDigestSchema.nullable(),
  updated_at: isoDateTimeSchema,
} satisfies z.ZodRawShape;

const latestCapsulePredicateValueShape = {
  id: nonEmpty,
  digest: safeDigestSchema,
  sequence: nonNegativeIntegerSchema,
  retention_pin: capsuleRetentionPinSchema,
  created_at: isoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

export const sessionRecoveryCandidatePredicateSchema = z
  .object({
    codex_session_id: nonEmpty,
    workflow_id: nonEmpty,
    expected_health_state: planItemSessionHealthStateSchema,
    operation_idempotency_key: nonEmpty,
    projection_digest: safeDigestSchema,
    workflow: observedRefSchema(workflowPredicateValueShape),
    session: observedRefSchema(sessionPredicateValueShape),
    active_lease: observedRefSchema(activeLeasePredicateValueShape),
    pending_queued_action: observedRefSchema(pendingQueuedActionPredicateValueShape),
    latest_turn: observedRefSchema(latestTurnPredicateValueShape),
    runtime_job: observedRefSchema(runtimeJobPredicateValueShape),
    run_session: observedRefSchema(runSessionPredicateValueShape),
    latest_capsule: observedRefSchema(latestCapsulePredicateValueShape),
    observed_at: isoDateTimeSchema,
  })
  .strict();
export type SessionRecoveryCandidatePredicate = z.infer<typeof sessionRecoveryCandidatePredicateSchema>;

export const planItemSessionDiagnosticsSchema = z
  .object({
    plan_item_id: nonEmpty,
    workflow_resolution: z.enum(['active_workflow', 'no_active_workflow', 'ambiguous_workflows']),
    workflow_id: nonEmpty.optional(),
    codex_session_id: nonEmpty.optional(),
    state: planItemSessionHealthStateSchema.optional(),
    severity: planItemSessionHealthSeveritySchema.optional(),
    summary: nonEmpty,
    operator_intervention_required: z.boolean(),
    normal_workflow_actions_available: z.boolean(),
    recovery_request_available: z.boolean(),
    latest_checkpoint: z
      .object({
        checkpoint_id: nonEmpty,
        created_at: isoDateTimeSchema,
        projection_digest: safeDigestSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PlanItemSessionDiagnostics = z.infer<typeof planItemSessionDiagnosticsSchema>;

export const operatorSessionHealthProjectionSchema = z
  .object({
    codex_session_id: nonEmpty,
    project_id: nonEmpty,
    organization_id: nonEmpty.optional(),
    state: planItemSessionHealthStateSchema,
    severity: planItemSessionHealthSeveritySchema,
    reason_code: nonEmpty.optional(),
    summary: nonEmpty,
    projection_digest: safeDigestSchema,
    checked_at: isoDateTimeSchema,
    recovery_available: z.boolean(),
    recovery_operation_labels: z.array(z.enum(['recover', 'mark_unrecoverable'])).default([]),
    operator_intervention_required: z.boolean(),
    normal_workflow_actions_available: z.boolean(),
    retention_risk: z.boolean(),
    lineage_risk: z.boolean(),
    latest_checkpoint: z
      .object({
        checkpoint_id: nonEmpty,
        created_at: isoDateTimeSchema,
        projection_digest: safeDigestSchema.optional(),
      })
      .strict()
      .optional(),
    retention_pins: z.array(capsuleRetentionPinSchema).default([]),
    candidate_predicate: sessionRecoveryCandidatePredicateSchema.optional(),
    workflow_id: nonEmpty.optional(),
    development_plan_id: nonEmpty.optional(),
    development_plan_item_id: nonEmpty.optional(),
    diagnostics: planItemSessionDiagnosticsSchema.optional(),
  })
  .strict();
export type OperatorSessionHealthProjection = z.infer<typeof operatorSessionHealthProjectionSchema>;

export const sessionOperationsFilterSchema = z
  .object({
    development_plan_id: nonEmpty.optional(),
    development_plan_item_id: nonEmpty.optional(),
    project_id: nonEmpty.optional(),
    workflow_id: nonEmpty.optional(),
    codex_session_id: nonEmpty.optional(),
    worker_id: nonEmpty.optional(),
    state: planItemSessionHealthStateSchema.optional(),
    severity: planItemSessionHealthSeveritySchema.optional(),
    recovered_state: z.enum(['recovered', 'unrecoverable']).optional(),
    health_states: z.array(planItemSessionHealthStateSchema).min(1).optional(),
    severities: z.array(planItemSessionHealthSeveritySchema).min(1).optional(),
    candidate_only: z.boolean().optional(),
    include_recovered: z.boolean().optional(),
    include_unrecoverable: z.boolean().optional(),
    min_lease_age_seconds: strictNonNegativeIntegerSchema.optional(),
    max_lease_age_seconds: strictNonNegativeIntegerSchema.optional(),
    limit: strictPositiveLimitSchema.optional(),
  })
  .strict()
  .superRefine((filters, ctx) => {
    if (
      filters.min_lease_age_seconds !== undefined &&
      filters.max_lease_age_seconds !== undefined &&
      filters.min_lease_age_seconds > filters.max_lease_age_seconds
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['max_lease_age_seconds'],
        message: 'max_lease_age_seconds must be greater than or equal to min_lease_age_seconds',
      });
    }
  });
export type SessionOperationsFilter = z.infer<typeof sessionOperationsFilterSchema>;

const coerceBooleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => (typeof value === 'boolean' ? value : value === 'true'));

export const sessionOperationsHealthQuerySchema = z
  .object({
    development_plan_id: nonEmpty.optional(),
    development_plan_item_id: nonEmpty.optional(),
    project_id: nonEmpty.optional(),
    workflow_id: nonEmpty.optional(),
    codex_session_id: nonEmpty.optional(),
    worker_id: nonEmpty.optional(),
    state: planItemSessionHealthStateSchema.optional(),
    severity: planItemSessionHealthSeveritySchema.optional(),
    recovered_state: z.enum(['recovered', 'unrecoverable']).optional(),
    candidate_only: coerceBooleanQuerySchema.optional(),
    include_recovered: coerceBooleanQuerySchema.optional(),
    include_unrecoverable: coerceBooleanQuerySchema.optional(),
    min_lease_age_seconds: strictNonNegativeIntegerSchema.optional(),
    max_lease_age_seconds: strictNonNegativeIntegerSchema.optional(),
    limit: strictPositiveLimitSchema.optional(),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (
      query.min_lease_age_seconds !== undefined &&
      query.max_lease_age_seconds !== undefined &&
      query.min_lease_age_seconds > query.max_lease_age_seconds
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['max_lease_age_seconds'],
        message: 'max_lease_age_seconds must be greater than or equal to min_lease_age_seconds',
      });
    }
  });
export type SessionOperationsHealthQuery = z.infer<typeof sessionOperationsHealthQuerySchema>;

export const recoverSessionRequestSchema = z
  .object({
    operation: z.enum(['recover', 'mark_unrecoverable']),
    reason: nonEmpty,
    operation_idempotency_key: nonEmpty,
    candidate_predicate: sessionRecoveryCandidatePredicateSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.operation_idempotency_key !== request.candidate_predicate.operation_idempotency_key) {
      ctx.addIssue({
        code: 'custom',
        path: ['operation_idempotency_key'],
        message: 'operation_idempotency_key must match candidate_predicate.operation_idempotency_key',
      });
    }
  });
export type RecoverSessionRequest = z.infer<typeof recoverSessionRequestSchema>;

export const sessionOperationsHealthResponseSchema = z
  .object({
    items: z.array(operatorSessionHealthProjectionSchema),
    filters: sessionOperationsFilterSchema,
  })
  .strict();
export type SessionOperationsHealthResponse = z.infer<typeof sessionOperationsHealthResponseSchema>;

const predicateSummarySchema = z
  .object({
    operation_idempotency_key: nonEmpty,
    projection_digest: safeDigestSchema,
    expected_health_state: planItemSessionHealthStateSchema,
    observed_at: isoDateTimeSchema,
    workflow_state: z.enum(['present', 'absent']),
    session_state: z.enum(['present', 'absent']),
    active_lease_state: z.enum(['present', 'absent']),
    pending_queued_action_state: z.enum(['present', 'absent']),
    latest_turn_state: z.enum(['present', 'absent']),
    runtime_job_state: z.enum(['present', 'absent']),
    run_session_state: z.enum(['present', 'absent']),
    latest_capsule_state: z.enum(['present', 'absent']),
  })
  .strict();

export const sessionRecoveryRecordDtoSchema = z
  .object({
    id: nonEmpty,
    codex_session_id: nonEmpty,
    operation: z.enum(['recover', 'scavenge', 'mark_unrecoverable']),
    result: z.enum(['applied', 'skipped', 'blocked']),
    result_code: nonEmpty,
    reason: nonEmpty,
    actor_id: nonEmpty,
    operation_idempotency_key: nonEmpty,
    before_state: planItemSessionHealthStateSchema,
    after_state: planItemSessionHealthStateSchema,
    before_projection_digest: safeDigestSchema,
    after_projection_digest: safeDigestSchema,
    affected_lease_ids: z.array(nonEmpty).default([]),
    affected_queued_action_ids: z.array(nonEmpty).default([]),
    affected_turn_ids: z.array(nonEmpty).default([]),
    affected_runtime_job_ids: z.array(nonEmpty).default([]),
    affected_run_session_ids: z.array(nonEmpty).default([]),
    affected_capsule_ids: z.array(nonEmpty).default([]),
    predicate_summary: predicateSummarySchema,
    object_event_id: nonEmpty.optional(),
    created_at: isoDateTimeSchema.optional(),
  })
  .strict();
export type SessionRecoveryRecordDto = z.infer<typeof sessionRecoveryRecordDtoSchema>;

export const sessionOperationsAuditResponseSchema = z
  .object({
    items: z.array(sessionRecoveryRecordDtoSchema),
  })
  .strict();
export type SessionOperationsAuditResponse = z.infer<typeof sessionOperationsAuditResponseSchema>;

export const recoverSessionResponseSchema = z
  .object({
    record: sessionRecoveryRecordDtoSchema,
    before: operatorSessionHealthProjectionSchema,
    after: operatorSessionHealthProjectionSchema,
    replayed: z.boolean(),
  })
  .strict();
export type RecoverSessionResponse = z.infer<typeof recoverSessionResponseSchema>;

export const scavengeSessionOperationsCandidateSchema = z
  .object({
    codex_session_id: nonEmpty,
    candidate_predicate: sessionRecoveryCandidatePredicateSchema,
  })
  .strict();
export type ScavengeSessionOperationsCandidate = z.infer<typeof scavengeSessionOperationsCandidateSchema>;

export const scavengeSessionOperationsRequestSchema = z
  .object({
    mode: z.enum(['dry_run', 'execute']).default('dry_run'),
    filters: sessionOperationsFilterSchema.optional(),
    reason: nonEmpty.optional(),
    operation_idempotency_key_prefix: nonEmpty.optional(),
    confirm_execute: z.boolean().optional(),
    candidates: z.array(scavengeSessionOperationsCandidateSchema).min(1).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.mode !== 'execute') {
      return;
    }

    if (request.reason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'execute scavenge requests require reason',
      });
    }

    if (request.operation_idempotency_key_prefix === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['operation_idempotency_key_prefix'],
        message: 'execute scavenge requests require operation_idempotency_key_prefix',
      });
    }

    if (request.confirm_execute !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirm_execute'],
        message: 'execute scavenge requests require confirm_execute true',
      });
    }

    if (request.candidates === undefined || request.candidates.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'execute scavenge requests require explicit candidates',
      });
    }
  });
export type ScavengeSessionOperationsRequest = z.infer<typeof scavengeSessionOperationsRequestSchema>;

export const scavengeSessionOperationsResponseSchema = z
  .object({
    mode: z.enum(['dry_run', 'execute']),
    candidates: z.array(operatorSessionHealthProjectionSchema).default([]),
    results: z.array(sessionRecoveryRecordDtoSchema).default([]),
  })
  .strict();
export type ScavengeSessionOperationsResponse = z.infer<typeof scavengeSessionOperationsResponseSchema>;
