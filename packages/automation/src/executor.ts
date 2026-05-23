import type { AutomationPrecondition, AutomationPreconditionCapability, AutomationScope } from '@forgeloop/domain';
import {
  planDraftOutputSchemaVersion,
  planDraftPromptVersion,
  specDraftOutputSchemaVersion,
  specDraftPromptVersion,
  CodexGenerationError,
  validateGeneratedPackageDraftSet,
  validateGeneratedPlanDraft,
  validateGeneratedSpecDraft,
  type CodexGenerationRuntime,
} from '@forgeloop/codex-runtime';

import { AutomationHttpError } from './http-client.js';
import type {
  AutomationActionRunRecord,
  AutomationExecutorClient,
  AutomationExecutorResult,
  AutomationGenerationPlanningConfig,
  NextAction,
} from './types.js';

export interface ExecuteClaimedActionInput {
  client: AutomationExecutorClient;
  action: NextAction;
  claimToken: string;
  actorId: string;
  daemonIdentity?: string;
  leaseMs?: number;
  generationRuntime?: CodexGenerationRuntime;
  generationPlanning?: AutomationGenerationPlanningConfig;
}

export interface ExecuteActionRunInput {
  client: AutomationExecutorClient;
  action: AutomationActionRunRecord;
  actorId: string;
  daemonIdentity?: string;
  generationRuntime?: CodexGenerationRuntime;
  generationPlanning?: AutomationGenerationPlanningConfig;
}

const projectAndRepoFromScope = (automationScope: AutomationScope): { projectId: string; repoId?: string } => {
  const [scopeType, projectId, repoId] = automationScope.split(':');
  if (scopeType === 'repo' && projectId !== undefined && repoId !== undefined) {
    return { projectId, repoId };
  }
  return { projectId: projectId ?? '' };
};

const requiredCapabilityFor = (action: AutomationActionRunRecord): AutomationPreconditionCapability => {
  if (action.actionType === 'ensure_spec_draft') {
    return 'canGenerateSpecDraft';
  }
  if (action.actionType === 'ensure_package_drafts') {
    return 'canGeneratePackageDrafts';
  }
  if (action.actionType === 'request_manual_path' && action.targetObjectType === 'plan_revision') {
    return 'canGeneratePackageDrafts';
  }
  return 'canGeneratePlanDraft';
};

const stringField = (input: Record<string, unknown>, field: string): string | undefined =>
  typeof input[field] === 'string' ? input[field] : undefined;

const commandConcurrencyTokenFor = (action: AutomationActionRunRecord): string | undefined => {
  if (action.actionType === 'ensure_package_drafts') {
    return stringField(action.actionInputJson, 'generation_key') ?? action.targetRevisionId;
  }
  if (action.actionType === 'request_manual_path') {
    const scopeKey = stringField(action.actionInputJson, 'scope_key') ?? `${action.targetObjectType}:${action.targetObjectId}`;
    const reasonCode = stringField(action.actionInputJson, 'reason_code') ?? 'manual_path_required';
    return `${scopeKey}:${reasonCode}`;
  }
  return undefined;
};

const preconditionFor = (action: AutomationActionRunRecord): AutomationPrecondition => {
  const scope = projectAndRepoFromScope(action.automationScope);
  const commandConcurrencyToken = commandConcurrencyTokenFor(action);
  return {
    automation_scope: action.automationScope,
    project_id: scope.projectId,
    ...(scope.repoId === undefined ? {} : { repo_id: scope.repoId }),
    target_object_type: action.targetObjectType,
    target_object_id: action.targetObjectId,
    ...(action.targetRevisionId === undefined ? {} : { target_revision_id: action.targetRevisionId }),
    ...(action.targetVersion === undefined ? {} : { target_version: action.targetVersion }),
    target_status: action.targetStatus,
    automation_settings_version: action.automationSettingsVersion,
    capability_fingerprint: action.capabilityFingerprint,
    required_capability: requiredCapabilityFor(action),
    ...(commandConcurrencyToken === undefined ? {} : { command_concurrency_token: commandConcurrencyToken }),
    actor_class: 'automation_daemon',
  };
};

type EnsurePlanDraftActionInput = {
  workItemId: string;
  specRevisionId: string;
  promptVersion?: string;
  outputSchemaVersion?: string;
};

