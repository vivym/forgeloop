import { z } from 'zod';
import type { AutomationActionRun, AutomationActionRunStatus, AutomationScope } from '@forgeloop/domain';

const nonBlankString = z.string().min(1);
const isoDateTime = z.string().datetime().transform((value) => new Date(value).toISOString());
const actionInputObject = z.record(z.string(), z.unknown());

const automationScopeSchema = z.custom<AutomationScope>(
  (value) => typeof value === 'string' && (/^project:[^:]+$/.test(value) || /^repo:[^:]+:[^:]+$/.test(value)),
  'automation_scope must be project:<projectId> or repo:<projectId>:<repoId>',
);

const ensurePlanDraftActionInputSchema = z
  .object({
    work_item_id: nonBlankString,
    spec_revision_id: nonBlankString,
  })
  .strict();

const ensurePackageDraftsActionInputSchema = z
  .object({
    plan_revision_id: nonBlankString,
    generation_key: nonBlankString,
  })
  .strict();

const requestManualPathActionInputSchema = z
  .object({
    object_type: nonBlankString,
    object_id: nonBlankString,
    scope_key: nonBlankString,
    reason_code: nonBlankString,
    reason: nonBlankString,
  })
  .strict();

const projectRuntimeSnapshotActionInputSchema = z
  .object({
    repo_id: nonBlankString,
    policy_status: z.enum(['missing', 'loaded', 'parse_failed', 'unsafe_path']),
    policy_digest: nonBlankString.optional(),
    parser_version: nonBlankString,
    reason_code: nonBlankString.optional(),
  })
  .strict();

const createAutomationActionRunBaseShape = {
  id: nonBlankString.optional(),
  target_object_type: nonBlankString,
  target_object_id: nonBlankString,
  target_revision_id: nonBlankString.optional(),
  target_version: z.number().int().nonnegative().optional(),
  target_status: nonBlankString,
  idempotency_key: nonBlankString,
  automation_scope: automationScopeSchema,
  automation_settings_version: z.number().int().nonnegative(),
  capability_fingerprint: nonBlankString,
  precondition_fingerprint: nonBlankString,
} satisfies z.ZodRawShape;

export const createAutomationActionRunSchema = z.discriminatedUnion('action_type', [
  z
    .object({
      ...createAutomationActionRunBaseShape,
      action_type: z.literal('ensure_plan_draft'),
      action_input_json: ensurePlanDraftActionInputSchema,
    })
    .strict(),
  z
    .object({
      ...createAutomationActionRunBaseShape,
      action_type: z.literal('ensure_package_drafts'),
      action_input_json: ensurePackageDraftsActionInputSchema,
    })
    .strict(),
  z
    .object({
      ...createAutomationActionRunBaseShape,
      action_type: z.literal('request_manual_path'),
      action_input_json: requestManualPathActionInputSchema,
    })
    .strict(),
  z
    .object({
      ...createAutomationActionRunBaseShape,
      action_type: z.literal('project_runtime_snapshot'),
      action_input_json: projectRuntimeSnapshotActionInputSchema,
    })
    .strict(),
]);

export const claimNextAutomationActionRunSchema = z
  .object({
    claim_token: nonBlankString,
    lease_ms: z.number().int().positive().max(60 * 60 * 1000).optional(),
    limit: z.number().int().min(1).max(100).default(1),
    project_id: nonBlankString.optional(),
    repo_id: nonBlankString.optional(),
    automation_scope: automationScopeSchema.optional(),
  })
  .strict();

export const completeAutomationActionRunSchema = z
  .object({
    claim_token: nonBlankString,
    idempotency_key: nonBlankString,
    result_json: actionInputObject.optional(),
  })
  .strict();

export const gatePendingAutomationActionRunSchema = z
  .object({
    claim_token: nonBlankString,
    idempotency_key: nonBlankString,
    reason: nonBlankString,
    result_json: actionInputObject.optional(),
    next_attempt_at: isoDateTime.optional(),
  })
  .strict();

export const blockAutomationActionRunSchema = z
  .object({
    claim_token: nonBlankString,
    idempotency_key: nonBlankString,
    result_json: actionInputObject.optional(),
    retryable: z.boolean().optional(),
    next_attempt_at: isoDateTime.optional(),
  })
  .strict();

