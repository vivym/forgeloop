import { z } from 'zod';

import { executorTypeSchema } from './executor';
import {
  requestedChangeSchema,
  reviewDecisionPayloadSchema,
  reviewSubmitDecisionSchema,
} from './review';

const isoDateTimeSchema = z.string().datetime();

export const commandNameSchema = z.enum([
  'run_package',
  'rerun_package',
  'force_rerun_package',
  'submit_review_decision',
]);
export type CommandName = z.infer<typeof commandNameSchema>;

export const commandInventoryItemSchema = z.object({
  command: commandNameSchema,
  method: z.enum(['POST']),
  path: z.string().min(1),
  description: z.string().min(1),
});
export type CommandInventoryItem = z.infer<typeof commandInventoryItemSchema>;

export const commandInventoryResponseSchema = z.object({
  commands: z.array(commandInventoryItemSchema),
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

export const runPackageResponseSchema = runCommandResponseSchema;
export type RunPackageResponse = RunCommandResponse;

export const rerunPackageResponseSchema = runCommandResponseSchema;
export type RerunPackageResponse = RunCommandResponse;

export const forceRerunPackageResponseSchema = runCommandResponseSchema;
export type ForceRerunPackageResponse = RunCommandResponse;

export const submitReviewDecisionRequestSchema = reviewDecisionPayloadSchema;
export type SubmitReviewDecisionRequest = z.infer<typeof submitReviewDecisionRequestSchema>;

export const submitReviewDecisionResponseSchema = z.object({
  review_packet_id: z.string().min(1),
  status: z.literal('completed'),
  decision: reviewSubmitDecisionSchema,
  recorded_at: isoDateTimeSchema,
});
export type SubmitReviewDecisionResponse = z.infer<typeof submitReviewDecisionResponseSchema>;
