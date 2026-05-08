import { z } from 'zod';

import { artifactKindSchema, executorTypeSchema, jsonObjectSchema } from './executor.js';
import {
  reviewDecisionSchema,
  requestedChangeSchema,
  reviewDecisionPayloadSchema,
  reviewSubmitDecisionSchema,
} from './review.js';

const isoDateTimeSchema = z.string().datetime();

const commandNames = [
  'run_package',
  'rerun_package',
  'force_rerun_package',
  'approve_review_packet',
  'request_review_changes',
] as const;

export const commandNameSchema = z.enum(commandNames);
export type CommandName = z.infer<typeof commandNameSchema>;

const commandInventoryPaths: Record<CommandName, string> = {
  run_package: '/execution-packages/:packageId/run',
  rerun_package: '/execution-packages/:packageId/rerun',
  force_rerun_package: '/execution-packages/:packageId/force-rerun',
  approve_review_packet: '/review-packets/:reviewPacketId/approve',
  request_review_changes: '/review-packets/:reviewPacketId/request-changes',
};

export const commandInventoryItemSchema = z
  .object({
    command: commandNameSchema,
    method: z.enum(['POST']),
    path: z.string().min(1),
    description: z.string().min(1),
  })
  .superRefine((item, ctx) => {
    const expectedPath = commandInventoryPaths[item.command];

    if (item.path !== expectedPath) {
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: `${item.command} command path must be ${expectedPath}`,
      });
    }
  });
export type CommandInventoryItem = z.infer<typeof commandInventoryItemSchema>;

export const commandInventoryResponseSchema = z
  .object({
    commands: z.array(commandInventoryItemSchema),
  })
  .superRefine((inventory, ctx) => {
    const commandCounts = new Map<CommandName, number>();

    inventory.commands.forEach((item, index) => {
      const count = commandCounts.get(item.command) ?? 0;

      if (count > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['commands', index, 'command'],
          message: `command inventory command must be unique: ${item.command}`,
        });
      }

      commandCounts.set(item.command, count + 1);
    });

    commandNames.forEach((command) => {
      if (!commandCounts.has(command)) {
        ctx.addIssue({
          code: 'custom',
          path: ['commands'],
          message: `command inventory is missing command: ${command}`,
        });
      }
    });
  });
export type CommandInventoryResponse = z.infer<typeof commandInventoryResponseSchema>;

export const runPackageRequestSchema = z.object({
  execution_package_id: z.string().min(1),
  requested_by_actor_id: z.string().min(1),
  executor_type: executorTypeSchema.optional(),
  workflow_only: z.boolean().default(false),
  idempotency_key: z.string().min(1).optional(),
});
export type RunPackageRequest = z.infer<typeof runPackageRequestSchema>;

export const rerunPackageRequestSchema = z.object({
  execution_package_id: z.string().min(1),
  previous_run_session_id: z.string().min(1),
  review_packet_id: z.string().min(1).optional(),
  requested_changes_context: z.array(requestedChangeSchema).default([]),
  requested_by_actor_id: z.string().min(1),
  executor_type: executorTypeSchema.optional(),
  workflow_only: z.boolean().default(false),
  idempotency_key: z.string().min(1).optional(),
});
export type RerunPackageRequest = z.infer<typeof rerunPackageRequestSchema>;

export const forceRerunPackageRequestSchema = rerunPackageRequestSchema.extend({
  force: z.literal(true).default(true),
  force_reason: z.string().min(1),
});
export type ForceRerunPackageRequest = z.infer<typeof forceRerunPackageRequestSchema>;

export const runEventTypeSchema = z.enum([
  'run_queued',
  'worker_lease_acquired',
  'driver_started',
  'thread_started',
  'thread_resumed',
  'turn_started',
  'turn_status_changed',
  'agent_message_delta',
  'agent_message_completed',
  'plan_updated',
  'tool_call_started',
  'tool_call_progress',
  'tool_call_completed',
  'command_started',
  'command_output_delta',
  'command_completed',
  'waiting_for_input',
  'user_input',
  'watchdog_heartbeat',
  'watchdog_idle_detected',
  'stalled',
  'resuming',
  'cancel_requested',
  'cancelled',
  'codex_warning',
  'driver_fallback_used',
  'executor_result_started',
  'required_check_started',
  'required_check_completed',
  'artifact_captured',
  'run_succeeded',
  'run_failed',
]);
export type RunEventType = z.infer<typeof runEventTypeSchema>;

export const runEventSourceSchema = z.enum(['api', 'worker', 'codex', 'executor', 'watchdog', 'user']);
export type RunEventSource = z.infer<typeof runEventSourceSchema>;

