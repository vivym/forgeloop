import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import {
  automationPreconditionFingerprint as domainAutomationPreconditionFingerprint,
  isActiveRunSessionStatus,
  isOpenReviewPacketStatus,
  type AutomationPrecondition,
  type AutomationPreconditionCapability,
  type AutomationProjectSettings,
  type AutomationScope,
  type ExecutionPackage,
  type ManualPathHold,
  type ReviewPacket,
  type RunSession,
  type RuntimeSafetyAttestation,
} from '@forgeloop/domain';
import type { ExecutorType } from '@forgeloop/contracts';
import type { DeliveryRepository } from '@forgeloop/db';

export const normalizeAutomationPrecondition = (precondition: AutomationPrecondition): AutomationPrecondition => ({
  ...precondition,
  ...(precondition.repo_id === undefined ? {} : { repo_id: precondition.repo_id }),
  ...(precondition.daemon_identity === undefined ? {} : { daemon_identity: precondition.daemon_identity }),
});

export const automationPreconditionFingerprint = (precondition: AutomationPrecondition): string =>
  domainAutomationPreconditionFingerprint(normalizeAutomationPrecondition(precondition));

export const commandIdempotencyTarget = (input: {
  objectType: string;
  objectId: string;
  revisionId?: string;
  version?: number;
}) => ({
  target_object_type: input.objectType,
  target_object_id: input.objectId,
  ...(input.revisionId === undefined ? {} : { target_revision_id: input.revisionId }),
  ...(input.version === undefined ? {} : { target_version: input.version }),
});

export const publicAutomationError = (code: string, message: string, details: Record<string, unknown> = {}) =>
  new UnprocessableEntityException({ code, message, ...details });

export const automationScopeFor = (projectId: string, repoId: string | undefined): AutomationScope =>
  repoId === undefined ? `project:${projectId}` : `repo:${projectId}:${repoId}`;

export const assertAutomationPreconditionStillCurrent = (
  settings: AutomationProjectSettings,
  precondition: AutomationPrecondition,
): void => {
  const expectedScope = automationScopeFor(precondition.project_id, precondition.repo_id);
  const actualScope = automationScopeFor(settings.project_id, settings.repo_id);
  if (
    precondition.automation_scope !== expectedScope ||
    actualScope !== expectedScope ||
    settings.project_id !== precondition.project_id ||
    settings.repo_id !== precondition.repo_id ||
    settings.version !== precondition.automation_settings_version ||
    settings.capability_fingerprint !== precondition.capability_fingerprint
  ) {
    throw new ConflictException({
      code: 'automation_precondition_stale',
      message: 'Automation precondition no longer matches current project settings.',
    });
  }
};

export const assertCommandCapabilityStillEnabled = (
  settings: AutomationProjectSettings,
  capability: AutomationPreconditionCapability,
): void => {
  if (settings.capabilities_json[capability] !== true) {
    throw publicAutomationError('automation_capability_disabled', `Automation capability ${capability} is disabled.`);
  }
};

export const assertNoActiveHolds = async (
  repository: DeliveryRepository,
  targets: Array<{ object_type: string; object_id: string; generation_key?: string; gate_key?: string }>,
): Promise<void> => {
  for (const target of targets) {
    const holds = await repository.listActiveManualPathHolds(target);
    if (holds.length > 0) {
      throw publicAutomationError('manual_path_hold_active', `Manual path hold is active for ${target.object_type}:${target.object_id}.`, {
        hold_ids: holds.map((hold) => hold.id),
      });
    }
  }
};

export const assertPackageRunEligible = (input: {
  executionPackage: ExecutionPackage;
  expectedPackageVersion: number;
  openReviewPacket?: ReviewPacket;
  activeRunSession?: RunSession;
  activeHolds: ManualPathHold[];
}): void => {
  if (input.executionPackage.version !== input.expectedPackageVersion) {
    throw publicAutomationError('stale_execution_package_revision', 'Execution package version changed before run enqueue.');
  }
  if (input.activeHolds.length > 0) {
    throw publicAutomationError('manual_path_hold_active', 'Manual path hold blocks run enqueue.', {
      hold_ids: input.activeHolds.map((hold) => hold.id),
    });
  }
  if (input.openReviewPacket !== undefined && isOpenReviewPacketStatus(input.openReviewPacket.status)) {
    throw publicAutomationError('automation_gate_pending', 'Open review packet blocks run enqueue.');
  }
  if (input.activeRunSession !== undefined && isActiveRunSessionStatus(input.activeRunSession.status)) {
    throw publicAutomationError('automation_gate_pending', 'Active run session blocks duplicate run enqueue.');
  }
};

export const assertRuntimeSafetyAttestation = (
  attestation: RuntimeSafetyAttestation | undefined,
  input: { executorType: ExecutorType; workflowOnly: boolean; now?: string; maxAgeMs?: number },
): void => {
  if (attestation === undefined || attestation.hard_limit_mode === 'unavailable') {
    throw publicAutomationError('runtime_hard_limits_unavailable', 'Runtime hard limits are unavailable.');
  }
  if (attestation.executor_type !== input.executorType || attestation.workflow_only !== input.workflowOnly) {
    throw new BadRequestException({
      code: 'runtime_safety_attestation_mismatch',
      message: 'Runtime safety attestation does not match the enqueue request.',
    });
  }
  if ((attestation.environment === 'production' || input.executorType === 'local_codex') && attestation.hard_limit_mode !== 'enforcing') {
    throw new BadRequestException({
      code: 'runtime_hard_limits_not_enforcing',
      message: 'Production and local Codex run enqueue require enforcing runtime hard limits.',
    });
  }
  if (
    attestation.hard_limit_mode === 'test_only_mock' &&
    !(input.executorType === 'mock' && input.workflowOnly === true && attestation.environment !== 'production')
  ) {
    throw new BadRequestException({
      code: 'runtime_test_only_mock_forbidden',
      message: 'test_only_mock runtime safety attestation is only valid for mock workflow-only local/test runs.',
    });
  }
  const checkedAt = Date.parse(attestation.checked_at);
  const now = input.now === undefined ? undefined : Date.parse(input.now);
  if (Number.isNaN(checkedAt) || (now !== undefined && checkedAt + (input.maxAgeMs ?? 5 * 60 * 1000) < now)) {
    throw new BadRequestException({
      code: 'runtime_safety_attestation_stale',
      message: 'Runtime safety attestation is stale.',
    });
  }
};
