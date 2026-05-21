import { z } from 'zod';

import { productActionSchema, productLaneIdSchema, productObjectTypeSchema } from './api.js';
import { artifactKindSchema, jsonObjectSchema } from './executor.js';
import { publicArtifactRefSchema } from './public-artifacts.js';
import {
  independentAiReviewResultSchema,
  reviewDecisionSchema,
  reviewPacketStatusSchema,
  reviewPacketTestMappingSchema,
} from './review.js';
import { workItemIntakeContextSchema } from './work-item-intake.js';

const isoDateTimeSchema = z.string().datetime();
const nonEmpty = z.string().trim().min(1);

export const workItemKindSchema = z.enum(['initiative', 'requirement', 'bug', 'tech_debt']);
export const deliveryOverallStateSchema = z.enum([
  'not_started',
  'blocked',
  'in_progress',
  'ready_for_release',
  'released',
]);
export const deliveryStageIdSchema = z.enum([
  'spec',
  'plan',
  'packages',
  'execution',
  'review',
  'integration_readiness',
  'quality_gate',
  'release_readiness',
]);
export const deliveryStageStateSchema = z.enum([
  'missing',
  'blocked',
  'ready',
  'running',
  'passed',
  'failed',
  'not_applicable',
]);
export const degradedSourceKeySchema = z.enum([
  'work_item',
  'spec',
  'spec_revision',
  'plan',
  'plan_revision',
  'execution_packages',
  'package_dependencies',
  'run_sessions',
  'review_packets',
  'integration_readiness',
  'release_scope',
  'release_blockers',
  'release_test_acceptance',
  'decisions',
]);

const publicCockpitCheckResultSchema = z
  .object({
    check_id: nonEmpty,
    command: nonEmpty,
    status: z.enum(['succeeded', 'failed', 'cancelled', 'timed_out', 'skipped']),
    exit_code: z.number().int().nullable(),
    duration_seconds: z.number().nonnegative(),
    blocks_review: z.boolean(),
    stdout: publicArtifactRefSchema.optional(),
    stderr: publicArtifactRefSchema.optional(),
  })
  .strict()
  .superRefine((checkResult, ctx) => {
    if (checkResult.status === 'succeeded' && checkResult.exit_code !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['exit_code'],
        message: 'succeeded checks require exit_code 0',
      });
    }

    if (checkResult.status === 'failed' && (checkResult.exit_code === null || checkResult.exit_code === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['exit_code'],
        message: 'failed checks require a non-zero exit_code',
      });
    }

    if (
      (checkResult.status === 'skipped' || checkResult.status === 'cancelled') &&
      checkResult.exit_code !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['exit_code'],
        message: `${checkResult.status} checks require exit_code null`,
      });
    }

    if (checkResult.status === 'timed_out' && checkResult.exit_code === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['exit_code'],
        message: 'timed_out checks require exit_code null or non-zero',
      });
    }
  });

export const deliveryObjectRefSchema = z
  .object({
    object_type: productObjectTypeSchema,
    object_id: nonEmpty,
    href: nonEmpty.optional(),
    title: nonEmpty.optional(),
  })
  .strict();

export const deliveryEvidenceSchema = z
  .object({
    id: nonEmpty,
    label: nonEmpty,
    summary: nonEmpty.optional(),
    stage_id: deliveryStageIdSchema.optional(),
    object_ref: deliveryObjectRefSchema.optional(),
    artifact_kind: artifactKindSchema.optional(),
    check_result: publicCockpitCheckResultSchema.optional(),
    review_packet_status: reviewPacketStatusSchema.optional(),
    review_decision: reviewDecisionSchema.optional(),
    metadata: jsonObjectSchema.optional(),
    created_at: isoDateTimeSchema.optional(),
  })
  .strict();

export const deliveryBlockerSchema = z
  .object({
    id: nonEmpty,
    code: nonEmpty.optional(),
    label: nonEmpty,
    summary: nonEmpty.optional(),
    stage_id: deliveryStageIdSchema.optional(),
    owner_lane: productLaneIdSchema.optional(),
    object_ref: deliveryObjectRefSchema.optional(),
    severity: z.enum(['info', 'warning', 'blocking']).default('blocking'),
    metadata: jsonObjectSchema.optional(),
    created_at: isoDateTimeSchema.optional(),
  })
  .strict();

export const deliveryStageSchema = z
  .object({
    id: deliveryStageIdSchema,
    label: nonEmpty,
    state: deliveryStageStateSchema,
    owner_lane: productLaneIdSchema.optional(),
    object_refs: z.array(deliveryObjectRefSchema).default([]),
    blockers: z.array(deliveryBlockerSchema).default([]),
    evidence_refs: z.array(deliveryObjectRefSchema).default([]),
    primary_action: productActionSchema.optional(),
    updated_at: isoDateTimeSchema.optional(),
  })
  .strict();

