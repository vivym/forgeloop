import { z } from 'zod';
import { artifactRefSchema } from '@forgeloop/contracts';
import type { AutomationActionRun, AutomationActionRunStatus, AutomationScope } from '@forgeloop/domain';
import type {
  RuntimeSnapshotBlockerRow,
  RuntimeSnapshotManualHoldRow,
  RuntimeSnapshotProjectRow,
  RuntimeSnapshotRepoRow,
  RuntimeSnapshotRepositoryData,
  RuntimeSnapshotTargetRow,
} from '@forgeloop/db';

const nonBlankString = z.string().min(1);
const isoDateTime = z.string().datetime().transform((value) => new Date(value).toISOString());
const actionInputObject = z.record(z.string(), z.unknown());
const publicReasonCode = z.string().regex(/^[a-z0-9_:-]+$/);

const automationScopeSchema = z.custom<AutomationScope>(
  (value) => typeof value === 'string' && (/^project:[^:]+$/.test(value) || /^repo:[^:]+:[^:]+$/.test(value)),
  'automation_scope must be project:<projectId> or repo:<projectId>:<repoId>',
);

const manualPathHoldObjectTypeSchema = z.enum([
  'work_item',
  'spec_revision',
  'plan_revision',
  'package_generation',
  'execution_package',
  'run_session',
  'review_packet',
  'release_gate',
]);

const ensurePlanDraftActionInputSchema = z
  .object({
    work_item_id: nonBlankString,
    spec_revision_id: nonBlankString,
  })
  .strict();

const ensureSpecDraftActionInputSchema = z
  .object({
    work_item_id: nonBlankString,
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
    object_type: manualPathHoldObjectTypeSchema,
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

const projectRuntimeSnapshotResultSchema = z.object({
  repo_id: nonBlankString,
  policy_status: z.enum(['missing', 'loaded', 'parse_failed', 'unsafe_path']),
  policy_digest: nonBlankString.optional(),
  parser_version: nonBlankString,
  reason_code: nonBlankString.optional(),
  observed_at: isoDateTime.optional(),
  last_known_good_policy_digest: nonBlankString.optional(),
  last_known_good_observed_at: isoDateTime.optional(),
});

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
      action_type: z.literal('ensure_spec_draft'),
      action_input_json: ensureSpecDraftActionInputSchema,
    })
    .strict(),
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
    action_type: z
      .enum(['ensure_spec_draft', 'ensure_plan_draft', 'ensure_package_drafts', 'request_manual_path', 'project_runtime_snapshot'])
      .optional(),
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
    reason: publicReasonCode,
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

const automationPreconditionSchema = z
  .object({
    automation_scope: automationScopeSchema,
    project_id: nonBlankString,
    repo_id: nonBlankString.optional(),
    target_object_type: nonBlankString.optional(),
    target_object_id: nonBlankString.optional(),
    target_revision_id: nonBlankString.optional(),
    target_version: z.number().int().nonnegative().optional(),
    target_status: nonBlankString.optional(),
    automation_settings_version: z.number().int().nonnegative(),
    capability_fingerprint: nonBlankString,
    active_hold_fingerprint: nonBlankString.optional(),
    required_capability: z.enum([
      'canProjectRuntimeState',
      'canGenerateSpecDraft',
      'canGeneratePlanDraft',
      'canGeneratePackageDrafts',
      'canEnqueueRuns',
    ]),
    command_concurrency_token: nonBlankString.optional(),
    actor_class: z.enum([
      'human_admin',
      'human',
      'system_bootstrap',
      'migration',
      'automation_daemon',
      'source_adapter',
      'external_tracker',
      'repo_policy',
    ]),
    daemon_identity: nonBlankString.optional(),
  })
  .strict();

const internalCommandBaseShape = {
  action_run_id: nonBlankString,
  claim_token: nonBlankString.optional(),
  idempotency_key: nonBlankString,
  automation_precondition: automationPreconditionSchema,
} satisfies z.ZodRawShape;

export const ensurePlanDraftCommandSchema = z
  .object({
    ...internalCommandBaseShape,
    spec_revision_id: nonBlankString,
  })
  .strict();

