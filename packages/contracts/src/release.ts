import { z } from 'zod';
import { jsonObjectSchema } from './executor.js';

const isoDateTimeSchema = z.string().datetime();
const trimmedNonEmptyStringSchema = z.string().trim().min(1);

export const releasePhases = ['draft', 'candidate', 'approval', 'rollout', 'observing', 'completed', 'closed'] as const;
export const releasePhaseSchema = z.enum(releasePhases);
export type ReleasePhase = z.infer<typeof releasePhaseSchema>;

export const releaseActivityStates = [
  'idle',
  'awaiting_human',
  'human_in_progress',
  'rolling_out',
  'paused',
  'blocked',
] as const;
export const releaseActivityStateSchema = z.enum(releaseActivityStates);
export type ReleaseActivityState = z.infer<typeof releaseActivityStateSchema>;

export const releaseGateStates = [
  'not_submitted',
  'awaiting_approval',
  'changes_requested',
  'approved',
  'rollout_failed',
  'rollout_succeeded',
] as const;
export const releaseGateStateSchema = z.enum(releaseGateStates);
export type ReleaseGateState = z.infer<typeof releaseGateStateSchema>;

export const releaseResolutions = ['none', 'completed', 'rolled_back', 'cancelled'] as const;
export const releaseResolutionSchema = z.enum(releaseResolutions);
export type ReleaseResolution = z.infer<typeof releaseResolutionSchema>;

export const releaseEvidenceTypes = [
  'test_report',
  'review_packet',
  'build',
  'deployment',
  'metric_snapshot',
  'rollback_record',
  'observation_note',
] as const;
export const releaseEvidenceTypeSchema = z.enum(releaseEvidenceTypes);
export type ReleaseEvidenceType = z.infer<typeof releaseEvidenceTypeSchema>;

export const releaseEvidenceObjectTypes = [
  'work_item',
  'execution_package',
  'run_session',
  'review_packet',
  'artifact',
  'decision',
  'release',
] as const;
export const releaseEvidenceObjectTypeSchema = z.enum(releaseEvidenceObjectTypes);
export type ReleaseEvidenceObjectType = z.infer<typeof releaseEvidenceObjectTypeSchema>;

export const releaseEvidenceRelationships = [
  'supports',
  'generated_by',
  'observed',
  'blocks',
  'rollback_of',
  'affected',
] as const;
export const releaseEvidenceRelationshipSchema = z.enum(releaseEvidenceRelationships);
export type ReleaseEvidenceRelationship = z.infer<typeof releaseEvidenceRelationshipSchema>;

export const releaseEvidenceObjectRefSchema = z
  .object({
    object_type: releaseEvidenceObjectTypeSchema,
    object_id: z.string().min(1),
    relationship: releaseEvidenceRelationshipSchema,
  })
  .strict();
export type ReleaseEvidenceObjectRef = z.infer<typeof releaseEvidenceObjectRefSchema>;

export const releaseEvidenceStatusSchema = z.enum(['current', 'stale', 'superseded']);
export type ReleaseEvidenceStatus = z.infer<typeof releaseEvidenceStatusSchema>;

const validateReleaseEvidenceObjectRef = (
  evidence: { evidence_type: ReleaseEvidenceType; object_ref?: ReleaseEvidenceObjectRef | undefined },
  ctx: z.RefinementCtx,
): void => {
  if (evidence.evidence_type === 'review_packet' && evidence.object_ref?.object_type !== 'review_packet') {
    ctx.addIssue({
      code: 'custom',
      path: ['object_ref', 'object_type'],
      message: 'review_packet evidence requires object_ref.object_type to be review_packet',
    });
  }
};

export const releaseEvidenceSchema = z
  .object({
    id: z.string().min(1),
    release_id: z.string().min(1),
    evidence_type: releaseEvidenceTypeSchema,
    summary: z.string().min(1),
    object_ref: releaseEvidenceObjectRefSchema.optional(),
    artifact_id: z.string().min(1).optional(),
    extra: jsonObjectSchema.optional(),
    redacted: z.boolean(),
    status: releaseEvidenceStatusSchema,
    created_at: isoDateTimeSchema,
  })
  .strict()
  .superRefine(validateReleaseEvidenceObjectRef);
export type ReleaseEvidence = z.infer<typeof releaseEvidenceSchema>;

