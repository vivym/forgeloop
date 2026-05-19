import type { AutomationPrecondition, AutomationPreconditionCapability, AutomationScope } from '@forgeloop/domain';
import {
  planDraftOutputSchemaVersion,
  planDraftPromptVersion,
  validateGeneratedPlanDraft,
  type CodexGenerationRuntime,
} from '@forgeloop/codex-runtime';

import { AutomationHttpError } from './http-client.js';
import {
  disabledSpecDraftGenerator,
  validateGeneratedSpecDraft,
  type SpecDraftGenerator,
} from './spec-draft-generation.js';
import type {
  AutomationActionRunRecord,
  AutomationExecutorClient,
  AutomationExecutorResult,
  NextAction,
} from './types.js';

export interface ExecuteClaimedActionInput {
  client: AutomationExecutorClient;
  action: NextAction;
  claimToken: string;
  actorId: string;
  daemonIdentity?: string;
  leaseMs?: number;
  specDraftGenerator?: SpecDraftGenerator;
  generationRuntime?: CodexGenerationRuntime;
}

export interface ExecuteActionRunInput {
  client: AutomationExecutorClient;
  action: AutomationActionRunRecord;
  actorId: string;
  daemonIdentity?: string;
  specDraftGenerator?: SpecDraftGenerator;
  generationRuntime?: CodexGenerationRuntime;
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
};

type EnsureSpecDraftActionInput = {
  workItemId: string;
};

type EnsurePackageDraftsActionInput = {
  planRevisionId: string;
  generationKey: string;
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

const parseEnsurePlanDraftInput = (action: AutomationActionRunRecord): EnsurePlanDraftActionInput => ({
  workItemId: requiredString(action.actionInputJson, 'work_item_id'),
  specRevisionId: requiredString(action.actionInputJson, 'spec_revision_id'),
});

const parseEnsureSpecDraftInput = (action: AutomationActionRunRecord): EnsureSpecDraftActionInput => ({
  workItemId: requiredString(action.actionInputJson, 'work_item_id'),
});

const parseEnsurePackageDraftsInput = (action: AutomationActionRunRecord): EnsurePackageDraftsActionInput => ({
  planRevisionId: requiredString(action.actionInputJson, 'plan_revision_id'),
  generationKey: requiredString(action.actionInputJson, 'generation_key'),
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

const errorCode = (error: unknown): string | undefined => {
  if (error instanceof AutomationHttpError) {
    return error.code;
  }
  if (
    error instanceof Error &&
    (error.message === 'generation_disabled' ||
      error.message === 'generated_spec_draft_invalid' ||
      error.message === 'generated_plan_draft_invalid')
  ) {
    return error.message;
  }
  return undefined;
};

const isRetryableTransportError = (error: unknown): boolean =>
  !(error instanceof AutomationHttpError) || error.status >= 500 || error.status === 408 || error.status === 429;

const isStalePrecondition = (code: string | undefined): boolean =>
  code === 'automation_precondition_stale' || code === 'stale_execution_package_revision';

const isBlockedByGate = (code: string | undefined, error?: unknown): boolean =>
  code === 'generation_disabled' ||
  code === 'generated_spec_draft_invalid' ||
  (code === 'generated_plan_draft_invalid' && error instanceof AutomationHttpError && error.status < 500) ||
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
  if (error instanceof AutomationHttpError) {
    return {
      status: error.status,
      ...(error.code === undefined ? {} : { code: error.code }),
    };
  }
  const code = errorCode(error);
  if (code === 'generation_disabled' || code === 'generated_spec_draft_invalid' || code === 'generated_plan_draft_invalid') {
    return { status: 422, code };
  }
  return { code: 'transport_error' };
};

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
  input: Pick<ExecuteActionRunInput, 'actorId' | 'daemonIdentity' | 'specDraftGenerator' | 'generationRuntime'>,
): Promise<void> => {
  const precondition = preconditionFor(action);
  if (action.actionType === 'ensure_spec_draft') {
    const actionInput = parseEnsureSpecDraftInput(action);
    const generator = input.specDraftGenerator ?? disabledSpecDraftGenerator;
    if (generator.mode === 'disabled') {
      throw new AutomationHttpError(422, { code: 'generation_disabled' }, 'Spec draft generation is disabled');
    }
    const context = await client.specDraftGenerationContext(actionInput.workItemId, {
      actionRunId: action.id,
      claimToken: action.claimToken ?? '',
    });
    const generated = await generator.generateSpecDraft(context);
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
    const runtime = input.generationRuntime;
    if (runtime === undefined) {
      throw new AutomationHttpError(422, { code: 'generation_disabled' }, 'Plan draft generation is disabled');
    }
    const context = await client.planDraftGenerationContext(actionInput.workItemId, {
      specRevisionId: actionInput.specRevisionId,
      actionRunId: action.id,
      claimToken: action.claimToken ?? '',
    });
    let generated;
    try {
      generated = await runtime.generatePlanDraft({
        actionRunId: action.id,
        projectId: context.work_item.project_id,
        repoIds: context.repos.map((repo) => repo.repo_id),
        context: context as unknown as Record<string, unknown>,
        promptVersion: planDraftPromptVersion,
        outputSchemaVersion: planDraftOutputSchemaVersion,
        policyDigests: Object.fromEntries(
          context.repos.flatMap((repo) => (repo.policy_digest === undefined ? [] : [[repo.repo_id, repo.policy_digest]])),
        ),
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
    await client.ensurePackageDrafts(actionInput.planRevisionId, {
      action_run_id: action.id,
      ...(action.claimToken === undefined ? {} : { claim_token: action.claimToken }),
      idempotency_key: action.idempotencyKey,
      automation_precondition: precondition,
      generation_key: actionInput.generationKey,
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
    ...(input.specDraftGenerator === undefined ? {} : { specDraftGenerator: input.specDraftGenerator }),
    ...(input.generationRuntime === undefined ? {} : { generationRuntime: input.generationRuntime }),
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
