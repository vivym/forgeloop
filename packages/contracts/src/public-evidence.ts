import { z } from 'zod';

import {
  publicArtifactKindSchema,
  publicArtifactRefSchema,
} from './public-artifacts.js';
import { publicMetricsSchema, publicScalarSchema } from './public-evidence-safety.js';
import {
  releaseEvidenceObjectTypeSchema,
  releaseEvidenceRelationshipSchema,
  releaseEvidenceObjectRefSchema,
  releaseEvidenceStatusSchema,
  releaseEvidenceTypeSchema,
} from './release.js';

export {
  isLocalReferenceString,
  isPublicArtifactStorageUri,
  publicArtifactKindSchema,
  publicArtifactRefSchema,
} from './public-artifacts.js';
export type { PublicArtifactKind, PublicArtifactRef } from './public-artifacts.js';
export {
  isUnsafePublicEvidenceKey,
  normalizePublicEvidenceKey,
  publicMetricsSchema,
  publicScalarSchema,
} from './public-evidence-safety.js';
export type { PublicMetrics, PublicScalar } from './public-evidence-safety.js';

const isoDateTimeSchema = z.string().datetime();

const actorTypeSchema = z.enum(['human', 'ai', 'system']);

const publicDecisionTypeSchema = z.string().min(1);

const publicDecisionOutcomeSchema = z.string().min(1);

export const publicDecisionSchema = z
  .object({
    id: z.string().min(1),
    object_type: z.string().min(1),
    object_id: z.string().min(1),
    actor_id: z.string().min(1),
    decided_by_actor_id: z.string().min(1).optional(),
    decision_type: publicDecisionTypeSchema.optional(),
    outcome: publicDecisionOutcomeSchema.optional(),
    decision: z.enum([
      'approved',
      'changes_requested',
      'need_more_context',
      'escalate',
      'rejected',
      'override_approved',
      'rolled_back',
      'cancelled',
      'completed',
    ]),
    summary: z.string().min(1),
    rationale: z.string().min(1).optional(),
    created_at: isoDateTimeSchema,
  })
  .strict();
export type PublicDecision = z.infer<typeof publicDecisionSchema>;

const publicStringArraySchema = z.array(z.string().min(1));

export const publicObjectEventPayloadSchema = z
  .object({
    release_id: z.string().min(1).optional(),
    work_item_id: z.string().min(1).optional(),
    execution_package_id: z.string().min(1).optional(),
    run_session_id: z.string().min(1).optional(),
    review_packet_id: z.string().min(1).optional(),
    spec_id: z.string().min(1).optional(),
    spec_revision_id: z.string().min(1).optional(),
    plan_id: z.string().min(1).optional(),
    plan_revision_id: z.string().min(1).optional(),
    artifact_id: z.string().min(1).optional(),
    decision_id: z.string().min(1).optional(),
    trace_event_id: z.string().min(1).optional(),
    command_id: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    from_status: z.string().min(1).optional(),
    to_status: z.string().min(1).optional(),
    phase: z.string().min(1).optional(),
    activity_state: z.string().min(1).optional(),
    gate_state: z.string().min(1).optional(),
    resolution: z.string().min(1).optional(),
    outcome: z.string().min(1).optional(),
    decision: z.string().min(1).optional(),
    result: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    workflow_only: z.boolean().optional(),
    executor_type: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    blocker_codes: publicStringArraySchema.optional(),
    required_check_ids: publicStringArraySchema.optional(),
    failed_check_ids: publicStringArraySchema.optional(),
    missing_artifact_kinds: z.array(publicArtifactKindSchema).optional(),
  })
  .strict();
export type PublicObjectEventPayload = z.infer<typeof publicObjectEventPayloadSchema>;

export const publicObjectEventSchema = z
  .object({
    id: z.string().min(1),
    object_type: z.string().min(1),
    object_id: z.string().min(1),
    event_type: z.string().min(1),
    actor_type: actorTypeSchema.optional(),
    actor_id: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    payload: publicObjectEventPayloadSchema,
    created_at: isoDateTimeSchema,
  })
  .strict();
export type PublicObjectEvent = z.infer<typeof publicObjectEventSchema>;

export const publicStatusHistoryContextSchema = z
  .object({
    release_id: z.string().min(1).optional(),
    work_item_id: z.string().min(1).optional(),
    execution_package_id: z.string().min(1).optional(),
    run_session_id: z.string().min(1).optional(),
    review_packet_id: z.string().min(1).optional(),
    actor_id: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    blocker_codes: publicStringArraySchema.optional(),
    required_check_ids: publicStringArraySchema.optional(),
    failed_check_ids: publicStringArraySchema.optional(),
    missing_artifact_kinds: z.array(publicArtifactKindSchema).optional(),
    previous_value: publicScalarSchema.optional(),
    next_value: publicScalarSchema.optional(),
  })
  .strict();
export type PublicStatusHistoryContext = z.infer<typeof publicStatusHistoryContextSchema>;