export const releaseSchema = z
  .object({
    id: z.string().min(1),
    org_id: z.string().min(1),
    project_id: z.string().min(1),
    title: z.string().min(1),
    phase: releasePhaseSchema,
    activity_state: releaseActivityStateSchema,
    gate_state: releaseGateStateSchema,
    resolution: releaseResolutionSchema,
    work_item_ids: z.array(z.string().min(1)),
    execution_package_ids: z.array(z.string().min(1)),
    current_review_packet_ids: z.array(z.string().min(1)).optional(),
    current_run_session_ids: z.array(z.string().min(1)).optional(),
    scope_summary: trimmedNonEmptyStringSchema.optional(),
    rollout_strategy: trimmedNonEmptyStringSchema.optional(),
    rollback_plan: trimmedNonEmptyStringSchema.optional(),
    observation_plan: trimmedNonEmptyStringSchema.optional(),
    release_owner_actor_id: z.string().min(1).optional(),
    release_type: z.string().min(1).optional(),
    created_by_actor_id: z.string().min(1),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    updated_by_actor_id: z.string().min(1).optional(),
    closed_at: isoDateTimeSchema.optional(),
  })
  .strict();
export type Release = z.infer<typeof releaseSchema>;

export const releaseBlockerCodes = [
  'missing_work_item',
  'missing_execution_package',
  'empty_work_item_scope',
  'empty_execution_package_scope',
  'work_item_not_complete',
  'package_not_release_ready',
  'missing_approved_review_packet',
  'failed_required_check',
  'missing_required_artifact',
  'evidence_redacted',
  'stale_or_superseded_evidence',
  'missing_required_evidence_backlink',
  'unsafe_or_redacted_evidence_backlink',
  'missing_rollout_strategy',
  'missing_rollback_plan',
  'missing_observation_plan',
] as const;
export const releaseBlockerCodeSchema = z.enum(releaseBlockerCodes);
export type ReleaseBlockerCode = z.infer<typeof releaseBlockerCodeSchema>;

export const releaseBlockerSchema = z
  .object({
    code: releaseBlockerCodeSchema,
    category: z.enum(['structural', 'risk', 'evidence', 'planning']),
    overrideable: z.boolean(),
    message: z.string().min(1),
    object_type: z.string().min(1).optional(),
    object_id: z.string().min(1).optional(),
  })
  .strict();
export type ReleaseBlocker = z.infer<typeof releaseBlockerSchema>;

export const releaseBlockerSnapshotSchema = z
  .object({
    release_id: z.string().min(1),
    generated_at: isoDateTimeSchema,
    blocker_fingerprint: z.string().min(1),
    blockers: z.array(releaseBlockerSchema),
  })
  .strict();
export type ReleaseBlockerSnapshot = z.infer<typeof releaseBlockerSnapshotSchema>;

export const releaseDecisionIntentSchema = z
  .object({
    object_type: z.literal('release'),
    object_id: z.string().min(1),
    actor_id: z.string().min(1),
    decision_type: z.enum(['manual_override', 'release_approval', 'release_changes_requested', 'release_close']),
    outcome: z.enum(['approved', 'changes_requested', 'override_approved', 'rolled_back', 'cancelled', 'completed']),
    reason: z.string().min(1).optional(),
    blocker_snapshot: releaseBlockerSnapshotSchema.optional(),
  })
  .strict();
export type ReleaseDecisionIntent = z.infer<typeof releaseDecisionIntentSchema>;

export const releaseTypeSchema = z.enum(['normal', 'emergency']);
export type ReleaseType = z.infer<typeof releaseTypeSchema>;

export const createReleaseRequestSchema = z
  .object({
    actor_id: z.string().min(1),
    idempotency_key: z.string().min(1).optional(),
    project_id: z.string().min(1),
    title: z.string().min(1),
    release_owner_actor_id: z.string().min(1).optional(),
    release_type: releaseTypeSchema.default('normal'),
    scope_summary: trimmedNonEmptyStringSchema.optional(),
    rollout_strategy: trimmedNonEmptyStringSchema.optional(),
    rollback_plan: trimmedNonEmptyStringSchema.optional(),
    observation_plan: trimmedNonEmptyStringSchema.optional(),
  })
  .strict()
  .transform((request) => ({
    ...request,
    release_owner_actor_id: request.release_owner_actor_id ?? request.actor_id,
  }));