type EnsureSpecDraftActionInput = {
  workItemId: string;
  promptVersion?: string;
  outputSchemaVersion?: string;
};

type EnsurePackageDraftsActionInput = {
  planRevisionId: string;
  generationKey: string;
  promptVersion?: string;
  outputSchemaVersion?: string;
};

type RequestManualPathActionInput = {
  objectType: string;
  objectId: string;
  scopeKey: string;
  reasonCode: string;
  reason: string;
  generationKey?: string;
  gateKey?: string;
};

type ProjectRuntimeSnapshotActionInput = {
  repoId: string;
  policyStatus: 'missing' | 'loaded' | 'parse_failed' | 'unsafe_path';
  policyDigest?: string;
  parserVersion: string;
  reasonCode?: string;
  observedAt?: string;
};

type GenerationTaskExecutionConfig = {
  enabled: boolean;
  promptVersion: string;
  outputSchemaVersion: string;
};

const policyStatuses = new Set<ProjectRuntimeSnapshotActionInput['policyStatus']>([
  'missing',
  'loaded',
  'parse_failed',
  'unsafe_path',
]);

const invalidActionInputJson = (): AutomationHttpError =>
  new AutomationHttpError(422, { code: 'invalid_action_input_json' }, 'Invalid automation action input JSON');

const requiredString = (input: Record<string, unknown>, field: string): string => {
  const value = stringField(input, field);
  if (value === undefined) {
    throw invalidActionInputJson();
  }
  return value;
};

const generationVersionFields = (
  action: AutomationActionRunRecord,
): Pick<EnsurePlanDraftActionInput, 'promptVersion' | 'outputSchemaVersion'> => {
  const promptVersion = stringField(action.actionInputJson, 'prompt_version');
  const outputSchemaVersion = stringField(action.actionInputJson, 'output_schema_version');
  return {
    ...(promptVersion === undefined ? {} : { promptVersion }),
    ...(outputSchemaVersion === undefined ? {} : { outputSchemaVersion }),
  };
};

const parseEnsurePlanDraftInput = (action: AutomationActionRunRecord): EnsurePlanDraftActionInput => ({
  workItemId: requiredString(action.actionInputJson, 'work_item_id'),
  specRevisionId: requiredString(action.actionInputJson, 'spec_revision_id'),
  ...generationVersionFields(action),
});

const parseEnsureSpecDraftInput = (action: AutomationActionRunRecord): EnsureSpecDraftActionInput => ({
  workItemId: requiredString(action.actionInputJson, 'work_item_id'),
  ...generationVersionFields(action),
});

const parseEnsurePackageDraftsInput = (action: AutomationActionRunRecord): EnsurePackageDraftsActionInput => ({
  planRevisionId: requiredString(action.actionInputJson, 'plan_revision_id'),
  generationKey: requiredString(action.actionInputJson, 'generation_key'),
  ...generationVersionFields(action),
});

const parseRequestManualPathInput = (action: AutomationActionRunRecord): RequestManualPathActionInput => {
  const generationKey = stringField(action.actionInputJson, 'generation_key');
  const gateKey = stringField(action.actionInputJson, 'gate_key');
  return {
    objectType: requiredString(action.actionInputJson, 'object_type'),
    objectId: requiredString(action.actionInputJson, 'object_id'),
    scopeKey: requiredString(action.actionInputJson, 'scope_key'),
    reasonCode: requiredString(action.actionInputJson, 'reason_code'),
    reason: requiredString(action.actionInputJson, 'reason'),
    ...(generationKey === undefined ? {} : { generationKey }),
    ...(gateKey === undefined ? {} : { gateKey }),
  };
};

const parseProjectRuntimeSnapshotInput = (action: AutomationActionRunRecord): ProjectRuntimeSnapshotActionInput => {
  const policyStatus = requiredString(action.actionInputJson, 'policy_status');
  const policyDigest = stringField(action.actionInputJson, 'policy_digest');
  const reasonCode = stringField(action.actionInputJson, 'reason_code');
  const observedAt = stringField(action.actionInputJson, 'observed_at');
  if (!policyStatuses.has(policyStatus as ProjectRuntimeSnapshotActionInput['policyStatus'])) {
    throw invalidActionInputJson();
  }
  return {
    repoId: requiredString(action.actionInputJson, 'repo_id'),
    policyStatus: policyStatus as ProjectRuntimeSnapshotActionInput['policyStatus'],
    ...(policyDigest === undefined ? {} : { policyDigest }),
    parserVersion: requiredString(action.actionInputJson, 'parser_version'),
    ...(reasonCode === undefined ? {} : { reasonCode }),
    ...(observedAt === undefined ? {} : { observedAt }),
  };
};