export const generatedSpecDraftSchema = z
  .object({
    schema_version: z.literal('spec_draft.v1'),
    summary: nonBlankString,
    content: nonBlankString,
    background: nonBlankString,
    goals: z.array(nonBlankString),
    scope_in: z.array(nonBlankString),
    scope_out: z.array(nonBlankString),
    acceptance_criteria: z.array(nonBlankString),
    risk_notes: z.array(nonBlankString).default([]),
    test_strategy_summary: nonBlankString,
    structured_document: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ensureSpecDraftCommandSchema = z
  .object({
    ...internalCommandBaseShape,
    generated_spec_draft: generatedSpecDraftSchema,
    generation_artifacts: z.array(artifactRefSchema).default([]),
  })
  .strict();

export const ensurePackageDraftsCommandSchema = z
  .object({
    ...internalCommandBaseShape,
    generation_key: nonBlankString.optional(),
    regeneration_approval: z
      .object({
        superseded_generation_key: nonBlankString,
        superseded_execution_package_set_id: nonBlankString,
        supersede_command_id: nonBlankString,
      })
      .strict()
      .optional(),
  })
  .strict();

export const requestManualPathCommandSchema = z
  .object({
    ...internalCommandBaseShape,
    object_type: manualPathHoldObjectTypeSchema,
    object_id: nonBlankString,
    scope_key: nonBlankString,
    reason_code: nonBlankString,
    reason: nonBlankString,
    evidence_refs: z.array(artifactRefSchema).default([]),
    requested_by: nonBlankString,
    generation_key: nonBlankString.optional(),
    gate_key: nonBlankString.optional(),
  })
  .strict();

export const generationContextQuerySchema = z
  .object({
    action_run_id: nonBlankString,
    claim_token: nonBlankString,
  })
  .strict();

export const planGenerationContextQuerySchema = z
  .object({
    spec_revision_id: nonBlankString,
    action_run_id: nonBlankString,
    claim_token: nonBlankString,
  })
  .strict();

export type CreateAutomationActionRunDto = z.infer<typeof createAutomationActionRunSchema>;
export type ClaimNextAutomationActionRunDto = z.infer<typeof claimNextAutomationActionRunSchema>;
export type CompleteAutomationActionRunDto = z.infer<typeof completeAutomationActionRunSchema>;
export type GatePendingAutomationActionRunDto = z.infer<typeof gatePendingAutomationActionRunSchema>;
export type BlockAutomationActionRunDto = z.infer<typeof blockAutomationActionRunSchema>;
export type FailAutomationActionRunDto = z.infer<typeof failAutomationActionRunSchema>;
export type AutomationActionType = CreateAutomationActionRunDto['action_type'];
export type EnsurePlanDraftCommandDto = z.infer<typeof ensurePlanDraftCommandSchema>;
export type EnsureSpecDraftCommandDto = z.infer<typeof ensureSpecDraftCommandSchema>;
export type EnsurePackageDraftsCommandDto = z.infer<typeof ensurePackageDraftsCommandSchema>;
export type GenerationContextQueryDto = z.infer<typeof generationContextQuerySchema>;
export type PlanGenerationContextQueryDto = z.infer<typeof planGenerationContextQuerySchema>;
export type RequestManualPathCommandDto = z.infer<typeof requestManualPathCommandSchema>;

export interface AutomationGenerationRepoContextV1 {
  project_id: string;
  repo_id: string;
  default_branch: string;
  policy_status: 'missing' | 'loaded' | 'parse_failed' | 'unsafe_path';
  policy_digest?: string;
  parser_version?: string;
  package_manager?: string;
  workspace_summary?: string;
}

export interface AutomationGenerationWorkItemContextV1 {
  context_version: 'generation_context.work_item.v1';
  action_run_id: string;
  work_item: {
    id: string;
    project_id: string;
    title: string;
    goal: string;
    success_criteria: string[];
    risk?: string;
    priority?: string;
    kind?: string;
  };
  repos: AutomationGenerationRepoContextV1[];
}

export interface AutomationGenerationPlanContextV1 {
  context_version: 'generation_context.plan.v1';
  action_run_id: string;
  work_item: {
    id: string;
    project_id: string;
    title: string;
    goal: string;
    success_criteria: string[];
    risk?: string;
    priority?: string;
    kind?: string;
  };
  spec_revision: {
    id: string;
    spec_id: string;
    summary: string;
    content: string;
    background: string;
    goals: string[];
    scope_in: string[];
    scope_out: string[];
    acceptance_criteria: string[];
    risk_notes: string[];
    test_strategy_summary: string;
    structured_document?: Record<string, unknown>;
  };
  repos: AutomationGenerationRepoContextV1[];
}

export interface AutomationRuntimeSnapshotDto {
  generated_at: string;
  projects: AutomationRuntimeSnapshotProjectDto[];
  repos: AutomationRuntimeSnapshotRepoDto[];
  work_items_requiring_spec: AutomationRuntimeSnapshotTargetDto[];
  work_items_requiring_plan: AutomationRuntimeSnapshotTargetDto[];
  plan_revisions_requiring_packages: AutomationRuntimeSnapshotTargetDto[];
  run_enqueue_disabled_packages: AutomationRuntimeSnapshotTargetDto[];
  active_holds: AutomationRuntimeSnapshotManualHoldDto[];
  recent_action_runs: AutomationRuntimeSnapshotActionRunSummaryDto[];
  run_enqueue_disabled_reason: 'run_enqueue_disabled_by_scope';
}

export interface AutomationRuntimeSnapshotProjectDto {
  project_id: string;
  automation_scope: AutomationScope;
  automation_settings_version: number;
  capability_fingerprint: string;
}

export interface AutomationRuntimeSnapshotRepoDto {
  project_id: string;
  repo_id: string;
  automation_scope: AutomationScope;
  automation_settings_version: number;
  capability_fingerprint: string;
  daemon_internal_local_path: string;
  policy_projection?: AutomationRuntimeSnapshotPolicyProjectionDto;
}

export interface AutomationRuntimeSnapshotTargetDto {
  target_object_type: string;
  target_object_id: string;
  target_revision_id?: string;
  target_version?: number;
  target_status: string;
  project_id?: string;
  repo_id?: string;
  eligible_repo_ids?: string[];
  automation_scope: AutomationScope;
  active_hold_fingerprint?: string;
  latest_matching_action_status?: string;
  blocked_reason_code?: string;
  blocked_summary?: string;
  blockers?: AutomationRuntimeBlockerDto[];
  generation_key?: string;
  disabled_reason?: 'run_enqueue_disabled_by_scope';
}

export interface AutomationRuntimeBlockerDto {
  target_object_type: string;
  target_object_id: string;
  target_revision_id?: string;
  repo_id?: string;
  blocked_reason_code: string;
  blocked_summary: string;
  retryable: boolean;
  policy_digest?: string;
  policy_snapshot_version?: number;
  diagnostic_ref?: string;
}

export interface AutomationRuntimeSnapshotManualHoldDto {
  object_type: string;
  object_id: string;
  scope_key: string;
  reason_code: string;
  status: string;
  requested_at: string;
  resolved_at?: string;
  fingerprint: string;
}

export interface AutomationRuntimeSnapshotActionRunSummaryDto {
  id: string;
  action_type: string;
  target_object_type: string;
  target_object_id: string;
  target_revision_id?: string;
  target_version?: number;
  status: AutomationActionRunStatus;
  idempotency_key: string;
  automation_scope: AutomationScope;
  automation_settings_version?: number;
  capability_fingerprint?: string;
  precondition_fingerprint?: string;
}

export interface AutomationRuntimeSnapshotPolicyProjectionDto {
  repo_id: string;
  policy_status: 'missing' | 'loaded' | 'parse_failed' | 'unsafe_path';
  policy_digest?: string;
  parser_version: string;
  reason_code?: string;
  observed_at?: string;
  last_known_good_policy_digest?: string;
  last_known_good_observed_at?: string;
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
    actionRun.action_type === 'ensure_spec_draft'
      ? ensureSpecDraftActionInputSchema
      : actionRun.action_type === 'ensure_plan_draft'
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

export const toRuntimeSnapshotDto = (input: {
  generatedAt: string;
  data: RuntimeSnapshotRepositoryData;
  policyProjectionsByRepoScope: Map<string, AutomationRuntimeSnapshotPolicyProjectionDto>;
}): AutomationRuntimeSnapshotDto => ({
  generated_at: input.generatedAt,
  projects: input.data.projects.map(toRuntimeSnapshotProjectDto),
  repos: input.data.repos.map((repo) => toRuntimeSnapshotRepoDto(repo, input.policyProjectionsByRepoScope.get(repo.automation_scope))),
  work_items_requiring_spec: input.data.work_items_requiring_spec.map(toRuntimeSnapshotTargetDto),
  work_items_requiring_plan: input.data.work_items_requiring_plan.map(toRuntimeSnapshotTargetDto),
  plan_revisions_requiring_packages: input.data.plan_revisions_requiring_packages.map(toRuntimeSnapshotTargetDto),
  run_enqueue_disabled_packages: input.data.run_enqueue_disabled_packages.map(toRuntimeSnapshotTargetDto),
  active_holds: input.data.active_holds.map(toRuntimeSnapshotManualHoldDto),
  recent_action_runs: input.data.recent_action_runs.map(toActionRunSummaryDto),
  run_enqueue_disabled_reason: 'run_enqueue_disabled_by_scope',
});

export const toRuntimeSnapshotProjectDto = (project: RuntimeSnapshotProjectRow): AutomationRuntimeSnapshotProjectDto => ({
  project_id: project.project_id,
  automation_scope: project.automation_scope,
  automation_settings_version: project.automation_settings_version,
  capability_fingerprint: project.capability_fingerprint,
});

export const toRuntimeSnapshotRepoDto = (
  repo: RuntimeSnapshotRepoRow,
  policyProjection?: AutomationRuntimeSnapshotPolicyProjectionDto,
): AutomationRuntimeSnapshotRepoDto => ({
  project_id: repo.project_id,
  repo_id: repo.repo_id,
  automation_scope: repo.automation_scope,
  automation_settings_version: repo.automation_settings_version,
  capability_fingerprint: repo.capability_fingerprint,
  daemon_internal_local_path: repo.daemon_internal_local_path,
  ...(policyProjection === undefined ? {} : { policy_projection: policyProjection }),
});

export const toRuntimeSnapshotTargetDto = (target: RuntimeSnapshotTargetRow): AutomationRuntimeSnapshotTargetDto => ({
  target_object_type: target.target_object_type,
  target_object_id: target.target_object_id,
  ...(target.target_revision_id === undefined ? {} : { target_revision_id: target.target_revision_id }),
  ...(target.target_version === undefined ? {} : { target_version: target.target_version }),
  target_status: target.target_status,
  ...(target.project_id === undefined ? {} : { project_id: target.project_id }),
  ...(target.repo_id === undefined ? {} : { repo_id: target.repo_id }),
  ...(target.eligible_repo_ids === undefined ? {} : { eligible_repo_ids: target.eligible_repo_ids }),
  automation_scope: target.automation_scope,
  ...(target.active_hold_fingerprint === undefined ? {} : { active_hold_fingerprint: target.active_hold_fingerprint }),
  ...(target.latest_matching_action_status === undefined
    ? {}
    : { latest_matching_action_status: target.latest_matching_action_status }),
  ...(target.blocked_reason_code === undefined ? {} : { blocked_reason_code: target.blocked_reason_code }),
  ...(target.blocked_summary === undefined ? {} : { blocked_summary: target.blocked_summary }),
  ...(target.blockers === undefined
    ? {}
    : { blockers: target.blockers.map((blocker) => toRuntimeBlockerDto(target, blocker)) }),
  ...(target.generation_key === undefined ? {} : { generation_key: target.generation_key }),
  ...(target.disabled_reason === undefined ? {} : { disabled_reason: target.disabled_reason }),
});

export const toRuntimeBlockerDto = (
  target: RuntimeSnapshotTargetRow,
  blocker: RuntimeSnapshotBlockerRow,
): AutomationRuntimeBlockerDto => ({
  target_object_type: target.target_object_type,
  target_object_id: target.target_object_id,
  ...(target.target_revision_id === undefined ? {} : { target_revision_id: target.target_revision_id }),
  ...(target.repo_id === undefined ? {} : { repo_id: target.repo_id }),
  blocked_reason_code: blocker.blocked_reason_code,
  blocked_summary: blocker.blocked_summary,
  retryable: blocker.retryable,
  ...(blocker.policy_digest === undefined ? {} : { policy_digest: blocker.policy_digest }),
  ...(blocker.policy_snapshot_version === undefined ? {} : { policy_snapshot_version: blocker.policy_snapshot_version }),
  ...(blocker.diagnostic_ref === undefined ? {} : { diagnostic_ref: blocker.diagnostic_ref }),
});

export const toRuntimeSnapshotManualHoldDto = (
  hold: RuntimeSnapshotManualHoldRow,
): AutomationRuntimeSnapshotManualHoldDto => ({
  object_type: hold.object_type,
  object_id: hold.object_id,
  scope_key: hold.scope_key,
  reason_code: hold.reason_code,
  status: hold.status,
  requested_at: hold.requested_at,
  ...(hold.resolved_at === undefined ? {} : { resolved_at: hold.resolved_at }),
  fingerprint: hold.fingerprint,
});

export const toActionRunSummaryDto = (actionRun: AutomationActionRun): AutomationRuntimeSnapshotActionRunSummaryDto => ({
  id: actionRun.id,
  action_type: actionRun.action_type,
  target_object_type: actionRun.target_object_type,
  target_object_id: actionRun.target_object_id,
  ...(actionRun.target_revision_id === undefined ? {} : { target_revision_id: actionRun.target_revision_id }),
  ...(actionRun.target_version === undefined ? {} : { target_version: actionRun.target_version }),
  status: actionRun.status,
  idempotency_key: actionRun.idempotency_key,
  automation_scope: actionRun.automation_scope,
  automation_settings_version: actionRun.automation_settings_version,
  capability_fingerprint: actionRun.capability_fingerprint,
  precondition_fingerprint: actionRun.precondition_fingerprint,
});

export const toPolicyProjectionDto = (
  actionRun: AutomationActionRun,
  lastKnownGood?: AutomationActionRun,
): AutomationRuntimeSnapshotPolicyProjectionDto | undefined => {
  const projection = policyProjectionData(actionRun);
  if (!projection.success) {
    return undefined;
  }
  const lastGoodProjection = lastKnownGood === undefined ? undefined : policyProjectionData(lastKnownGood);
  const lastGoodData = lastGoodProjection?.success === true && lastGoodProjection.data.policy_status === 'loaded' ? lastGoodProjection.data : undefined;
  return {
    repo_id: projection.data.repo_id,
    policy_status: projection.data.policy_status,
    ...(projection.data.policy_digest === undefined ? {} : { policy_digest: projection.data.policy_digest }),
    parser_version: projection.data.parser_version,
    ...(projection.data.reason_code === undefined ? {} : { reason_code: projection.data.reason_code }),
    ...(projection.data.observed_at === undefined ? {} : { observed_at: projection.data.observed_at }),
    ...(projection.data.policy_status !== 'parse_failed' && projection.data.policy_status !== 'unsafe_path'
      ? {}
      : {
          ...(lastGoodData?.policy_digest === undefined ? {} : { last_known_good_policy_digest: lastGoodData.policy_digest }),
          ...(lastGoodData?.observed_at === undefined ? {} : { last_known_good_observed_at: lastGoodData.observed_at }),
        }),
  };
};

const policyProjectionData = (actionRun: AutomationActionRun) => {
  const result = projectRuntimeSnapshotResultSchema.safeParse(actionRun.result_json);
  if (result.success) {
    return result;
  }
  const input = projectRuntimeSnapshotActionInputSchema.safeParse(actionRun.action_input_json);
  if (!input.success) {
    return result;
  }
  return projectRuntimeSnapshotResultSchema.safeParse({
    ...input.data,
    ...(actionRun.finished_at === undefined ? {} : { observed_at: actionRun.finished_at }),
  });
};