export const runEventVisibilitySchema = z.enum(['public', 'internal']);
export type RunEventVisibility = z.infer<typeof runEventVisibilitySchema>;

export const publicRunEventSchema = z
  .object({
    id: z.string().min(1),
    run_session_id: z.string().min(1),
    sequence: z.number().int().positive(),
    cursor: z.string().min(1),
    event_type: runEventTypeSchema,
    source: runEventSourceSchema,
    visibility: z.literal('public'),
    summary: z.string().min(1),
    payload: jsonObjectSchema,
    created_at: isoDateTimeSchema,
  })
  .strict();
export type PublicRunEvent = z.infer<typeof publicRunEventSchema>;

export const runEventListResponseSchema = z
  .object({
    events: z.array(publicRunEventSchema),
    next_cursor: z.string().min(1).optional(),
    has_more: z.boolean(),
  })
  .strict();
export type RunEventListResponse = z.infer<typeof runEventListResponseSchema>;

export const runAcceptedResponseSchema = z
  .object({
    status: z.literal('accepted'),
    run_session_id: z.string().min(1),
    execution_package_id: z.string().min(1),
  })
  .strict();
export type RunAcceptedResponse = z.infer<typeof runAcceptedResponseSchema>;

export const runCommandTypeSchema = z.enum(['input', 'cancel', 'resume']);
export type RunCommandType = z.infer<typeof runCommandTypeSchema>;

export const runOperatorCommandResponseSchema = z
  .object({
    status: z.literal('accepted'),
    command_id: z.string().min(1),
    run_session_id: z.string().min(1),
    command_type: runCommandTypeSchema,
  })
  .strict();
export type RunOperatorCommandResponse = z.infer<typeof runOperatorCommandResponseSchema>;

const runCommandResponseBaseSchema = z.object({
  command_id: z.string().min(1),
  execution_package_id: z.string().min(1),
  workflow_only: z.boolean(),
  idempotency_key: z.string().min(1),
});

export const runCommandResponseSchema = z.discriminatedUnion('status', [
  runCommandResponseBaseSchema.extend({
    status: z.literal('accepted'),
    run_session_id: z.string().min(1),
    rejection_reason: z.never().optional(),
  }),
  runCommandResponseBaseSchema.extend({
    status: z.literal('already_running'),
    run_session_id: z.string().min(1),
    rejection_reason: z.never().optional(),
  }),
  runCommandResponseBaseSchema.extend({
    status: z.literal('rejected'),
    run_session_id: z.never().optional(),
    rejection_reason: z.string().min(1),
  }),
]);
export type RunCommandResponse = z.infer<typeof runCommandResponseSchema>;

export const runPackageResponseSchema = runAcceptedResponseSchema;
export type RunPackageResponse = RunAcceptedResponse;

export const rerunPackageResponseSchema = runAcceptedResponseSchema;
export type RerunPackageResponse = RunAcceptedResponse;

export const forceRerunPackageResponseSchema = runAcceptedResponseSchema;
export type ForceRerunPackageResponse = RunAcceptedResponse;

export const evidenceChainSourceSchema = z.enum([
  'run_event',
  'status_history',
  'artifact',
  'decision',
  'review_packet',
  'object_event',
  'trace_event',
]);
export type EvidenceChainSource = z.infer<typeof evidenceChainSourceSchema>;

export const evidenceChainObjectTypeSchema = z.enum([
  'work_item',
  'execution_package',
  'run_session',
  'review_packet',
  'artifact',
  'decision',
  'required_check',
  'trace_event',
]);
export type EvidenceChainObjectType = z.infer<typeof evidenceChainObjectTypeSchema>;

export const evidenceChainRiskFlagSchema = z.enum([
  'no_evidence',
  'missing_required_artifact',
  'redacted_evidence',
  'superseded_run',
  'stale_review_packet',
  'unapproved_review_packet',
  'failed_required_check',
  'changes_requested',
  'projection_partial',
]);
export type EvidenceChainRiskFlag = z.infer<typeof evidenceChainRiskFlagSchema>;

export const evidenceChainRedactionReasonSchema = z.enum([
  'internal_event',
  'raw_ref',
  'logs_artifact',
  'raw_metadata_artifact',
  'local_ref_only',
  'internal_payload',
]);
export type EvidenceChainRedactionReason = z.infer<typeof evidenceChainRedactionReasonSchema>;

export const evidenceChainProjectionGapCodeSchema = z.enum([
  'missing_supersession_links',
  'missing_last_run_session',
  'missing_trace_events',
  'missing_trace_artifact_refs',
]);
export type EvidenceChainProjectionGapCode = z.infer<typeof evidenceChainProjectionGapCodeSchema>;