export const failAutomationActionRunSchema = z
  .object({
    claim_token: nonBlankString,
    idempotency_key: nonBlankString,
    result_json: actionInputObject.optional(),
    retryable: z.boolean(),
    next_attempt_at: isoDateTime.optional(),
  })
  .strict();

export type CreateAutomationActionRunDto = z.infer<typeof createAutomationActionRunSchema>;
export type ClaimNextAutomationActionRunDto = z.infer<typeof claimNextAutomationActionRunSchema>;
export type CompleteAutomationActionRunDto = z.infer<typeof completeAutomationActionRunSchema>;
export type GatePendingAutomationActionRunDto = z.infer<typeof gatePendingAutomationActionRunSchema>;
export type BlockAutomationActionRunDto = z.infer<typeof blockAutomationActionRunSchema>;
export type FailAutomationActionRunDto = z.infer<typeof failAutomationActionRunSchema>;

export interface AutomationRuntimeSnapshotDto {
  generated_at: string;
  projects: [];
  repos: [];
  work_items_requiring_plan: [];
  plan_revisions_requiring_packages: [];
  recent_action_runs: [];
  run_enqueue_disabled_reason: 'run_enqueue_disabled_by_scope';
}

export interface AutomationActionRunDto {
  id: string;
  action_type: string;
  target_object_type: string;
  target_object_id: string;
  target_revision_id?: string;
  target_version?: number;
  target_status: string;
  idempotency_key: string;
  automation_scope: AutomationScope;
  automation_settings_version: number;
  capability_fingerprint: string;
  precondition_fingerprint: string;
  action_input_json: Record<string, unknown>;
  status: AutomationActionRunStatus;
  attempt: number;
  retryable?: boolean;
  next_attempt_at?: string;
  reason?: string;
  error_code?: string;
  claim_token?: string;
  locked_until?: string;
}

export interface AutomationActionResponseDto {
  action: AutomationActionRunDto | null;
}

const safeActionInputJson = (actionRun: AutomationActionRun): Record<string, unknown> => {
  const schema =
    actionRun.action_type === 'ensure_plan_draft'
      ? ensurePlanDraftActionInputSchema
      : actionRun.action_type === 'ensure_package_drafts'
        ? ensurePackageDraftsActionInputSchema
        : actionRun.action_type === 'request_manual_path'
          ? requestManualPathActionInputSchema
          : actionRun.action_type === 'project_runtime_snapshot'
            ? projectRuntimeSnapshotActionInputSchema
            : undefined;
  if (schema === undefined) {
    return {};
  }

  const result = schema.safeParse(actionRun.action_input_json);
  return result.success ? result.data : {};
};

export const toAutomationActionRunDto = (
  actionRun: AutomationActionRun,
  options: { includeClaim?: boolean } = {},
): AutomationActionRunDto => ({
  id: actionRun.id,
  action_type: actionRun.action_type,
  target_object_type: actionRun.target_object_type,
  target_object_id: actionRun.target_object_id,
  ...(actionRun.target_revision_id === undefined ? {} : { target_revision_id: actionRun.target_revision_id }),
  ...(actionRun.target_version === undefined ? {} : { target_version: actionRun.target_version }),
  target_status: actionRun.target_status,
  idempotency_key: actionRun.idempotency_key,
  automation_scope: actionRun.automation_scope,
  automation_settings_version: actionRun.automation_settings_version,
  capability_fingerprint: actionRun.capability_fingerprint,
  precondition_fingerprint: actionRun.precondition_fingerprint,
  action_input_json: safeActionInputJson(actionRun),
  status: actionRun.status,
  attempt: actionRun.attempt,
  ...(actionRun.retryable === undefined ? {} : { retryable: actionRun.retryable }),
  ...(actionRun.next_attempt_at === undefined ? {} : { next_attempt_at: actionRun.next_attempt_at }),
  ...(actionRun.reason === undefined ? {} : { reason: actionRun.reason }),
  ...(actionRun.error_code === undefined ? {} : { error_code: actionRun.error_code }),
  ...(options.includeClaim !== true || actionRun.claim_token === undefined ? {} : { claim_token: actionRun.claim_token }),
  ...(options.includeClaim !== true || actionRun.locked_until === undefined ? {} : { locked_until: actionRun.locked_until }),
});
