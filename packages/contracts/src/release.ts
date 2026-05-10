import { z } from 'zod';

const isoDateTimeSchema = z.string().datetime();

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
] as const;
export const releaseEvidenceObjectTypeSchema = z.enum(releaseEvidenceObjectTypes);
export type ReleaseEvidenceObjectType = z.infer<typeof releaseEvidenceObjectTypeSchema>;

export const releaseEvidenceRelationships = [
  'supports',
  'generated_by',
  'observed',
  'blocks',
  'rollback_of',
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

export const releaseEvidenceSchema = z
  .object({
    id: z.string().min(1),
    release_id: z.string().min(1),
    evidence_type: releaseEvidenceTypeSchema,
    summary: z.string().min(1),
    object_ref: releaseEvidenceObjectRefSchema,
    redacted: z.boolean(),
    status: releaseEvidenceStatusSchema,
    created_at: isoDateTimeSchema,
  })
  .strict();
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
    rollout_strategy: z.string().min(1).optional(),
    rollback_plan: z.string().min(1).optional(),
    observation_plan: z.string().min(1).optional(),
    created_by_actor_id: z.string().min(1),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
    closed_at: isoDateTimeSchema.optional(),
  })
  .strict();
export type Release = z.infer<typeof releaseSchema>;

export const releaseBlockerCodes = [
  'missing_work_item',
  'missing_execution_package',
  'empty_release_scope',
  'work_item_not_complete',
  'package_not_release_ready',
  'missing_approved_review_packet',
  'failed_required_check',
  'missing_required_artifact',
  'evidence_redacted',
  'stale_or_superseded_evidence',
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
    decision_type: z.enum(['manual_override', 'release_approval']),
    outcome: z.enum(['approved', 'override_approved']),
    reason: z.string().min(1).optional(),
    blocker_snapshot: releaseBlockerSnapshotSchema.optional(),
  })
  .strict();
export type ReleaseDecisionIntent = z.infer<typeof releaseDecisionIntentSchema>;

export const createReleaseRequestSchema = z
  .object({
    project_id: z.string().min(1),
    title: z.string().min(1),
    created_by_actor_id: z.string().min(1),
    work_item_ids: z.array(z.string().min(1)).default([]),
    execution_package_ids: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type CreateReleaseRequest = z.infer<typeof createReleaseRequestSchema>;

export const patchReleaseRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    rollout_strategy: z.string().min(1).optional(),
    rollback_plan: z.string().min(1).optional(),
    observation_plan: z.string().min(1).optional(),
  })
  .strict()
  .refine((request) => Object.keys(request).length > 0, {
    message: 'PatchReleaseRequest requires at least one field',
  });
export type PatchReleaseRequest = z.infer<typeof patchReleaseRequestSchema>;

export const releaseControlResponseSchema = z
  .object({
    release: releaseSchema,
    blocker_snapshot: releaseBlockerSnapshotSchema,
    decision_intents: z.array(releaseDecisionIntentSchema).default([]),
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

export const releaseActorCommandRequestSchema = z
  .object({
    actor_id: z.string().min(1),
    idempotency_key: z.string().min(1).optional(),
  })
  .strict();
export type ReleaseActorCommandRequest = z.infer<typeof releaseActorCommandRequestSchema>;

export const overrideApproveReleaseRequestSchema = releaseActorCommandRequestSchema.extend({
  rationale: z.string().trim().min(1),
  blocker_snapshot: releaseBlockerSnapshotSchema,
});
export type OverrideApproveReleaseRequest = z.infer<typeof overrideApproveReleaseRequestSchema>;

export const closeReleaseRequestSchema = releaseActorCommandRequestSchema.extend({
  resolution: z.enum(['completed', 'rolled_back', 'cancelled']),
  summary: z.string().min(1).optional(),
});
export type CloseReleaseRequest = z.infer<typeof closeReleaseRequestSchema>;

export const createReleaseEvidenceRequestSchema = z
  .object({
    evidence_type: releaseEvidenceTypeSchema,
    summary: z.string().min(1),
    object_ref: releaseEvidenceObjectRefSchema,
    redacted: z.boolean().default(false),
    status: releaseEvidenceStatusSchema.default('current'),
  })
  .strict();
export type CreateReleaseEvidenceRequest = z.infer<typeof createReleaseEvidenceRequestSchema>;
