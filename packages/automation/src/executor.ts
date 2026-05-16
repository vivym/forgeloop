import type { AutomationPrecondition, AutomationPreconditionCapability, AutomationScope } from '@forgeloop/domain';

import { AutomationHttpError } from './http-client.js';
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
}

const projectAndRepoFromScope = (automationScope: AutomationScope): { projectId: string; repoId?: string } => {
  const [scopeType, projectId, repoId] = automationScope.split(':');
  if (scopeType === 'repo' && projectId !== undefined && repoId !== undefined) {
    return { projectId, repoId };
  }
  return { projectId: projectId ?? '' };
};

const requiredCapabilityFor = (action: AutomationActionRunRecord): AutomationPreconditionCapability => {
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
  return undefined;
};

const isRetryableTransportError = (error: unknown): boolean =>
  !(error instanceof AutomationHttpError) || error.status >= 500 || error.status === 408 || error.status === 429;

const isStalePrecondition = (code: string | undefined): boolean =>
  code === 'automation_precondition_stale' || code === 'stale_execution_package_revision';

const isBlockedByGate = (code: string | undefined): boolean =>
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
  input: ExecuteClaimedActionInput,
): Promise<void> => {
  const precondition = preconditionFor(action);
  if (action.actionType === 'ensure_plan_draft') {
    const actionInput = parseEnsurePlanDraftInput(action);
    await client.ensurePlanDraft(actionInput.workItemId, {
      action_run_id: action.id,
      ...(action.claimToken === undefined ? {} : { claim_token: action.claimToken }),
      idempotency_key: action.idempotencyKey,
      automation_precondition: precondition,
      spec_revision_id: actionInput.specRevisionId,
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

  if (isBlockedByGate(code)) {
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

  const action = claim.action;
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