export const workItemDeliveryReadinessSchema = z
  .object({
    work_item_id: nonEmpty,
    work_item_kind: workItemKindSchema,
    active_lane: productLaneIdSchema,
    overall_state: deliveryOverallStateSchema,
    stages: z.array(deliveryStageSchema),
    blockers: z.array(deliveryBlockerSchema).default([]),
    evidence: z.array(deliveryEvidenceSchema).default([]),
    next_actions: z.array(productActionSchema).default([]),
    degraded_sources: z.array(degradedSourceKeySchema).default([]),
    generated_at: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((readiness, ctx) => {
    const actionIds = new Set<string>();

    readiness.next_actions.forEach((action, index) => {
      if (actionIds.has(action.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['next_actions', index, 'id'],
          message: `product action id must be unique within Work Item delivery readiness: ${action.id}`,
        });
      }
      actionIds.add(action.id);

      if (action.lane_id !== readiness.active_lane) {
        ctx.addIssue({
          code: 'custom',
          path: ['next_actions', index, 'lane_id'],
          message: 'action lane_id must match readiness active_lane',
        });
      }

      if (action.kind === 'command' && action.command.work_item_id !== readiness.work_item_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['next_actions', index, 'command', 'work_item_id'],
          message: 'command work_item_id must match readiness work_item_id',
        });
      }
    });
  });

const workItemCockpitWorkItemSchema = z
  .object({
    id: nonEmpty,
    project_id: nonEmpty,
    kind: workItemKindSchema,
    title: nonEmpty,
    goal: z.string(),
    success_criteria: z.array(z.string()),
    priority: nonEmpty,
    risk: nonEmpty,
    driver_actor_id: nonEmpty,
    intake_context: workItemIntakeContextSchema,
    phase: nonEmpty,
    activity_state: nonEmpty,
    gate_state: nonEmpty,
    resolution: nonEmpty,
    current_spec_id: nonEmpty.optional(),
    current_plan_id: nonEmpty.optional(),
    created_at: isoDateTimeSchema.optional(),
    updated_at: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((workItem, ctx) => {
    if (workItem.kind !== workItem.intake_context.type) {
      ctx.addIssue({
        code: 'custom',
        path: ['intake_context', 'type'],
        message: 'intake_context type must match kind',
      });
    }
  });

const cockpitSpecPlanSchema = z
  .object({
    id: nonEmpty,
    work_item_id: nonEmpty,
    entity_type: z.enum(['spec', 'plan']),
    status: nonEmpty,
    editing_state: nonEmpty,
    gate_state: nonEmpty,
    resolution: nonEmpty,
    current_revision_id: nonEmpty.optional(),
    approved_revision_id: nonEmpty.optional(),
    approved_at: isoDateTimeSchema.optional(),
    approved_by_actor_id: nonEmpty.optional(),
    created_at: isoDateTimeSchema.optional(),
    updated_at: isoDateTimeSchema.optional(),
  })
  .strict();

const cockpitRequiredCheckSchema = z
  .object({
    check_id: nonEmpty,
    display_name: nonEmpty,
    command: nonEmpty,
    timeout_seconds: z.number().int().positive(),
    blocks_review: z.boolean(),
  })
  .strict();

const publicRuntimeMetadataSchema = z
  .object({
    durability_mode: z.enum(['durable', 'volatile_demo']).optional(),
    driver_kind: z.enum(['app_server', 'exec_fallback', 'fake']).optional(),
    driver_status: z
      .enum(['not_started', 'starting', 'active', 'waiting_for_input', 'stalled', 'terminal'])
      .optional(),
    last_event_at: isoDateTimeSchema.optional(),
    recovery_attempt_count: z.number().int().nonnegative().optional(),
  })
  .strict();

const publicCockpitChangedFileSchema = z
  .object({
    repo_id: z.string().min(1),
    path: z.string().min(1),
    change_kind: z.enum(['added', 'modified', 'deleted', 'renamed']),
    previous_path: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((changedFile, ctx) => {
    if (changedFile.change_kind === 'renamed' && !changedFile.previous_path) {
      ctx.addIssue({
        code: 'custom',
        path: ['previous_path'],
        message: 'previous_path is required for renamed files',
      });
    }

    if (changedFile.change_kind === 'renamed' && changedFile.previous_path === changedFile.path) {
      ctx.addIssue({
        code: 'custom',
        path: ['previous_path'],
        message: 'previous_path must differ from path for renamed files',
      });
    }

    if (changedFile.change_kind !== 'renamed' && changedFile.previous_path !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['previous_path'],
        message: 'previous_path is only allowed for renamed files',
      });
    }
  });

const publicCockpitRequestedChangeSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    file_path: z.string().min(1).optional(),
    severity: z.enum(['minor', 'major', 'critical']).optional(),
    suggested_validation: z.string().min(1).optional(),
  })
  .strict();

const publicCockpitSelfReviewResultSchema = z
  .object({
    status: z.enum(['succeeded', 'failed']),
    summary: z.string().min(1),
    spec_plan_alignment: z.string().min(1),
    test_assessment: z.string().min(1),
    risk_notes: z.array(z.string().min(1)),
    follow_up_questions: z.array(z.string().min(1)),
    failure_message: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.status === 'failed' && !result.failure_message) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure_message'],
        message: 'failure_message is required when self-review status is failed',
      });
    }

    if (result.status !== 'failed' && result.failure_message !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure_message'],
        message: 'failure_message is only allowed when self-review status is failed',
      });
    }
  });