const generationTaskConfigFor = (
  planning: AutomationGenerationPlanningConfig | undefined,
  task: keyof AutomationGenerationPlanningConfig['tasks'],
  fallback: GenerationTaskExecutionConfig,
): GenerationTaskExecutionConfig => {
  if (planning === undefined) {
    return fallback;
  }
  if (planning.mode === 'disabled') {
    return { ...planning.tasks[task], enabled: false };
  }
  return planning.tasks[task];
};

type StructuredCodexGenerationError = {
  code: string;
  retryable: boolean;
  publicResultJson: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const structuredCodexGenerationError = (error: unknown): StructuredCodexGenerationError | undefined => {
  if (error instanceof CodexGenerationError) {
    return { code: error.code, retryable: error.retryable, publicResultJson: error.publicResultJson };
  }
  if (!isRecord(error)) {
    return undefined;
  }
  if (typeof error.code !== 'string' || typeof error.retryable !== 'boolean' || !isRecord(error.publicResultJson)) {
    return undefined;
  }
  return { code: error.code, retryable: error.retryable, publicResultJson: error.publicResultJson };
};

const publicSafeErrorCodes = new Set([
  'codex_generation_disabled',
  'codex_generation_safety_unavailable',
  'codex_generation_sandbox_invalid',
  'codex_app_server_unavailable',
  'codex_generation_timeout',
  'codex_generation_cancelled',
  'codex_generation_concurrency_limit_exceeded',
  'codex_generation_raw_log_too_large',
  'codex_generation_turn_failed',
  'codex_launch_lease_denied',
  'codex_launch_materialization_denied',
  'codex_worker_unavailable',
  'codex_worker_docker_policy_unavailable',
  'codex_app_server_effective_config_mismatch',
  'codex_runtime_workspace_isolation_unavailable',
  'codex_runtime_job_unavailable',
  'codex_runtime_job_expired',
  'codex_runtime_job_cancelled',
  'codex_docker_runtime_evidence_unsafe',
  'codex_runtime_profile_invalid',
  'generated_output_invalid_json',
  'generated_output_ambiguous',
  'generated_output_schema_invalid',
  'generated_output_too_large',
  'generated_package_dependency_invalid',
  'generated_package_manifest_invalid',
  'generated_package_policy_invalid',
  'generated_spec_draft_invalid',
  'generated_plan_draft_invalid',
  'generated_payload_idempotency_drift',
]);

const publicSafeErrorCodeFromMessage = (message: string): string | undefined => {
  const code = message.split(':', 1)[0]?.trim();
  return code !== undefined && publicSafeErrorCodes.has(code) ? code : undefined;
};

const errorCode = (error: unknown): string | undefined => {
  const structuredGenerationError = structuredCodexGenerationError(error);
  if (structuredGenerationError !== undefined) {
    return structuredGenerationError.code;
  }
  if (error instanceof AutomationHttpError) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.message === 'generation_disabled' ? error.message : publicSafeErrorCodeFromMessage(error.message);
  }
  return undefined;
};

const isRetryableTransportError = (error: unknown): boolean => {
  const structuredGenerationError = structuredCodexGenerationError(error);
  if (structuredGenerationError !== undefined) {
    return structuredGenerationError.retryable;
  }
  return !(error instanceof AutomationHttpError) || error.status >= 500 || error.status === 408 || error.status === 429;
};

const isStalePrecondition = (code: string | undefined): boolean =>
  code === 'automation_precondition_stale' || code === 'stale_execution_package_revision';