export const publicStatusHistorySchema = z
  .object({
    id: z.string().min(1),
    object_type: z.string().min(1),
    object_id: z.string().min(1),
    field_name: z.string().min(1).optional(),
    from_status: z.string().min(1).optional(),
    to_status: z.string().min(1),
    from_value: z.string().min(1).optional(),
    to_value: z.string().min(1).optional(),
    actor_type: actorTypeSchema.optional(),
    actor_id: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    context: publicStatusHistoryContextSchema,
    created_at: isoDateTimeSchema,
  })
  .strict();
export type PublicStatusHistory = z.infer<typeof publicStatusHistorySchema>;

export const publicReleaseEvidenceObservationLinkSchema = z
  .object({
    object_type: releaseEvidenceObjectTypeSchema,
    object_id: z.string().min(1),
    relationship: releaseEvidenceRelationshipSchema,
  })
  .strict();
export type PublicReleaseEvidenceObservationLink = z.infer<typeof publicReleaseEvidenceObservationLinkSchema>;

const publicReleaseEvidenceObservationSchema = z
  .object({
    source: z.enum(['human', 'script']),
    severity: z.enum(['info', 'warning', 'failure']),
    summary: z.string().min(1),
    observed_at: isoDateTimeSchema,
    actor_id: z.string().min(1).optional(),
    links: z.array(publicReleaseEvidenceObservationLinkSchema).optional(),
    metrics: publicMetricsSchema.optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const publicReleaseEvidenceDeploymentSchema = z
  .object({
    environment: z.string().min(1),
    result: z.enum(['succeeded', 'failed', 'cancelled', 'in_progress']),
    deployment_id: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    started_at: isoDateTimeSchema.optional(),
    completed_at: isoDateTimeSchema.optional(),
    actor_id: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const publicReleaseEvidenceRollbackSchema = z
  .object({
    result: z.enum(['succeeded', 'failed', 'cancelled', 'not_required']),
    reason: z.string().min(1).optional(),
    rollback_id: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    started_at: isoDateTimeSchema.optional(),
    completed_at: isoDateTimeSchema.optional(),
    actor_id: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const publicReleaseEvidenceBuildSchema = z
  .object({
    build_id: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    commit_sha: z.string().min(1).optional(),
    source_branch: z.string().min(1).optional(),
    result: z.enum(['succeeded', 'failed', 'cancelled', 'in_progress']).optional(),
    started_at: isoDateTimeSchema.optional(),
    completed_at: isoDateTimeSchema.optional(),
    artifact_id: z.string().min(1).optional(),
    artifact: publicArtifactRefSchema.optional(),
  })
  .strict();

const publicReleaseEvidenceCheckRefSchema = z
  .object({
    check_id: z.string().min(1),
    status: z.enum(['succeeded', 'failed', 'skipped']),
    summary: z.string().min(1).optional(),
    artifact_id: z.string().min(1).optional(),
    artifact: publicArtifactRefSchema.optional(),
  })
  .strict();

export const publicReleaseEvidenceExtraSchema = z
  .object({
    observation: publicReleaseEvidenceObservationSchema.optional(),
    deployment: publicReleaseEvidenceDeploymentSchema.optional(),
    rollback: publicReleaseEvidenceRollbackSchema.optional(),
    build: publicReleaseEvidenceBuildSchema.optional(),
    check_refs: z.array(publicReleaseEvidenceCheckRefSchema).optional(),
  })
  .strict();
export type PublicReleaseEvidenceExtra = z.infer<typeof publicReleaseEvidenceExtraSchema>;

export const publicReleaseEvidenceSchema = z
  .object({
    id: z.string().min(1),
    release_id: z.string().min(1),
    evidence_type: releaseEvidenceTypeSchema,
    summary: z.string().min(1),
    object_ref: releaseEvidenceObjectRefSchema.optional(),
    artifact_id: z.string().min(1).optional(),
    artifact: publicArtifactRefSchema.optional(),
    extra: publicReleaseEvidenceExtraSchema,
    redacted: z.boolean(),
    status: releaseEvidenceStatusSchema,
    created_at: isoDateTimeSchema,
    created_by_actor_id: z.string().min(1).optional(),
  })
  .strict();
export type PublicReleaseEvidence = z.infer<typeof publicReleaseEvidenceSchema>;

const publicReplayEntryBaseSchema = z.object({
  id: z.string().min(1),
  object_type: z.string().min(1),
  object_id: z.string().min(1),
  summary: z.string().min(1),
  created_at: isoDateTimeSchema,
});

export const publicReplayEntrySchema = z.discriminatedUnion('source', [
  publicReplayEntryBaseSchema
    .extend({
      source: z.literal('object_event'),
      payload: publicObjectEventSchema,
    })
    .strict(),
  publicReplayEntryBaseSchema
    .extend({
      source: z.literal('status_history'),
      payload: publicStatusHistorySchema,
    })
    .strict(),
  publicReplayEntryBaseSchema
    .extend({
      source: z.literal('decision'),
      payload: publicDecisionSchema,
    })
    .strict(),
  publicReplayEntryBaseSchema
    .extend({
      source: z.literal('artifact'),
      payload: publicArtifactRefSchema,
    })
    .strict(),
  publicReplayEntryBaseSchema
    .extend({
      source: z.literal('release_evidence'),
      payload: publicReleaseEvidenceSchema,
    })
    .strict(),
]);
export type PublicReplayEntry = z.infer<typeof publicReplayEntrySchema>;