export type CreateReleaseRequest = z.infer<typeof createReleaseRequestSchema>;

export const releaseActorCommandRequestSchema = z
  .object({
    actor_id: z.string().min(1),
    idempotency_key: z.string().min(1).optional(),
  })
  .strict();
export type ReleaseActorCommandRequest = z.infer<typeof releaseActorCommandRequestSchema>;

export const patchReleaseRequestSchema = z
  .object({
    actor_id: z.string().min(1),
    idempotency_key: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    scope_summary: trimmedNonEmptyStringSchema.optional(),
    rollout_strategy: trimmedNonEmptyStringSchema.optional(),
    rollback_plan: trimmedNonEmptyStringSchema.optional(),
    observation_plan: trimmedNonEmptyStringSchema.optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.title !== undefined ||
      request.scope_summary !== undefined ||
      request.rollout_strategy !== undefined ||
      request.rollback_plan !== undefined ||
      request.observation_plan !== undefined,
    {
      message: 'PatchReleaseRequest requires at least one field',
    },
  );
export type PatchReleaseRequest = z.infer<typeof patchReleaseRequestSchema>;

export const publicReleaseSummarySchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1).optional(),
    org_id: z.string().min(1),
    project_id: z.string().min(1),
    title: z.string().min(1),
    scope_summary: trimmedNonEmptyStringSchema.optional(),
    release_owner_actor_id: z.string().min(1).optional(),
    release_type: z.string().min(1).optional(),
    phase: releasePhaseSchema,
    activity_state: releaseActivityStateSchema,
    gate_state: releaseGateStateSchema,
    resolution: releaseResolutionSchema,
    work_item_ids: z.array(z.string().min(1)),
    execution_package_ids: z.array(z.string().min(1)),
    rollout_strategy: trimmedNonEmptyStringSchema.optional(),
    rollback_plan: trimmedNonEmptyStringSchema.optional(),
    observation_plan: trimmedNonEmptyStringSchema.optional(),
    created_by_actor_id: z.string().min(1),
    updated_by_actor_id: z.string().min(1).optional(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    closed_at: isoDateTimeSchema.optional(),
  })
  .strict();
export type PublicReleaseSummary = z.infer<typeof publicReleaseSummarySchema>;

