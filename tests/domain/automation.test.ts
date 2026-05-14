import { describe, expect, it } from 'vitest';

import {
  DomainError,
  assertAutomationCapabilityActor,
  assertCanonicalManualScopeKey,
  automationCapabilitiesForPreset,
  buildManualScopeKey,
  capabilityFingerprint,
  isActiveRunSessionStatus,
  isOpenReviewPacketStatus,
  isWorkItemAutomationTerminal,
  type AutomationActorClass,
  type PackageRuntimePolicySnapshot,
  type RuntimeHardLimitMode,
  type RuntimeSafetyAttestation,
  type WorkItem,
} from '../../packages/domain/src/index';

const expectDomainError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }

  throw new Error(`Expected DomainError ${code}`);
};

describe('domain automation contracts', () => {
  const planActorClasses = [
    'human_admin',
    'human',
    'system_bootstrap',
    'migration',
    'automation_daemon',
    'source_adapter',
    'external_tracker',
    'repo_policy',
  ] as const satisfies readonly AutomationActorClass[];

  const runtimeHardLimitModes = [
    'unavailable',
    'test_only_mock',
    'enforcing',
  ] as const satisfies readonly RuntimeHardLimitMode[];

  const runtimeSafetyAttestation = {
    hard_limit_mode: 'test_only_mock',
    environment: 'test',
    executor_type: 'mock',
    workflow_only: true,
    governor_id: 'governor-test-mock',
    governor_provenance: 'test_only_mock',
    checked_at: '2026-05-05T00:00:00.000Z',
    max_command_timeout_ms: 120_000,
    max_hook_timeout_ms: 30_000,
    max_command_output_bytes: 1_000_000,
    max_run_output_bytes: 5_000_000,
    supports_cpu_limit: false,
    supports_memory_limit: false,
    supports_process_limit: false,
    supports_fd_limit: false,
    supports_workspace_disk_limit: false,
    supports_artifact_size_limit: false,
    reason_code: 'test_fixture',
  } satisfies RuntimeSafetyAttestation;

  const packageRuntimePolicySnapshot = {
    policy_snapshot_version: 1,
    policy_digest: 'policy-digest-1',
    policy_source_path: 'policies/runtime-policy.json',
    policy_loaded_at: '2026-05-05T00:00:00.000Z',
    policy_last_known_good: true,
    hooks: [],
    command_policy: { default_timeout_ms: 120_000 },
    check_policy: { required_checks: ['domain-tests'] },
    env_policy: { allowed: ['CI'] },
    path_policy: { allowed_paths: ['packages/domain/**'] },
    codex_runtime_mode: 'mock',
    fallback_policy: { allow_exec_fallback: false },
    validation_strategy: 'checks_required',
    validation_public_summary: 'Domain tests are required.',
  } satisfies PackageRuntimePolicySnapshot;

  it('locks the plan-compatible automation actor and runtime safety contract strings', () => {
    expect(planActorClasses).toEqual([
      'human_admin',
      'human',
      'system_bootstrap',
      'migration',
      'automation_daemon',
      'source_adapter',
      'external_tracker',
      'repo_policy',
    ]);
    expect(runtimeHardLimitModes).toEqual(['unavailable', 'test_only_mock', 'enforcing']);
    expect(runtimeSafetyAttestation).toMatchObject({
      hard_limit_mode: 'test_only_mock',
      governor_provenance: 'test_only_mock',
      workflow_only: true,
    });
    expect(packageRuntimePolicySnapshot).toMatchObject({
      policy_snapshot_version: 1,
      validation_strategy: 'checks_required',
      policy_last_known_good: true,
    });
  });

  it('returns all capabilities disabled for the off preset', () => {
    expect(automationCapabilitiesForPreset('off')).toEqual({
      canProjectRuntimeState: false,
      canGeneratePlanDraft: false,
      canGeneratePackageDrafts: false,
      canEnqueueRuns: false,
    });
  });

  it('treats presets as named capability maps instead of ordinal levels', () => {
    expect(automationCapabilitiesForPreset('ready_projection')).toEqual({
      canProjectRuntimeState: true,
      canGeneratePlanDraft: false,
      canGeneratePackageDrafts: false,
      canEnqueueRuns: false,
    });
    expect(automationCapabilitiesForPreset('draft_only')).toEqual({
      canProjectRuntimeState: true,
      canGeneratePlanDraft: true,
      canGeneratePackageDrafts: true,
      canEnqueueRuns: false,
    });
    expect(automationCapabilitiesForPreset('run_enqueue')).toEqual({
      canProjectRuntimeState: true,
      canGeneratePlanDraft: true,
      canGeneratePackageDrafts: true,
      canEnqueueRuns: true,
    });
  });

  it.each(['automation_daemon', 'source_adapter', 'external_tracker', 'repo_policy'] as const)(
    'rejects %s actors for capability updates',
    (actorClass) => {
      expectDomainError(
        () =>
          assertAutomationCapabilityActor({
            actor_class: actorClass,
            actor_id: `${actorClass}-actor`,
          }),
        'AUTOMATION_CAPABILITY_REJECTED',
      );
    },
  );

  it.each(['daemon', 'system'] as const)('rejects legacy %s actor class strings', (actorClass) => {
    expectDomainError(
      () =>
        assertAutomationCapabilityActor({
          actor_class: actorClass as AutomationActorClass,
          actor_id: `${actorClass}-actor`,
        }),
      'AUTOMATION_CAPABILITY_REJECTED',
    );
  });

  it.each(['human_admin', 'human', 'system_bootstrap', 'migration'] as const)(
    'allows %s actors for capability updates',
    (actorClass) => {
      expect(() =>
        assertAutomationCapabilityActor({
          actor_class: actorClass,
          actor_id: `${actorClass}-actor`,
        }),
      ).not.toThrow();
    },
  );

  it('produces stable fingerprints for normalized capability objects', () => {
    const first = capabilityFingerprint({
      canEnqueueRuns: false,
      canGeneratePackageDrafts: true,
      canGeneratePlanDraft: true,
      canProjectRuntimeState: true,
    });
    const second = capabilityFingerprint({
      canProjectRuntimeState: true,
      canGeneratePlanDraft: true,
      canGeneratePackageDrafts: true,
      canEnqueueRuns: false,
    });

    expect(first).toBe(second);
    expect(
      capabilityFingerprint({
        canProjectRuntimeState: true,
        canGeneratePlanDraft: true,
        canGeneratePackageDrafts: false,
        canEnqueueRuns: false,
      }),
    ).not.toBe(first);
  });

  it('builds and validates canonical manual scope keys', () => {
    const scopeKey = buildManualScopeKey({
      object_type: 'package_generation',
      object_id: 'plan-revision-1',
      generation_key: 'default:plan-revision-1',
    });

    expect(scopeKey).toBe('package_generation:plan-revision-1:default:plan-revision-1');
    expect(() =>
      assertCanonicalManualScopeKey(scopeKey, {
        object_type: 'package_generation',
        object_id: 'plan-revision-1',
        generation_key: 'default:plan-revision-1',
      }),
    ).not.toThrow();
    expectDomainError(
      () =>
        assertCanonicalManualScopeKey('package_generation:plan-revision-1:other', {
          object_type: 'package_generation',
          object_id: 'plan-revision-1',
          generation_key: 'default:plan-revision-1',
        }),
      'MANUAL_PATH_SCOPE_INVALID',
    );
  });

  it('exposes open review and active run status helpers for daemon gate checks', () => {
    expect(isOpenReviewPacketStatus('draft')).toBe(true);
    expect(isOpenReviewPacketStatus('ready')).toBe(true);
    expect(isOpenReviewPacketStatus('in_review')).toBe(true);
    expect(isOpenReviewPacketStatus('escalated')).toBe(true);
    expect(isOpenReviewPacketStatus('completed')).toBe(false);

    expect(isActiveRunSessionStatus('queued')).toBe(true);
    expect(isActiveRunSessionStatus('running')).toBe(true);
    expect(isActiveRunSessionStatus('waiting_for_input')).toBe(true);
    expect(isActiveRunSessionStatus('stalled')).toBe(true);
    expect(isActiveRunSessionStatus('resuming')).toBe(true);
    expect(isActiveRunSessionStatus('cancel_requested')).toBe(true);
    expect(isActiveRunSessionStatus('succeeded')).toBe(false);
  });

  it('treats archived and deleted work items as automation-terminal', () => {
    const openWorkItem: Pick<WorkItem, 'phase' | 'resolution' | 'archived_at' | 'deleted_at'> = {
      phase: 'execution',
      resolution: 'none',
    };

    expect(isWorkItemAutomationTerminal(openWorkItem)).toBe(false);
    expect(isWorkItemAutomationTerminal({ ...openWorkItem, archived_at: '2026-05-05T00:00:00.000Z' })).toBe(true);
    expect(isWorkItemAutomationTerminal({ ...openWorkItem, deleted_at: '2026-05-05T00:00:00.000Z' })).toBe(true);
  });
});
