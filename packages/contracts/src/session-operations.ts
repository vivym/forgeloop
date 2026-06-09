import { z } from 'zod';

import { productHrefSchema } from './api.js';
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
const coerceNonNegativeIntegerSchema = z.coerce.number().int().nonnegative();
const coercePositiveIntegerSchema = z.coerce.number().int().positive();

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
    pin_state: z.enum(['pinned', 'not_cleanable', 'unpinned_candidate', 'unknown']),
    referenced_by: z.array(nonEmpty),
  })
  .strict();
export type CapsuleRetentionPin = z.infer<typeof capsuleRetentionPinSchema>;

const workflowPredicateValueShape = {
  id: nonEmpty,
  development_plan_id: nonEmpty,
  development_plan_item_id: nonEmpty,
  status: planItemWorkflowStatusSchema,
  updated_at: isoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

const sessionPredicateValueShape = {
  id: nonEmpty,
  workflow_id: nonEmpty,
  status: codexSessionStatusSchema,
  role: codexSessionRoleSchema,
  worker_session_digest: safeDigestSchema.optional(),
  codex_thread_id_digest: safeDigestSchema.optional(),
  updated_at: isoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

const activeLeasePredicateValueShape = {
  id: nonEmpty,
  session_id: nonEmpty,
  status: codexSessionLeaseStatusSchema,
  worker_session_digest: safeDigestSchema.optional(),
  expires_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

const pendingQueuedActionPredicateValueShape = {
  id: nonEmpty,
  workflow_id: nonEmpty,
  kind: planItemWorkflowQueuedActionKindSchema,
  status: planItemWorkflowQueuedActionStatusSchema,
  idempotency_key: safeDigestSchema,
  codex_session_turn_id: nonEmpty.nullable(),
  expected_input_capsule_digest: safeDigestSchema.nullable(),
  updated_at: isoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

const latestTurnPredicateValueShape = {
  id: nonEmpty,
  session_id: nonEmpty,
  status: codexSessionTurnStatusSchema,
  input_capsule_digest: safeDigestSchema.optional(),
  output_capsule_digest: safeDigestSchema.optional(),
  updated_at: isoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

const runtimeJobPredicateValueShape = {
  id: nonEmpty,
  session_id: nonEmpty,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale', 'unknown']),
  worker_session_digest: safeDigestSchema.optional(),
  updated_at: isoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

const runSessionPredicateValueShape = {
  id: nonEmpty,
  status: nonEmpty,
  input_capsule_digest: safeDigestSchema.optional(),
  output_capsule_digest: safeDigestSchema.optional(),
  updated_at: isoDateTimeSchema.optional(),
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
    health_state: planItemSessionHealthStateSchema,
    severity: planItemSessionHealthSeveritySchema,
    summary: nonEmpty,
    observed_at: isoDateTimeSchema,
    blocker_codes: z.array(nonEmpty).default([]),
    recommended_action: nonEmpty.optional(),
    next_step_href: productHrefSchema.optional(),
  })
  .strict();
export type PlanItemSessionDiagnostics = z.infer<typeof planItemSessionDiagnosticsSchema>;

export const operatorSessionHealthProjectionSchema = z
  .object({
    workflow_id: nonEmpty,
    development_plan_id: nonEmpty,
    development_plan_item_id: nonEmpty,
    session_id: nonEmpty.optional(),
    health_state: planItemSessionHealthStateSchema,
    severity: planItemSessionHealthSeveritySchema,
    diagnostics: planItemSessionDiagnosticsSchema,
    candidate_predicate: sessionRecoveryCandidatePredicateSchema.optional(),
    observed_at: isoDateTimeSchema,
  })
  .strict();
export type OperatorSessionHealthProjection = z.infer<typeof operatorSessionHealthProjectionSchema>;

export const sessionOperationsFilterSchema = z
  .object({
    development_plan_id: nonEmpty.optional(),
    development_plan_item_id: nonEmpty.optional(),
    workflow_id: nonEmpty.optional(),
    session_id: nonEmpty.optional(),
    health_states: z.array(planItemSessionHealthStateSchema).optional(),
    severities: z.array(planItemSessionHealthSeveritySchema).optional(),
    candidate_only: z.boolean().optional(),
    include_recovered: z.boolean().optional(),
    include_unrecoverable: z.boolean().optional(),
    min_lease_age_seconds: coerceNonNegativeIntegerSchema.optional(),
    max_lease_age_seconds: coerceNonNegativeIntegerSchema.optional(),
    limit: coercePositiveIntegerSchema.optional(),
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
    workflow_id: nonEmpty.optional(),
    session_id: nonEmpty.optional(),
    health_state: planItemSessionHealthStateSchema.optional(),
    severity: planItemSessionHealthSeveritySchema.optional(),
    candidate_only: coerceBooleanQuerySchema.optional(),
    include_recovered: coerceBooleanQuerySchema.optional(),
    include_unrecoverable: coerceBooleanQuerySchema.optional(),
    min_lease_age_seconds: coerceNonNegativeIntegerSchema.optional(),
    max_lease_age_seconds: coerceNonNegativeIntegerSchema.optional(),
    limit: coercePositiveIntegerSchema.optional(),
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
    session_id: nonEmpty,
    reason: nonEmpty,
    operation_idempotency_key: nonEmpty,
    candidate_predicate: sessionRecoveryCandidatePredicateSchema,
  })
  .strict();
export type RecoverSessionRequest = z.infer<typeof recoverSessionRequestSchema>;

export const sessionOperationsHealthResponseSchema = z
  .object({
    generated_at: isoDateTimeSchema,
    filters: sessionOperationsFilterSchema.optional(),
    items: z.array(operatorSessionHealthProjectionSchema),
    total_count: nonNegativeIntegerSchema,
  })
  .strict();
export type SessionOperationsHealthResponse = z.infer<typeof sessionOperationsHealthResponseSchema>;

export const sessionRecoveryRecordDtoSchema = z
  .object({
    id: nonEmpty,
    workflow_id: nonEmpty,
    session_id: nonEmpty,
    operation_type: z.enum(['recover_session', 'scavenge_session_operations']),
    status: z.enum(['accepted', 'succeeded', 'failed', 'rejected', 'skipped']),
    reason: nonEmpty,
    operation_idempotency_key: nonEmpty,
    predicate_summary: z
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
      .strict(),
    created_at: isoDateTimeSchema,
    completed_at: isoDateTimeSchema.optional(),
    message: nonEmpty.optional(),
  })
  .strict();
export type SessionRecoveryRecordDto = z.infer<typeof sessionRecoveryRecordDtoSchema>;

export const sessionOperationsAuditResponseSchema = z
  .object({
    generated_at: isoDateTimeSchema,
    records: z.array(sessionRecoveryRecordDtoSchema),
    next_cursor: nonEmpty.optional(),
    has_more: z.boolean(),
  })
  .strict();
export type SessionOperationsAuditResponse = z.infer<typeof sessionOperationsAuditResponseSchema>;

export const recoverSessionResponseSchema = z
  .object({
    status: z.enum(['accepted', 'already_completed', 'rejected']),
    operation_id: nonEmpty,
    session_id: nonEmpty,
    operation_idempotency_key: nonEmpty,
    recovery_record: sessionRecoveryRecordDtoSchema.optional(),
    rejection_reason: nonEmpty.optional(),
  })
  .strict()
  .superRefine((response, ctx) => {
    if ((response.status === 'accepted' || response.status === 'already_completed') && response.recovery_record === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['recovery_record'],
        message: `${response.status} recover session responses require recovery_record`,
      });
    }

    if (response.status === 'rejected' && response.rejection_reason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rejection_reason'],
        message: 'rejected recover session responses require rejection_reason',
      });
    }
  });
export type RecoverSessionResponse = z.infer<typeof recoverSessionResponseSchema>;

export const scavengeSessionOperationsRequestSchema = z
  .object({
    mode: z.enum(['plan', 'execute']).default('plan'),
    filters: sessionOperationsFilterSchema.optional(),
    reason: nonEmpty.optional(),
    operation_idempotency_key_prefix: nonEmpty.optional(),
    confirm_execute: z.boolean().optional(),
    candidates: z.array(sessionRecoveryCandidatePredicateSchema).optional(),
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
    mode: z.enum(['plan', 'execute']),
    generated_at: isoDateTimeSchema,
    planned_candidates: z.array(operatorSessionHealthProjectionSchema).default([]),
    recovery_records: z.array(sessionRecoveryRecordDtoSchema).default([]),
    accepted_count: nonNegativeIntegerSchema,
    rejected_count: nonNegativeIntegerSchema,
    skipped_count: nonNegativeIntegerSchema,
  })
  .strict();
export type ScavengeSessionOperationsResponse = z.infer<typeof scavengeSessionOperationsResponseSchema>;
