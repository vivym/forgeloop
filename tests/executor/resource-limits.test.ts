import { describe, expect, it } from 'vitest';

import {
  resourceLimitDigest,
  validateRunExecutionAttestation,
  type ResourceLimitVector,
  type RunExecutionAttestationBinding,
} from '../../packages/executor/src/index';
import type { RuntimeSafetyAttestation } from '../../packages/domain/src/index';

const sha = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';

const limitVector = (overrides: Partial<ResourceLimitVector> = {}): ResourceLimitVector => ({
  cpu_ms: 1_000,
  memory_mb: 512,
  pids: 32,
  fds: 64,
  workspace_bytes: 1_048_576,
  artifact_bytes: 1_048_576,
  timeout_ms: 30_000,
  output_limit_bytes: 100_000,
  run_output_limit_bytes: 500_000,
  ...overrides,
});

const runBinding = (overrides: Partial<RunExecutionAttestationBinding> = {}): RunExecutionAttestationBinding => {
  const resourceLimits = limitVector();
  return {
    executorType: 'local_codex',
    workflowOnly: false,
    environment: 'local_dogfood',
    projectId: 'project-1',
    repoId: 'repo-1',
    executionPackageId: 'package-1',
    expectedPackageVersion: 2,
    runId: 'run-1',
    policyDigest: sha,
    policySnapshotVersion: 1,
    envPolicyDigest: sha,
    commandPolicyDigest: sha,
    mountPolicyDigest: sha,
    networkPolicyDigest: 'network-disabled',
    networkMode: 'disabled',
    resourceLimitDigest: resourceLimitDigest(resourceLimits),
    governorId: 'governor-1',
    sandboxId: 'sandbox-1',
    sandboxVersion: 'sandbox@1',
    sandboxBinaryDigest: sha,
    sandboxConfigDigest: sha,
    sandboxWrapperEnvironmentDigest: sha,
    workspaceRoot: '/workspace/repo',
    artifactRoot: '/artifacts/run-1',
    sandboxOutputRoot: '/sandbox-output/run-1',
    now: '2026-05-05T00:00:00.000Z',
    ...overrides,
  };
};

const runAttestation = (overrides: Partial<RuntimeSafetyAttestation> = {}): RuntimeSafetyAttestation => {
  const resourceLimits = limitVector();
  return {
    attestation_scope: 'run_execution',
    hard_limit_mode: 'enforcing',
    environment: 'local_dogfood',
    executor_type: 'local_codex',
    workflow_only: false,
    governor_id: 'governor-1',
    governor_provenance: 'external_sandbox',
    checked_at: '2026-05-05T00:00:00.000Z',
    max_command_timeout_ms: 120_000,
    max_hook_timeout_ms: 30_000,
    max_command_output_bytes: 1_000_000,
    max_run_output_bytes: 5_000_000,
    supports_cpu_limit: true,
    supports_memory_limit: true,
    supports_process_limit: true,
    supports_fd_limit: true,
    supports_workspace_disk_limit: true,
    supports_artifact_size_limit: true,
    network_mode: 'disabled',
    project_id: 'project-1',
    repo_id: 'repo-1',
    execution_package_id: 'package-1',
    expected_package_version: 2,
    run_id: 'run-1',
    policy_digest: sha,
    policy_snapshot_version: 1,
    env_policy_digest: sha,
    command_policy_digest: sha,
    mount_policy_digest: sha,
    network_policy_digest: 'network-disabled',
    resource_limit_digest: resourceLimitDigest(resourceLimits),
    resource_limits: resourceLimits,
    sandbox_id: 'sandbox-1',
    sandbox_version: 'sandbox@1',
    sandbox_binary_digest: sha,
    sandbox_config_digest: sha,
    sandbox_wrapper_environment_digest: sha,
    workspace_root: '/workspace/repo',
    artifact_root: '/artifacts/run-1',
    sandbox_output_root: '/sandbox-output/run-1',
    supports_filesystem_containment: true,
    supports_host_secret_isolation: true,
    supports_network_policy: true,
    supports_wrapper_env_isolation: true,
    supports_process_tree_kill: true,
    expires_at: '2026-05-05T00:05:00.000Z',
    ...overrides,
  };
};