export const evidenceChainTraceLinkRelationshipSchema = z.enum([
  'belongs_to',
  'generated_by',
  'supports',
  'supersedes',
  'replaces',
  'redacted_from',
]);
export type EvidenceChainTraceLinkRelationship = z.infer<typeof evidenceChainTraceLinkRelationshipSchema>;

export const evidenceChainObjectRefSchema = z
  .object({
    object_type: evidenceChainObjectTypeSchema,
    object_id: z.string().min(1),
    relationship: evidenceChainTraceLinkRelationshipSchema.optional(),
  })
  .strict();
export type EvidenceChainObjectRef = z.infer<typeof evidenceChainObjectRefSchema>;

export const evidenceChainItemSchema = z
  .object({
    id: z.string().min(1),
    source: evidenceChainSourceSchema,
    subject: evidenceChainObjectRefSchema,
    summary: z.string().min(1),
    created_at: isoDateTimeSchema,
    visibility: z.literal('public'),
    links: z.array(evidenceChainObjectRefSchema),
    risk_flags: z.array(evidenceChainRiskFlagSchema),
    redacted: z.boolean(),
    details: z
      .object({
        decision: reviewDecisionSchema.optional(),
        run_status: z.string().min(1).optional(),
        missing_artifact_kinds: z.array(artifactKindSchema).optional(),
        required_check_ids: z.array(z.string().min(1)).optional(),
        failed_check_ids: z.array(z.string().min(1)).optional(),
        redaction_reason: evidenceChainRedactionReasonSchema.optional(),
        replacement: z
          .object({
            new_run_session_id: z.string().min(1).optional(),
            previous_run_session_id: z.string().min(1).optional(),
            new_review_packet_id: z.string().min(1).optional(),
            previous_review_packet_id: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
        projection_gap_codes: z.array(evidenceChainProjectionGapCodeSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type EvidenceChainItem = z.infer<typeof evidenceChainItemSchema>;

export const evidenceChainResponseSchema = z
  .object({
    work_item_id: z.string().min(1),
    generated_at: isoDateTimeSchema,
    focus: z
      .object({
        selection: z.enum(['explicit', 'current']),
        review_packet_ids: z.array(z.string().min(1)),
      })
      .strict(),
    projection: z
      .object({
        source: z.enum(['trace_events', 'read_time', 'mixed']),
        version: z.literal(1),
        partial: z.boolean(),
        gaps: z.array(evidenceChainProjectionGapCodeSchema),
      })
      .strict(),
    summary: z
      .object({
        total_items: z.number().int().nonnegative(),
        run_count: z.number().int().nonnegative(),
        review_packet_count: z.number().int().nonnegative(),
        decision_count: z.number().int().nonnegative(),
        artifact_count: z.number().int().nonnegative(),
        risk_flags: z.array(evidenceChainRiskFlagSchema),
        redacted_count: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(evidenceChainItemSchema),
  })
  .strict()
  .superRefine((response, ctx) => {
    if (response.summary.total_items !== response.items.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['summary', 'total_items'],
        message: 'EvidenceChainResponse summary.total_items must equal items.length',
      });
    }
  });
export type EvidenceChainResponse = z.infer<typeof evidenceChainResponseSchema>;

const reviewDecisionRequestBaseSchema = z.object({
  review_packet_id: z.string().min(1),
  summary: z.string().min(1),
  reviewed_by_actor_id: z.string().min(1),
  reviewed_at: isoDateTimeSchema,
});

export const approveReviewPacketRequestSchema = reviewDecisionRequestBaseSchema.extend({
  decision: z.literal('approved'),
  requested_changes: z.never().optional(),
});
export type ApproveReviewPacketRequest = z.infer<typeof approveReviewPacketRequestSchema>;

export const requestReviewChangesRequestSchema = reviewDecisionRequestBaseSchema.extend({
  decision: z.literal('changes_requested'),
  requested_changes: z.array(requestedChangeSchema).min(1),
});
export type RequestReviewChangesRequest = z.infer<typeof requestReviewChangesRequestSchema>;

export const submitReviewDecisionRequestSchema = reviewDecisionPayloadSchema;
export type SubmitReviewDecisionRequest = z.infer<typeof submitReviewDecisionRequestSchema>;

export const submitReviewDecisionResponseSchema = z.object({
  review_packet_id: z.string().min(1),
  status: z.literal('completed'),
  decision: reviewSubmitDecisionSchema,
  recorded_at: isoDateTimeSchema,
});
export type SubmitReviewDecisionResponse = z.infer<typeof submitReviewDecisionResponseSchema>;