const isBlockedByGate = (code: string | undefined, error?: unknown): boolean =>
  code === 'generation_disabled' ||
  code === 'codex_generation_disabled' ||
  code === 'codex_generation_safety_unavailable' ||
  code === 'codex_generation_sandbox_invalid' ||
  code === 'codex_launch_lease_denied' ||
  code === 'codex_launch_materialization_denied' ||
  code === 'codex_worker_unavailable' ||
  code === 'codex_worker_docker_policy_unavailable' ||
  code === 'codex_app_server_effective_config_mismatch' ||
  code === 'codex_runtime_workspace_isolation_unavailable' ||
  code === 'codex_runtime_job_unavailable' ||
  code === 'codex_runtime_job_expired' ||
  code === 'codex_docker_runtime_evidence_unsafe' ||
  code === 'codex_runtime_profile_invalid' ||
  code === 'generated_spec_draft_invalid' ||
  code === 'generated_package_dependency_invalid' ||
  code === 'generated_package_manifest_invalid' ||
  code === 'generated_package_policy_invalid' ||
  (code === 'generated_plan_draft_invalid' && error instanceof AutomationHttpError && error.status < 500) ||
  code === 'generated_payload_idempotency_drift' ||
  code === 'manual_path_hold_active' ||
  code === 'automation_hold_active' ||
  code === 'automation_gate_pending' ||
  code === 'automation_gate_blocked';

const isNonRetryableConflict = (code: string | undefined): boolean =>
  code === 'command_idempotency_conflict' ||
  code === 'automation_action_claim_conflict' ||
  code === 'runtime_safety_attestation_mismatch' ||
  code === 'invalid_request_schema';

const resultJsonForError = (error: unknown): Record<string, unknown> => {
  const structuredGenerationError = structuredCodexGenerationError(error);
  if (structuredGenerationError !== undefined) {
    return structuredGenerationError.publicResultJson;
  }
  if (error instanceof AutomationHttpError) {
    return {
      status: error.status,
      ...(error.code === undefined ? {} : { code: error.code }),
    };
  }
  const code = errorCode(error);
  if (
    code === 'generation_disabled' ||
    code === 'codex_generation_disabled' ||
    code === 'codex_generation_sandbox_invalid' ||
    code === 'codex_generation_safety_unavailable' ||
    code === 'codex_app_server_unavailable' ||
    code === 'codex_generation_timeout' ||
    code === 'codex_generation_cancelled' ||
    code === 'codex_generation_concurrency_limit_exceeded' ||
    code === 'codex_generation_raw_log_too_large' ||
    code === 'codex_generation_turn_failed' ||
    code === 'codex_runtime_job_unavailable' ||
    code === 'codex_runtime_job_expired' ||
    code === 'codex_runtime_job_cancelled' ||
    code === 'generated_output_invalid_json' ||
    code === 'generated_output_ambiguous' ||
    code === 'generated_output_schema_invalid' ||
    code === 'generated_output_too_large' ||
    code === 'generated_package_dependency_invalid' ||
    code === 'generated_package_manifest_invalid' ||
    code === 'generated_package_policy_invalid' ||
    code === 'generated_spec_draft_invalid' ||
    code === 'generated_plan_draft_invalid' ||
    code === 'generated_payload_idempotency_drift'
  ) {
    return { status: 422, code };
  }
  return { code: 'transport_error' };
};

const requireActionClaimToken = (action: AutomationActionRunRecord): string => {
  if (action.claimToken === undefined || action.claimToken.length === 0) {
    throw new AutomationHttpError(
      409,
      { code: 'automation_action_claim_required' },
      'Codex launch lease generation requires an active automation action claim.',
    );
  }
  return action.claimToken;
};

const generationOrchestrationFor = (
  action: AutomationActionRunRecord,
  actionType: 'ensure_spec_draft' | 'ensure_plan_draft' | 'ensure_package_drafts',
) => ({
  targetType: 'automation_action_run' as const,
  actionRunId: action.id,
  actionType,
  actionAttempt: action.attempt,
  claimToken: requireActionClaimToken(action),
  preconditionFingerprint: action.preconditionFingerprint,
  automationScope: action.automationScope,
  idempotencyKey: action.idempotencyKey,
});

const completeProjection = async (
  client: AutomationExecutorClient,
  action: AutomationActionRunRecord,
): Promise<AutomationExecutorResult> => {
  const input = parseProjectRuntimeSnapshotInput(action);
  const resultJson = {
    repo_id: input.repoId,
    policy_status: input.policyStatus,
    ...(input.policyDigest === undefined ? {} : { policy_digest: input.policyDigest }),
    parser_version: input.parserVersion,
    ...(input.reasonCode === undefined ? {} : { reason_code: input.reasonCode }),
    ...(input.observedAt === undefined ? {} : { observed_at: input.observedAt }),
  };
  await client.completeAction(action.id, {
    claim_token: action.claimToken ?? '',
    idempotency_key: action.idempotencyKey,
    result_json: resultJson,
  });
  return { actionRunId: action.id, status: 'succeeded', retryable: false };
};