export const releaseListQuerySchema = z
  .object({
    project_id: z.string().min(1),
    release_owner_actor_id: z.string().min(1).optional(),
    phase: releasePhaseSchema.optional(),
    gate_state: releaseGateStateSchema.optional(),
    resolution: releaseResolutionSchema.optional(),
    limit: z.coerce.number().int().positive().max(100).default(50),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type ReleaseListQuery = z.infer<typeof releaseListQuerySchema>;

export const releaseResourceQuerySchema = z
  .object({
    project_id: z.string().min(1),
  })
  .strict();
export type ReleaseResourceQuery = z.infer<typeof releaseResourceQuerySchema>;

export const releaseListResponseSchema = z
  .object({
    releases: z.array(publicReleaseSummarySchema),
    next_cursor: z.string().min(1).optional(),
  })
  .strict();
export type ReleaseListResponse = z.infer<typeof releaseListResponseSchema>;

export const releaseResourceResponseSchema = z
  .object({
    release: publicReleaseSummarySchema,
  })
  .strict();
export type ReleaseResourceResponse = z.infer<typeof releaseResourceResponseSchema>;

export const releaseControlResponseSchema = z
  .object({
    release: publicReleaseSummarySchema,
    blocker_snapshot: releaseBlockerSnapshotSchema,
    blockers: z.array(releaseBlockerSchema).default([]),
    overridden_blockers: z.array(releaseBlockerSchema).default([]),
    decision_intents: z.array(releaseDecisionIntentSchema).default([]),
    next_actions: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type ReleaseControlResponse = z.infer<typeof releaseControlResponseSchema>;

export const linkReleaseObjectResponseSchema = z
  .object({
    release_id: z.string().min(1),
    object_type: z.enum(['work_item', 'execution_package']),
    object_id: z.string().min(1),
    linked: z.boolean(),
  })
  .strict();
export type LinkReleaseObjectResponse = z.infer<typeof linkReleaseObjectResponseSchema>;

export const linkReleaseObjectRequestSchema = releaseActorCommandRequestSchema;
export type LinkReleaseObjectRequest = z.infer<typeof linkReleaseObjectRequestSchema>;

export const unlinkReleaseObjectRequestSchema = releaseActorCommandRequestSchema;
export type UnlinkReleaseObjectRequest = z.infer<typeof unlinkReleaseObjectRequestSchema>;

export const submitReleaseForApprovalRequestSchema = releaseActorCommandRequestSchema;
export type SubmitReleaseForApprovalRequest = z.infer<typeof submitReleaseForApprovalRequestSchema>;

export const approveReleaseRequestSchema = releaseActorCommandRequestSchema.extend({
  rationale: z.string().min(1).optional(),
});
export type ApproveReleaseRequest = z.infer<typeof approveReleaseRequestSchema>;

export const overrideApproveReleaseRequestSchema = releaseActorCommandRequestSchema.extend({
  rationale: z.string().trim().min(1),
  blocker_snapshot: releaseBlockerSnapshotSchema,
});
export type OverrideApproveReleaseRequest = z.infer<typeof overrideApproveReleaseRequestSchema>;

export const requestReleaseChangesRequestSchema = releaseActorCommandRequestSchema.extend({
  rationale: z.string().trim().min(1),
});
export type RequestReleaseChangesRequest = z.infer<typeof requestReleaseChangesRequestSchema>;

export const startReleaseObservingRequestSchema = releaseActorCommandRequestSchema;
export type StartReleaseObservingRequest = z.infer<typeof startReleaseObservingRequestSchema>;

export const closeReleaseRequestSchema = releaseActorCommandRequestSchema.extend({
  resolution: z.enum(['completed', 'rolled_back', 'cancelled']),
  summary: z.string().min(1).optional(),
  override_without_observation: z.boolean().default(false),
  override_rationale: z.string().trim().min(1).optional(),
}).superRefine((request, ctx) => {
  if (
    request.resolution === 'completed' &&
    request.override_without_observation &&
    request.override_rationale === undefined
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['override_rationale'],
      message: 'override_rationale is required when completing without observation evidence',
    });
  }
});
export type CloseReleaseRequest = z.infer<typeof closeReleaseRequestSchema>;

const releaseEvidenceObservationLinkSchema = z
  .object({
    object_type: releaseEvidenceObjectTypeSchema,
    object_id: z.string().min(1),
    relationship: releaseEvidenceRelationshipSchema,
  })
  .strict();

const releaseEvidenceObservationExtraSchema = z
  .object({
    source: z.enum(['human', 'script']),
    severity: z.enum(['info', 'warning', 'failure']),
    summary: z.string().min(1),
    observed_at: isoDateTimeSchema,
    actor_id: z.string().min(1).optional(),
    links: z.array(releaseEvidenceObservationLinkSchema).optional(),
    metrics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const releaseEvidenceExtraSchema = z
  .object({
    observation: releaseEvidenceObservationExtraSchema.optional(),
    deployment: jsonObjectSchema.optional(),
    rollback: jsonObjectSchema.optional(),
    build: jsonObjectSchema.optional(),
    check_refs: z.array(jsonObjectSchema).optional(),
  })
  .strict();

export const createReleaseEvidenceRequestSchema = z
  .object({
    actor_id: z.string().min(1),
    idempotency_key: z.string().min(1).optional(),
    evidence_type: releaseEvidenceTypeSchema,
    summary: z.string().min(1),
    object_ref: releaseEvidenceObjectRefSchema.optional(),
    artifact_id: z.string().min(1).optional(),
    extra: releaseEvidenceExtraSchema.optional(),
    redacted: z.boolean().default(false),
    status: releaseEvidenceStatusSchema.default('current'),
  })
  .strict()
  .superRefine(validateReleaseEvidenceObjectRef);
export type CreateReleaseEvidenceRequest = z.infer<typeof createReleaseEvidenceRequestSchema>;

export const releaseCockpitResponseSchema = z
  .object({
    release: publicReleaseSummarySchema,
    blocker_snapshot: releaseBlockerSnapshotSchema,
    blockers: z.array(releaseBlockerSchema),
    next_actions: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type ReleaseCockpitResponse = z.infer<typeof releaseCockpitResponseSchema>;