const cockpitExecutionPackageSchema = z
  .object({
    id: nonEmpty,
    work_item_id: nonEmpty,
    spec_id: nonEmpty.optional(),
    spec_revision_id: nonEmpty.optional(),
    plan_id: nonEmpty.optional(),
    plan_revision_id: nonEmpty.optional(),
    project_id: nonEmpty.optional(),
    repo_id: nonEmpty,
    objective: nonEmpty,
    owner_actor_id: nonEmpty,
    reviewer_actor_id: nonEmpty,
    qa_owner_actor_id: nonEmpty,
    phase: nonEmpty,
    activity_state: nonEmpty,
    gate_state: nonEmpty,
    resolution: nonEmpty,
    required_checks: z.array(cockpitRequiredCheckSchema),
    required_artifact_kinds: z.array(artifactKindSchema),
    allowed_paths: z.array(z.string()),
    forbidden_paths: z.array(z.string()),
    version: z.number().int(),
    last_run_session_id: nonEmpty.optional(),
    last_failure_summary: nonEmpty.optional(),
    blocked_reason: nonEmpty.optional(),
    created_at: isoDateTimeSchema.optional(),
    updated_at: isoDateTimeSchema.optional(),
  })
  .strict();

const cockpitRunSessionSchema = z
  .object({
    id: nonEmpty,
    execution_package_id: nonEmpty,
    requested_by_actor_id: nonEmpty,
    status: nonEmpty,
    executor_type: z.enum(['mock', 'local_codex']).optional(),
    changed_files: z.array(publicCockpitChangedFileSchema).optional(),
    check_results: z.array(publicCockpitCheckResultSchema).optional(),
    artifacts: z.array(publicArtifactRefSchema).optional(),
    log_refs: z.array(publicArtifactRefSchema).optional(),
    runtime_metadata: publicRuntimeMetadataSchema.optional(),
    summary: z.string().optional(),
    failure_kind: z.string().optional(),
    failure_reason: z.string().optional(),
    created_at: isoDateTimeSchema.optional(),
    updated_at: isoDateTimeSchema.optional(),
    started_at: isoDateTimeSchema.optional(),
    finished_at: isoDateTimeSchema.optional(),
  })
  .strict();

const cockpitReviewPacketSchema = z
  .object({
    id: nonEmpty,
    run_session_id: nonEmpty,
    execution_package_id: nonEmpty,
    reviewer_actor_id: nonEmpty,
    status: reviewPacketStatusSchema,
    decision: reviewDecisionSchema,
    summary: z.string().optional(),
    changed_files: z.array(publicCockpitChangedFileSchema).optional(),
    check_result_summary: z.string().optional(),
    self_review: publicCockpitSelfReviewResultSchema.optional(),
    independent_ai_review: independentAiReviewResultSchema.optional(),
    test_mapping: z.array(reviewPacketTestMappingSchema).optional(),
    risk_notes: z.array(z.string()).optional(),
    requested_changes: z.array(publicCockpitRequestedChangeSchema).optional(),
    reviewed_by_actor_id: z.string().optional(),
    reviewed_at: isoDateTimeSchema.optional(),
    created_at: isoDateTimeSchema.optional(),
    updated_at: isoDateTimeSchema.optional(),
  })
  .strict();

export const workItemCockpitResponseSchema = z
  .object({
    work_item: workItemCockpitWorkItemSchema,
    current_spec: cockpitSpecPlanSchema.nullable(),
    current_plan: cockpitSpecPlanSchema.nullable(),
    packages: z.array(cockpitExecutionPackageSchema),
    run_sessions: z.array(cockpitRunSessionSchema),
    review_packets: z.array(cockpitReviewPacketSchema),
    delivery_readiness: workItemDeliveryReadinessSchema,
  })
  .strict();

export type DeliveryStageId = z.infer<typeof deliveryStageIdSchema>;
export type DeliveryStageState = z.infer<typeof deliveryStageStateSchema>;
export type DeliveryOverallState = z.infer<typeof deliveryOverallStateSchema>;
export type DegradedSourceKey = z.infer<typeof degradedSourceKeySchema>;
export type WorkItemKind = z.infer<typeof workItemKindSchema>;
export type DeliveryObjectRef = z.infer<typeof deliveryObjectRefSchema>;
export type DeliveryEvidence = z.infer<typeof deliveryEvidenceSchema>;
export type DeliveryBlocker = z.infer<typeof deliveryBlockerSchema>;
export type DeliveryStage = z.infer<typeof deliveryStageSchema>;
export type WorkItemDeliveryReadiness = z.infer<typeof workItemDeliveryReadinessSchema>;
export type WorkItemCockpitResponse = z.infer<typeof workItemCockpitResponseSchema>;