const executeCommand = async (
  client: AutomationExecutorClient,
  action: AutomationActionRunRecord,
  input: Pick<
    ExecuteActionRunInput,
    'actorId' | 'daemonIdentity' | 'generationRuntime' | 'generationPlanning'
  >,
): Promise<void> => {
  const precondition = preconditionFor(action);
  if (action.actionType === 'ensure_spec_draft') {
    const actionInput = parseEnsureSpecDraftInput(action);
    const taskConfig = generationTaskConfigFor(input.generationPlanning, 'spec_draft', {
      enabled: input.generationRuntime !== undefined,
      promptVersion: specDraftPromptVersion,
      outputSchemaVersion: specDraftOutputSchemaVersion,
    });
    const runtime = input.generationRuntime;
    if (!taskConfig.enabled || runtime === undefined) {
      throw new AutomationHttpError(422, { code: 'generation_disabled' }, 'Spec draft generation is disabled');
    }
    const context = await client.specDraftGenerationContext(actionInput.workItemId, {
      actionRunId: action.id,
      claimToken: requireActionClaimToken(action),
    });
    const generated = await runtime.generateSpecDraft({
      actionRunId: action.id,
      projectId: context.work_item.project_id,
      repoIds: context.repos.map((repo) => repo.repo_id),
      context: context as unknown as Record<string, unknown>,
      promptVersion: actionInput.promptVersion ?? taskConfig.promptVersion,
      outputSchemaVersion: actionInput.outputSchemaVersion ?? taskConfig.outputSchemaVersion,
      policyDigests: Object.fromEntries(
        context.repos.flatMap((repo) => (repo.policy_digest === undefined ? [] : [[repo.repo_id, repo.policy_digest]])),
      ),
      orchestration: generationOrchestrationFor(action, 'ensure_spec_draft'),
    });
    let generatedSpecDraft;
    try {
      generatedSpecDraft = validateGeneratedSpecDraft(generated.generated);
    } catch (error) {
      if (error instanceof Error && error.message === 'generated_spec_draft_invalid') {
        throw new AutomationHttpError(422, { code: 'generated_spec_draft_invalid' }, 'Generated Spec draft is invalid');
      }
      throw error;
    }
    await client.ensureSpecDraft(actionInput.workItemId, {
      action_run_id: action.id,
      ...(action.claimToken === undefined ? {} : { claim_token: action.claimToken }),
      idempotency_key: action.idempotencyKey,
      automation_precondition: precondition,
      generated_spec_draft: generatedSpecDraft,
      generation_artifacts: generated.generationArtifacts,
    });
    return;
  }

  if (action.actionType === 'ensure_plan_draft') {
    const actionInput = parseEnsurePlanDraftInput(action);
    const taskConfig = generationTaskConfigFor(input.generationPlanning, 'plan_draft', {
      enabled: input.generationRuntime !== undefined,
      promptVersion: planDraftPromptVersion,
      outputSchemaVersion: planDraftOutputSchemaVersion,
    });
    const runtime = input.generationRuntime;
    if (!taskConfig.enabled || runtime === undefined) {
      throw new AutomationHttpError(422, { code: 'generation_disabled' }, 'Plan draft generation is disabled');
    }
    const context = await client.planDraftGenerationContext(actionInput.workItemId, {
      specRevisionId: actionInput.specRevisionId,
      actionRunId: action.id,
      claimToken: requireActionClaimToken(action),
    });
    let generated;
    try {
      generated = await runtime.generatePlanDraft({
        actionRunId: action.id,
        projectId: context.work_item.project_id,
        repoIds: context.repos.map((repo) => repo.repo_id),
        context: context as unknown as Record<string, unknown>,
        promptVersion: actionInput.promptVersion ?? taskConfig.promptVersion,
        outputSchemaVersion: actionInput.outputSchemaVersion ?? taskConfig.outputSchemaVersion,
        policyDigests: Object.fromEntries(
          context.repos.flatMap((repo) => (repo.policy_digest === undefined ? [] : [[repo.repo_id, repo.policy_digest]])),
        ),
        orchestration: generationOrchestrationFor(action, 'ensure_plan_draft'),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'generated_plan_draft_invalid') {
        throw new AutomationHttpError(502, { code: 'generated_plan_draft_invalid' }, 'Generated Plan draft is invalid');
      }
      throw error;
    }
    let generatedPlanDraft;
    try {
      generatedPlanDraft = validateGeneratedPlanDraft(generated.generated);
    } catch (error) {
      if (error instanceof Error && error.message === 'generated_plan_draft_invalid') {
        throw new AutomationHttpError(422, { code: 'generated_plan_draft_invalid' }, 'Generated Plan draft is invalid');
      }
      throw error;
    }
    await client.ensurePlanDraft(actionInput.workItemId, {
      action_run_id: action.id,
      ...(action.claimToken === undefined ? {} : { claim_token: action.claimToken }),
      idempotency_key: action.idempotencyKey,
      automation_precondition: precondition,
      spec_revision_id: actionInput.specRevisionId,
      generated_plan_draft: generatedPlanDraft,
      generation_artifacts: generated.generationArtifacts,
    });
    return;
  }

  if (action.actionType === 'ensure_package_drafts') {
    const actionInput = parseEnsurePackageDraftsInput(action);
    const taskConfig = generationTaskConfigFor(input.generationPlanning, 'package_drafts', {
      enabled: input.generationRuntime !== undefined,
      promptVersion: actionInput.promptVersion ?? 'package-drafts.fake.v1',
      outputSchemaVersion: actionInput.outputSchemaVersion ?? 'package_drafts.v1',
    });
    const runtime = input.generationRuntime;
    if (!taskConfig.enabled || runtime === undefined) {
      throw new AutomationHttpError(422, { code: 'generation_disabled' }, 'Package draft generation is disabled');
    }
    const context = await client.packageDraftsGenerationContext(actionInput.planRevisionId, {
      generationKey: actionInput.generationKey,
      actionRunId: action.id,
      claimToken: requireActionClaimToken(action),
    });
    const generated = await runtime.generatePackageDrafts({
      actionRunId: action.id,
      projectId: context.work_item.project_id,
      repoIds: context.repos.map((repo) => repo.repo_id),
      context: context as unknown as Record<string, unknown>,
      promptVersion: actionInput.promptVersion ?? taskConfig.promptVersion,
      outputSchemaVersion: actionInput.outputSchemaVersion ?? taskConfig.outputSchemaVersion,
      policyDigests: Object.fromEntries(
        context.repos.flatMap((repo) => (repo.policy_digest === undefined ? [] : [[repo.repo_id, repo.policy_digest]])),
      ),
      orchestration: generationOrchestrationFor(action, 'ensure_package_drafts'),
    });
    let generatedPackageDrafts;
    try {
      generatedPackageDrafts = validateGeneratedPackageDraftSet(generated.generated);
    } catch (error) {
      const code = error instanceof Error ? error.message : undefined;
      if (
        code === 'generated_package_dependency_invalid' ||
        code === 'generated_package_manifest_invalid' ||
        code === 'generated_package_policy_invalid'
      ) {
        throw new AutomationHttpError(422, { code }, 'Generated Package drafts are invalid');
      }
      throw error;
    }
    await client.ensurePackageDrafts(actionInput.planRevisionId, {
      action_run_id: action.id,
      ...(action.claimToken === undefined ? {} : { claim_token: action.claimToken }),
      idempotency_key: action.idempotencyKey,
      automation_precondition: precondition,
      generation_key: actionInput.generationKey,
      generated_package_drafts: generatedPackageDrafts,
      generation_artifacts: generated.generationArtifacts,
    });
    return;
  }

  if (action.actionType === 'request_manual_path') {
    const actionInput = parseRequestManualPathInput(action);
    await client.requestManualPathHold({
      action_run_id: action.id,
      ...(action.claimToken === undefined ? {} : { claim_token: action.claimToken }),
      idempotency_key: action.idempotencyKey,
      automation_precondition: precondition,
      object_type: actionInput.objectType,
      object_id: actionInput.objectId,
      scope_key: actionInput.scopeKey,
      reason_code: actionInput.reasonCode,
      reason: actionInput.reason,
      evidence_refs: [],
      requested_by: input.daemonIdentity ?? input.actorId,
      ...(actionInput.generationKey === undefined ? {} : { generation_key: actionInput.generationKey }),
      ...(actionInput.gateKey === undefined ? {} : { gate_key: actionInput.gateKey }),
    });
  }
};

const terminalReplayResult = (action: AutomationActionRunRecord): AutomationExecutorResult | undefined => {
  if (action.status === 'succeeded') {
    return { actionRunId: action.id, status: 'succeeded', retryable: false };
  }
  if (action.status === 'skipped') {
    return {
      actionRunId: action.id,
      status: 'skipped',
      retryable: false,
      ...(action.reason === undefined ? {} : { reasonCode: action.reason }),
    };
  }
  if ((action.status === 'blocked' || action.status === 'failed') && action.retryable !== true) {
    return {
      actionRunId: action.id,
      status: action.status,
      retryable: false,
      ...(action.errorCode === undefined ? {} : { reasonCode: action.errorCode }),
    };
  }
  return undefined;
};

const markCommandError = async (
  client: AutomationExecutorClient,
  action: AutomationActionRunRecord,
  error: unknown,
): Promise<AutomationExecutorResult> => {
  const code = errorCode(error);
  if (isStalePrecondition(code)) {
    await client.gatePendingAction(action.id, {
      claim_token: action.claimToken ?? '',
      idempotency_key: action.idempotencyKey,
      reason: code ?? 'automation_precondition_stale',
      result_json: resultJsonForError(error),
    });
    return {
      actionRunId: action.id,
      status: 'gate_pending',
      retryable: true,
      ...(code === undefined ? {} : { reasonCode: code }),
    };
  }

  if (isBlockedByGate(code, error)) {
    await client.blockAction(action.id, {
      claim_token: action.claimToken ?? '',
      idempotency_key: action.idempotencyKey,
      retryable: false,
      result_json: resultJsonForError(error),
    });
    return {
      actionRunId: action.id,
      status: 'blocked',
      retryable: false,
      ...(code === undefined ? {} : { reasonCode: code }),
    };
  }

  const retryable = isRetryableTransportError(error) && !isNonRetryableConflict(code);
  await client.failAction(action.id, {
    claim_token: action.claimToken ?? '',
    idempotency_key: action.idempotencyKey,
    retryable,
    result_json: resultJsonForError(error),
  });
  return {
    actionRunId: action.id,
    status: 'failed',
    retryable,
    ...(code === undefined ? {} : { reasonCode: code }),
  };
};

export const executeClaimedAction = async (input: ExecuteClaimedActionInput): Promise<AutomationExecutorResult> => {
  let replayedAction: AutomationActionRunRecord | null;
  try {
    replayedAction = (await input.client.createOrReplayAction(input.action)).action;
  } catch (error) {
    const code = errorCode(error);
    return {
      actionRunId: input.action.idempotencyKey,
      status: 'failed',
      retryable: isRetryableTransportError(error) && !isNonRetryableConflict(code),
      ...(code === undefined ? {} : { reasonCode: code }),
    };
  }
  if (replayedAction !== null) {
    const replayResult = terminalReplayResult(replayedAction);
    if (replayResult !== undefined) {
      return replayResult;
    }
  }

  const claim = await input.client.claimNextAction({
    claimToken: input.claimToken,
    ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
    limit: 1,
    automationScope: input.action.automationScope,
  });
  if (claim.action === null) {
    return { actionRunId: input.action.idempotencyKey, status: 'skipped', retryable: false, reasonCode: 'no_claimable_action' };
  }

  return executeActionRun({
    client: input.client,
    action: claim.action,
    actorId: input.actorId,
    ...(input.daemonIdentity === undefined ? {} : { daemonIdentity: input.daemonIdentity }),
    ...(input.generationRuntime === undefined ? {} : { generationRuntime: input.generationRuntime }),
    ...(input.generationPlanning === undefined ? {} : { generationPlanning: input.generationPlanning }),
  });
};

export const executeActionRun = async (input: ExecuteActionRunInput): Promise<AutomationExecutorResult> => {
  const action = input.action;
  try {
    if (action.actionType === 'project_runtime_snapshot') {
      return await completeProjection(input.client, action);
    }
    await executeCommand(input.client, action, input);
    await input.client.completeAction(action.id, {
      claim_token: action.claimToken ?? '',
      idempotency_key: action.idempotencyKey,
    });
    return { actionRunId: action.id, status: 'succeeded', retryable: false };
  } catch (error) {
    return markCommandError(input.client, action, error);
  }
};
