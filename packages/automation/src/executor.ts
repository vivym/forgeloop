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

const preconditionFor = (action: AutomationActionRunRecord, input: ExecuteClaimedActionInput): AutomationPrecondition => {
  const scope = projectAndRepoFromScope(action.automationScope);
  return {
    automation_scope: action.automationScope,
    project_id: scope.projectId,
    ...(scope.repoId === undefined ? {} : { repo_id: scope.repoId }),
    automation_settings_version: action.automationSettingsVersion,
    capability_fingerprint: action.capabilityFingerprint,
    required_capability: requiredCapabilityFor(action),
    actor_class: 'automation_daemon',
  };
};

const stringField = (input: Record<string, unknown>, field: string): string | undefined =>
  typeof input[field] === 'string' ? input[field] : undefined;

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
  code === 'manual_path_hold_active' || code === 'automation_gate_pending';

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
  const input = action.actionInputJson;
  const resultJson = {
    repo_id: stringField(input, 'repo_id') ?? action.targetObjectId,
    policy_status: stringField(input, 'policy_status') ?? action.targetStatus,
    ...(stringField(input, 'policy_digest') === undefined ? {} : { policy_digest: stringField(input, 'policy_digest') }),
    parser_version: stringField(input, 'parser_version') ?? 'unknown',
    ...(stringField(input, 'reason_code') === undefined ? {} : { reason_code: stringField(input, 'reason_code') }),
    ...(stringField(input, 'observed_at') === undefined ? {} : { observed_at: stringField(input, 'observed_at') }),
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
  const precondition = preconditionFor(action, input);
  if (action.actionType === 'ensure_plan_draft') {
    const workItemId = stringField(action.actionInputJson, 'work_item_id') ?? action.targetObjectId;
    const specRevisionId = stringField(action.actionInputJson, 'spec_revision_id') ?? action.targetRevisionId;
    if (specRevisionId === undefined) {
      throw new AutomationHttpError(422, { code: 'invalid_request_schema' });
    }
    await client.ensurePlanDraft(workItemId, {
      action_run_id: action.id,
      ...(action.claimToken === undefined ? {} : { claim_token: action.claimToken }),
      idempotency_key: action.idempotencyKey,
      automation_precondition: precondition,
      spec_revision_id: specRevisionId,
    });
    return;
  }

  if (action.actionType === 'ensure_package_drafts') {
    const planRevisionId = stringField(action.actionInputJson, 'plan_revision_id') ?? action.targetObjectId;
    const generationKey = stringField(action.actionInputJson, 'generation_key') ?? action.targetRevisionId;
    await client.ensurePackageDrafts(planRevisionId, {
      action_run_id: action.id,
      ...(action.claimToken === undefined ? {} : { claim_token: action.claimToken }),
      idempotency_key: action.idempotencyKey,
      automation_precondition: precondition,
      ...(generationKey === undefined ? {} : { generation_key: generationKey }),
    });
    return;
  }

  if (action.actionType === 'request_manual_path') {
    const generationKey = stringField(action.actionInputJson, 'generation_key');
    const gateKey = stringField(action.actionInputJson, 'gate_key');
    await client.requestManualPathHold({
      action_run_id: action.id,
      ...(action.claimToken === undefined ? {} : { claim_token: action.claimToken }),
      idempotency_key: action.idempotencyKey,
      automation_precondition: precondition,
      object_type: stringField(action.actionInputJson, 'object_type') ?? action.targetObjectType,
      object_id: stringField(action.actionInputJson, 'object_id') ?? action.targetObjectId,
      scope_key: stringField(action.actionInputJson, 'scope_key') ?? `${action.targetObjectType}:${action.targetObjectId}`,
      reason_code: stringField(action.actionInputJson, 'reason_code') ?? 'manual_path_required',
      reason: stringField(action.actionInputJson, 'reason') ?? 'Automation requires a manual path.',
      evidence_refs: [],
      requested_by: input.daemonIdentity ?? input.actorId,
      ...(generationKey === undefined ? {} : { generation_key: generationKey }),
      ...(gateKey === undefined ? {} : { gate_key: gateKey }),
    });
  }
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
  try {
    await input.client.createOrReplayAction(input.action);
  } catch (error) {
    const code = errorCode(error);
    return {
      actionRunId: input.action.idempotencyKey,
      status: 'failed',
      retryable: isRetryableTransportError(error) && !isNonRetryableConflict(code),
      ...(code === undefined ? {} : { reasonCode: code }),
    };
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
  if (action.actionType === 'project_runtime_snapshot') {
    return completeProjection(input.client, action);
  }

  try {
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