describe('executor resource limits', () => {
  it('computes a stable canonical digest independent of object key insertion order', () => {
    const canonical = resourceLimitDigest(limitVector());
    const reordered: ResourceLimitVector = {
      run_output_limit_bytes: 500_000,
      output_limit_bytes: 100_000,
      timeout_ms: 30_000,
      artifact_bytes: 1_048_576,
      workspace_bytes: 1_048_576,
      fds: 64,
      pids: 32,
      memory_mb: 512,
      cpu_ms: 1_000,
    };

    expect(canonical).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(resourceLimitDigest(reordered)).toBe(canonical);
  });

  it('changes the resource limit digest when any vector field changes', () => {
    const baseline = resourceLimitDigest(limitVector());

    for (const key of Object.keys(limitVector()) as Array<keyof ResourceLimitVector>) {
      expect(resourceLimitDigest(limitVector({ [key]: limitVector()[key] + 1 }))).not.toBe(baseline);
    }
  });

  it('rejects resource limits whose timeout or output caps exceed hard maxima', () => {
    const oversized = limitVector({ timeout_ms: 120_001 });

    expect(
      validateRunExecutionAttestation({
        attestation: runAttestation({
          resource_limits: oversized,
          resource_limit_digest: resourceLimitDigest(oversized),
        }),
        expected: runBinding({ resourceLimitDigest: resourceLimitDigest(oversized) }),
      }),
    ).toMatchObject({
      ok: false,
      code: 'runtime_resource_limits_exceed_hard_max',
    });
  });

  it('requires process-tree kill and every hard-limit dimension for production/local Codex enforcement', () => {
    expect(
      validateRunExecutionAttestation({
        attestation: runAttestation({ supports_process_tree_kill: false }),
        expected: runBinding(),
      }),
    ).toMatchObject({
      ok: false,
      code: 'runtime_hard_limits_not_enforcing',
    });
  });

  it.each([
    ['governor id', { governor_id: 'governor-other' }],
    ['sandbox id', { sandbox_id: 'sandbox-other' }],
    ['sandbox version', { sandbox_version: 'sandbox@2' }],
    ['sandbox binary digest', { sandbox_binary_digest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111' }],
    ['sandbox config digest', { sandbox_config_digest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222' }],
    ['sandbox wrapper environment digest', { sandbox_wrapper_environment_digest: 'sha256:3333333333333333333333333333333333333333333333333333333333333333' }],
  ] as const)('rejects run execution attestations with mismatched %s', (_label, overrides) => {
    expect(
      validateRunExecutionAttestation({
        attestation: runAttestation(overrides),
        expected: runBinding(),
      }),
    ).toMatchObject({
      ok: false,
      code: 'runtime_safety_attestation_mismatch',
    });
  });

  it('requires run execution attestations to carry an expiry', () => {
    expect(
      validateRunExecutionAttestation({
        attestation: runAttestation({ expires_at: undefined }),
        expected: runBinding(),
      }),
    ).toMatchObject({
      ok: false,
      code: 'runtime_safety_attestation_stale',
    });
  });

  it.each([
    ['missing max command timeout', { max_command_timeout_ms: undefined }],
    ['zero max command timeout', { max_command_timeout_ms: 0 }],
    ['missing max hook timeout', { max_hook_timeout_ms: undefined }],
    ['missing max command output bytes', { max_command_output_bytes: undefined }],
    ['missing max run output bytes', { max_run_output_bytes: undefined }],
  ] as const)('maps %s to runtime_hard_limits_unavailable', (_label, overrides) => {
    expect(
      validateRunExecutionAttestation({
        attestation: runAttestation(overrides),
        expected: runBinding(),
      }),
    ).toMatchObject({
      ok: false,
      code: 'runtime_hard_limits_unavailable',
    });
  });

  it('maps missing or unavailable hard limits to runtime_hard_limits_unavailable', () => {
    expect(
      validateRunExecutionAttestation({
        attestation: undefined,
        expected: runBinding(),
      }),
    ).toMatchObject({
      ok: false,
      code: 'runtime_hard_limits_unavailable',
    });

    expect(
      validateRunExecutionAttestation({
        attestation: runAttestation({ hard_limit_mode: 'unavailable' }),
        expected: runBinding(),
      }),
    ).toMatchObject({
      ok: false,
      code: 'runtime_hard_limits_unavailable',
    });
  });
});
