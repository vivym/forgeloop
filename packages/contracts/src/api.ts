import { z } from 'zod';

import { executorTypeSchema, jsonObjectSchema } from './executor';
import {
  requestedChangeSchema,
  reviewDecisionPayloadSchema,
  reviewSubmitDecisionSchema,
} from './review';

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
    event_id: z.string().min(1),
    run_session_id: z.string().min(1),
    execution_package_id: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    event_type: runEventTypeSchema,
    source: runEventSourceSchema,
    visibility: z.literal('public'),
    occurred_at: isoDateTimeSchema,
    payload: jsonObjectSchema,
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
