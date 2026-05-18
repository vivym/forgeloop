import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { ArtifactKind, ArtifactRef } from '@forgeloop/contracts';
import type { RuntimeGovernorProvenance, RuntimeSafetyAttestation, RuntimeSafetyEnvironment } from '@forgeloop/domain';
import { resourceLimitDigest, type ResourceLimitVector } from '@forgeloop/domain';
import {
  primaryExecutorCommandDigest,
  structuredCommandDigest,
  structuredCommandResultFromGovernor,
  type MaterializedStructuredCommand,
  type PrimaryExecutorDigestBinding,
  type StructuredCommandOutputArtifacts,
  type StructuredCommandResult,
  type Visibility,
  type SourceWritePolicy,
} from './structured-command.js';

export type GovernorScope = 'bootstrap' | 'run';
export type RuntimeNetworkMode = 'disabled' | 'egress_allowlist';

export interface SandboxLaunchOptions {
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface SandboxLaunchResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export type SandboxLauncher = (
  file: string,
  args: readonly string[],
  options: SandboxLaunchOptions,
) => Promise<SandboxLaunchResult>;

export interface SandboxOutputImporter {
  importSandboxOutput(input: {
    sandboxOutputRoot: string;
    relativePath: string;
    kind: ArtifactKind;
    name: string;
    contentType: string;
    visibility?: Visibility;
  }): Promise<ArtifactRef>;
}

export interface SandboxOutputArtifactImportSpec {
  kind: ArtifactKind;
  name: string;
  contentType?: string;
  visibility?: Visibility;
}

export interface SandboxOutputArtifactImports {
  stdout?: SandboxOutputArtifactImportSpec;
  stderr?: SandboxOutputArtifactImportSpec;
  diagnostic?: SandboxOutputArtifactImportSpec;
}

export interface ResourceGovernorReadinessInput {
  executorType: string;
  workflowOnly: boolean;
  environment: RuntimeSafetyEnvironment;
  networkMode?: RuntimeNetworkMode;
}

export type ResourceGovernorReadiness =
  | { status: 'ready'; governor_id: string; provenance: RuntimeGovernorProvenance; sandbox_id?: string }
  | { status: 'unavailable'; governor_id: string; provenance: RuntimeGovernorProvenance; reason_code: 'runtime_hard_limits_unavailable' };

export interface BootstrapGovernorBindings {
  bootstrapId: string;
  commandId: string;
  commandDigest: string;
  repoRoot: string;
  workspaceParent: string;
  artifactRoot: string;
  cwd: string;
  safeGitProfile: 'forgeloop_default';
}

export interface RunGovernorBindings {
  runId: string;
  commandId: string;
  commandDigest: string;
  workspaceRoot: string;
  artifactRoot: string;
  sandboxOutputRoot: string;
  policyDigest: string;
  policySnapshotVersion: number;
  envPolicyDigest: string;
  commandPolicyDigest: string;
  mountPolicyDigest: string;
  networkPolicyDigest: string;
  resourceLimitDigest: string;
  sandboxOutputRootPolicy: string;
  artifactQuotaPolicy: string;
  networkMode: RuntimeNetworkMode;
  resourceLimits: ResourceLimitVector;
  safeGitProfile?: 'forgeloop_default';
  primaryExecutor?: PrimaryExecutorDigestBinding;
}

export type ResourceGovernorRunInput = BootstrapResourceGovernorRunInput | RunResourceGovernorRunInput;

export interface BootstrapResourceGovernorRunInput {
  scope: 'bootstrap';
  command: MaterializedStructuredCommand;
  bindings: BootstrapGovernorBindings;
}

export interface RunResourceGovernorRunInput {
  scope: 'run';
  command: MaterializedStructuredCommand;
  bindings: RunGovernorBindings;
  mockRunContext?: ResourceGovernorReadinessInput;
  outputImporter?: SandboxOutputImporter;
  sandboxOutputArtifacts?: SandboxOutputArtifactImports;
}

export interface RunExecutionAttestationInput extends RunGovernorBindings {
  executorType: string;
  workflowOnly: boolean;
  environment: RuntimeSafetyEnvironment;
  projectId: string;
  repoId: string;
  executionPackageId: string;
  expectedPackageVersion: number;
  now: string;
  expiresAt: string;
}

export interface SandboxLeaseInput extends RunExecutionAttestationInput {
  workerIdentity: string;
  promptDigest: string;
  runSpecDigest: string;
}

export interface SandboxLease {
  lease_id: string;
  run_id: string;
  worker_identity: string;
  workspace_root: string;
  artifact_root: string;
  sandbox_output_root: string;
  policy_digest: string;
  policy_snapshot_version: number;
  env_policy_digest: string;
  command_policy_digest: string;
  mount_policy_digest: string;
  network_policy_digest: string;
  resource_limit_digest: string;
  resource_limits: ResourceLimitVector;
  sandbox_config_digest: string;
  sandbox_wrapper_environment_digest: string;
  prompt_digest: string;
  run_spec_digest: string;
  attestation: RuntimeSafetyAttestation;
  expires_at: string;
  command_invocation_nonce_required: true;
}

export interface ResourceGovernor {
  readonly governorId: string;
  readonly provenance: RuntimeGovernorProvenance;
  checkReadiness(input: ResourceGovernorReadinessInput): Promise<ResourceGovernorReadiness>;
  createRunExecutionAttestation(input: RunExecutionAttestationInput): Promise<RuntimeSafetyAttestation>;
  createRunLease?(input: SandboxLeaseInput): Promise<SandboxLease>;
  consumeLeaseCommandInvocation(input: LeaseCommandInvocationInput): Promise<{ ok: true }>;
  run(input: ResourceGovernorRunInput): Promise<StructuredCommandResult>;
}

export interface LeaseCommandInvocationInput {
  lease: SandboxLease;
  commandDigest: string;
  commandInvocationNonce: string;
  now: string;
  terminalRun?: boolean;
  expected: RunGovernorBindings & {
    promptDigest: string;
    runSpecDigest: string;
  };
}

export class ResourceGovernorError extends Error {
  constructor(
    readonly code:
      | 'runtime_hard_limits_unavailable'
      | 'runtime_test_only_mock_forbidden'
      | 'resource_governor_nonce_replay'
      | 'resource_governor_digest_mismatch'
      | 'resource_governor_lease_invalid'
      | 'resource_governor_protocol_error',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ResourceGovernorError';
  }
}

export interface ExternalSandboxResourceGovernorOptions {
  governorId: string;
  sandboxExecutablePath: string;
  sandboxBinaryDigest: string;
  sandboxConfigDigest: string;
  trustedRootPaths: readonly string[];
  disallowedRuntimeRoots?: readonly string[];
  wrapperCwd?: string;
  wrapperEnv?: Record<string, string>;
  launcher?: SandboxLauncher;
  outputImporter?: SandboxOutputImporter;
  trustVerifier?: SandboxTrustVerifier;
  nonceFactory?: () => string;
  now?: () => string;
  selfCheckTimeoutMs?: number;
  selfCheckOutputLimitBytes?: number;
}

export type SandboxTrustVerifier = (input: {
  sandboxExecutablePath: string;
  sandboxBinaryDigest: string;
  trustedRootPaths: readonly string[];
  disallowedRuntimeRoots: readonly string[];
  wrapperCwd: string;
}) => void;

interface ExternalSandboxSelfCheck {
  sandbox_id: string;
  sandbox_version: string;
  sandbox_binary_digest: string;
  sandbox_config_digest: string;
  supports_cpu_limit: true;
  supports_memory_limit: true;
  supports_process_limit: true;
  supports_fd_limit: true;
  supports_workspace_disk_limit: true;
  supports_artifact_size_limit: true;
  supports_filesystem_containment: true;
  supports_host_secret_isolation: true;
  supports_network_policy: true;
  supports_wrapper_env_isolation: true;
  supports_process_tree_kill: true;
  mount_policy_digest: string;
  network_mode: RuntimeNetworkMode;
  max_command_timeout_ms: number;
  max_hook_timeout_ms: number;
  max_command_output_bytes: number;
  max_run_output_bytes: number;
}

const selfCheckDefaultTimeoutMs = 5_000;
const selfCheckDefaultOutputLimitBytes = 64 * 1024;

export class UnavailableResourceGovernor implements ResourceGovernor {
  readonly provenance = 'unavailable' as const;

  constructor(readonly governorId = 'unavailable') {}

  async checkReadiness(): Promise<ResourceGovernorReadiness> {
    return unavailableReadiness(this.governorId, this.provenance);
  }

  async createRunExecutionAttestation(input: RunExecutionAttestationInput): Promise<RuntimeSafetyAttestation> {
    return {
      attestation_scope: 'run_execution',
      hard_limit_mode: 'unavailable',
      environment: input.environment,
      executor_type: input.executorType,
      workflow_only: input.workflowOnly,
      governor_id: this.governorId,
      governor_provenance: this.provenance,
      checked_at: input.now,
      max_command_timeout_ms: 0,
      max_hook_timeout_ms: 0,
      max_command_output_bytes: 0,
      max_run_output_bytes: 0,
      supports_cpu_limit: false,
      supports_memory_limit: false,
      supports_process_limit: false,
      supports_fd_limit: false,
      supports_workspace_disk_limit: false,
      supports_artifact_size_limit: false,
      network_mode: input.networkMode,
      project_id: input.projectId,
      repo_id: input.repoId,
      execution_package_id: input.executionPackageId,
      expected_package_version: input.expectedPackageVersion,
      run_id: input.runId,
      policy_digest: input.policyDigest,
      policy_snapshot_version: input.policySnapshotVersion,
      env_policy_digest: input.envPolicyDigest,
      command_policy_digest: input.commandPolicyDigest,
      mount_policy_digest: input.mountPolicyDigest,
      network_policy_digest: input.networkPolicyDigest,
      resource_limit_digest: input.resourceLimitDigest,
      resource_limits: input.resourceLimits,
      workspace_root: input.workspaceRoot,
      artifact_root: input.artifactRoot,
      sandbox_output_root: input.sandboxOutputRoot,
      expires_at: input.expiresAt,
      reason_code: 'runtime_hard_limits_unavailable',
    };
  }

  async run(): Promise<StructuredCommandResult> {
    throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Runtime hard limits are unavailable.');
  }

  async consumeLeaseCommandInvocation(): Promise<{ ok: true }> {
    throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Runtime hard limits are unavailable.');
  }
}

export class TestOnlyMockResourceGovernor implements ResourceGovernor {
  readonly provenance = 'test_only_mock' as const;

  constructor(
    readonly governorId = 'test-only-mock',
    readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async checkReadiness(input: ResourceGovernorReadinessInput): Promise<ResourceGovernorReadiness> {
    return this.#isAllowed(input)
      ? { status: 'ready', governor_id: this.governorId, provenance: this.provenance }
      : unavailableReadiness(this.governorId, this.provenance);
  }

  async createRunExecutionAttestation(input: RunExecutionAttestationInput): Promise<RuntimeSafetyAttestation> {
    if (!this.#isAllowed(input)) {
      throw new ResourceGovernorError(
        'runtime_test_only_mock_forbidden',
        'test_only_mock runtime safety is only valid for mock workflow-only local/test runs.',
      );
    }
    return {
      attestation_scope: 'run_execution',
      hard_limit_mode: 'test_only_mock',
      environment: input.environment,
      executor_type: input.executorType,
      workflow_only: input.workflowOnly,
      governor_id: this.governorId,
      governor_provenance: this.provenance,
      checked_at: input.now ?? this.now(),
      max_command_timeout_ms: input.resourceLimits.timeout_ms,
      max_hook_timeout_ms: input.resourceLimits.timeout_ms,
      max_command_output_bytes: input.resourceLimits.output_limit_bytes,
      max_run_output_bytes: input.resourceLimits.run_output_limit_bytes,
      supports_cpu_limit: false,
      supports_memory_limit: false,
      supports_process_limit: false,
      supports_fd_limit: false,
      supports_workspace_disk_limit: false,
      supports_artifact_size_limit: false,
      network_mode: input.networkMode,
      project_id: input.projectId,
      repo_id: input.repoId,
      execution_package_id: input.executionPackageId,
      expected_package_version: input.expectedPackageVersion,
      run_id: input.runId,
      policy_digest: input.policyDigest,
      policy_snapshot_version: input.policySnapshotVersion,
      env_policy_digest: input.envPolicyDigest,
      command_policy_digest: input.commandPolicyDigest,
      mount_policy_digest: input.mountPolicyDigest,
      network_policy_digest: input.networkPolicyDigest,
      resource_limit_digest: input.resourceLimitDigest,
      resource_limits: input.resourceLimits,
      workspace_root: input.workspaceRoot,
      artifact_root: input.artifactRoot,
      sandbox_output_root: input.sandboxOutputRoot,
      expires_at: input.expiresAt,
    };
  }

  async run(input: ResourceGovernorRunInput): Promise<StructuredCommandResult> {
    if (input.scope !== 'run' || input.mockRunContext === undefined || !this.#isAllowed(input.mockRunContext)) {
      throw new ResourceGovernorError(
        'runtime_test_only_mock_forbidden',
        'test_only_mock runtime safety is only valid for mock workflow-only local/test runs.',
      );
    }
    return structuredCommandResultFromGovernor({ exit_code: 0, public_summary: 'Mock command completed.' });
  }

  async consumeLeaseCommandInvocation(): Promise<{ ok: true }> {
    throw new ResourceGovernorError(
      'runtime_test_only_mock_forbidden',
      'test_only_mock governor cannot consume production app-server leases.',
    );
  }

  #isAllowed(input: { executorType: string; workflowOnly: boolean; environment: RuntimeSafetyEnvironment }): boolean {
    return input.executorType === 'mock' && input.workflowOnly === true && (input.environment === 'test' || input.environment === 'local_dogfood');
  }
}

export class ExternalSandboxResourceGovernor implements ResourceGovernor {
  readonly provenance = 'external_sandbox' as const;
  readonly governorId: string;

  readonly #sandboxExecutablePath: string;
  readonly #sandboxBinaryDigest: string;
  readonly #sandboxConfigDigest: string;
  readonly #trustedRootPaths: readonly string[];
  readonly #disallowedRuntimeRoots: readonly string[];
  readonly #wrapperCwd: string;
  readonly #wrapperEnv: Record<string, string>;
  readonly #wrapperEnvironmentDigest: string;
  readonly #launcher: SandboxLauncher;
  readonly #outputImporter: SandboxOutputImporter | undefined;
  readonly #nonceFactory: () => string;
  readonly #now: () => string;
  readonly #selfCheckTimeoutMs: number;
  readonly #selfCheckOutputLimitBytes: number;
  readonly #usedNonces = new Set<string>();
  readonly #leaseInvocationNonces = new Set<string>();
  readonly #leaseCommandDigests = new Set<string>();
  #selfCheck: ExternalSandboxSelfCheck | undefined;

  constructor(options: ExternalSandboxResourceGovernorOptions) {
    this.governorId = options.governorId;
    this.#sandboxExecutablePath = canonicalAbsolutePath(options.sandboxExecutablePath);
    this.#sandboxBinaryDigest = options.sandboxBinaryDigest;
    this.#sandboxConfigDigest = options.sandboxConfigDigest;
    this.#trustedRootPaths = options.trustedRootPaths.map(canonicalAbsolutePath);
    this.#disallowedRuntimeRoots = (options.disallowedRuntimeRoots ?? []).map(canonicalRootOrResolved);
    this.#wrapperCwd = canonicalAbsolutePath(options.wrapperCwd ?? '/');
    (options.trustVerifier ?? defaultSandboxTrustVerifier)({
      sandboxExecutablePath: this.#sandboxExecutablePath,
      sandboxBinaryDigest: this.#sandboxBinaryDigest,
      trustedRootPaths: this.#trustedRootPaths,
      disallowedRuntimeRoots: this.#disallowedRuntimeRoots,
      wrapperCwd: this.#wrapperCwd,
    });
    this.#wrapperEnv = sanitizeWrapperEnv(options.wrapperEnv ?? {});
    this.#wrapperEnvironmentDigest = sandboxWrapperEnvironmentDigest({
      cwd: this.#wrapperCwd,
      env: this.#wrapperEnv,
    });
    this.#launcher = options.launcher ?? execFileSandboxLauncher;
    this.#outputImporter = options.outputImporter;
    this.#nonceFactory = options.nonceFactory ?? (() => randomUUID());
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#selfCheckTimeoutMs = options.selfCheckTimeoutMs ?? selfCheckDefaultTimeoutMs;
    this.#selfCheckOutputLimitBytes = options.selfCheckOutputLimitBytes ?? selfCheckDefaultOutputLimitBytes;
  }

  async checkReadiness(input: ResourceGovernorReadinessInput): Promise<ResourceGovernorReadiness> {
    try {
      const selfCheck = await this.#runSelfCheck();
      if (input.networkMode !== undefined && selfCheck.network_mode !== input.networkMode) {
        return unavailableReadiness(this.governorId, this.provenance);
      }
      this.#selfCheck = selfCheck;
      return {
        status: 'ready',
        governor_id: this.governorId,
        provenance: this.provenance,
        sandbox_id: selfCheck.sandbox_id,
      };
    } catch {
      return unavailableReadiness(this.governorId, this.provenance);
    }
  }

  async createRunExecutionAttestation(input: RunExecutionAttestationInput): Promise<RuntimeSafetyAttestation> {
    const selfCheck = await this.#requireSelfCheck(input.networkMode, input.mountPolicyDigest);
    return {
      attestation_scope: 'run_execution',
      hard_limit_mode: 'enforcing',
      environment: input.environment,
      executor_type: input.executorType,
      workflow_only: input.workflowOnly,
      governor_id: this.governorId,
      governor_provenance: this.provenance,
      checked_at: input.now ?? this.#now(),
      max_command_timeout_ms: selfCheck.max_command_timeout_ms,
      max_hook_timeout_ms: selfCheck.max_hook_timeout_ms,
      max_command_output_bytes: selfCheck.max_command_output_bytes,
      max_run_output_bytes: selfCheck.max_run_output_bytes,
      supports_cpu_limit: selfCheck.supports_cpu_limit,
      supports_memory_limit: selfCheck.supports_memory_limit,
      supports_process_limit: selfCheck.supports_process_limit,
      supports_fd_limit: selfCheck.supports_fd_limit,
      supports_workspace_disk_limit: selfCheck.supports_workspace_disk_limit,
      supports_artifact_size_limit: selfCheck.supports_artifact_size_limit,
      network_mode: input.networkMode,
      project_id: input.projectId,
      repo_id: input.repoId,
      execution_package_id: input.executionPackageId,
      expected_package_version: input.expectedPackageVersion,
      run_id: input.runId,
      policy_digest: input.policyDigest,
      policy_snapshot_version: input.policySnapshotVersion,
      env_policy_digest: input.envPolicyDigest,
      command_policy_digest: input.commandPolicyDigest,
      mount_policy_digest: input.mountPolicyDigest,
      network_policy_digest: input.networkPolicyDigest,
      resource_limit_digest: input.resourceLimitDigest,
      resource_limits: input.resourceLimits,
      sandbox_id: selfCheck.sandbox_id,
      sandbox_version: selfCheck.sandbox_version,
      sandbox_binary_digest: selfCheck.sandbox_binary_digest,
      sandbox_config_digest: selfCheck.sandbox_config_digest,
      sandbox_wrapper_environment_digest: this.#wrapperEnvironmentDigest,
      workspace_root: input.workspaceRoot,
      artifact_root: input.artifactRoot,
      sandbox_output_root: input.sandboxOutputRoot,
      supports_filesystem_containment: selfCheck.supports_filesystem_containment,
      supports_host_secret_isolation: selfCheck.supports_host_secret_isolation,
      supports_network_policy: selfCheck.supports_network_policy,
      supports_wrapper_env_isolation: selfCheck.supports_wrapper_env_isolation,
      supports_process_tree_kill: selfCheck.supports_process_tree_kill,
      expires_at: input.expiresAt,
    };
  }

  async createRunLease(input: SandboxLeaseInput): Promise<SandboxLease> {
    const attestation = await this.createRunExecutionAttestation(input);
    return {
      lease_id: `lease-${this.#nextNonce()}`,
      run_id: input.runId,
      worker_identity: input.workerIdentity,
      workspace_root: input.workspaceRoot,
      artifact_root: input.artifactRoot,
      sandbox_output_root: input.sandboxOutputRoot,
      policy_digest: input.policyDigest,
      policy_snapshot_version: input.policySnapshotVersion,
      env_policy_digest: input.envPolicyDigest,
      command_policy_digest: input.commandPolicyDigest,
      mount_policy_digest: input.mountPolicyDigest,
      network_policy_digest: input.networkPolicyDigest,
      resource_limit_digest: input.resourceLimitDigest,
      resource_limits: input.resourceLimits,
      sandbox_config_digest: this.#sandboxConfigDigest,
      sandbox_wrapper_environment_digest: this.#wrapperEnvironmentDigest,
      prompt_digest: input.promptDigest,
      run_spec_digest: input.runSpecDigest,
      attestation,
      expires_at: input.expiresAt,
      command_invocation_nonce_required: true,
    };
  }

  async run(input: ResourceGovernorRunInput): Promise<StructuredCommandResult> {
    assertRunInputShape(input);
    await this.#requireSelfCheck(
      input.scope === 'run' ? input.bindings.networkMode : undefined,
      input.scope === 'run' ? input.bindings.mountPolicyDigest : undefined,
    );
    if (input.scope === 'run') {
      assertRunDigests(input.command, input.bindings);
    }
    const nonce = this.#nextNonce();
    const args =
      input.scope === 'bootstrap'
        ? bootstrapArgs(input.command, input.bindings, nonce)
        : runArgs(input.command, input.bindings, nonce);
    const result = await this.#launcher(this.#sandboxExecutablePath, args, {
      cwd: this.#wrapperCwd,
      env: this.#wrapperEnv,
      timeoutMs: input.command.timeout_ms,
      outputLimitBytes: input.command.output_limit_bytes,
    });
    if (result.timedOut || result.exitCode !== 0 || result.stderr.trim().length > 0) {
      throw new ResourceGovernorError('resource_governor_protocol_error', 'Sandbox command failed closed.');
    }
    if (byteLength(result.stdout) > input.command.output_limit_bytes) {
      throw new ResourceGovernorError('resource_governor_protocol_error', 'Sandbox command output exceeded limit.');
    }
    const parsed = parseSandboxResult(result.stdout);
    if (input.scope === 'run') {
      return structuredCommandResultFromGovernor(
        await importSandboxResultRefs(
          parsed,
          input.bindings.sandboxOutputRoot,
          input.outputImporter ?? this.#outputImporter,
          input.command.visibility,
          input.sandboxOutputArtifacts,
        ),
      );
    }
    if (parsed.stdout_ref !== undefined || parsed.stderr_ref !== undefined || parsed.internal_diagnostic_ref !== undefined) {
      throw new ResourceGovernorError('resource_governor_protocol_error', 'Bootstrap commands must not return sandbox output refs.');
    }
    return structuredCommandResultFromGovernor(parsed);
  }

  async consumeLeaseCommandInvocation(input: LeaseCommandInvocationInput): Promise<{ ok: true }> {
    if (
      input.commandDigest !== input.expected.commandDigest ||
      input.lease.sandbox_config_digest !== this.#sandboxConfigDigest ||
      input.lease.sandbox_wrapper_environment_digest !== this.#wrapperEnvironmentDigest
    ) {
      throw new ResourceGovernorError('resource_governor_lease_invalid', 'Sandbox lease does not match current command or sandbox configuration.');
    }
    if (this.#leaseInvocationNonces.has(input.commandInvocationNonce)) {
      throw new ResourceGovernorError('resource_governor_nonce_replay', 'Lease command invocation nonce was already consumed.');
    }
    if (input.terminalRun === true || Date.parse(input.lease.expires_at) <= Date.parse(input.now)) {
      throw new ResourceGovernorError('resource_governor_lease_invalid', 'Sandbox lease is no longer valid.');
    }
    if (this.#leaseCommandDigests.has(input.commandDigest)) {
      throw new ResourceGovernorError('resource_governor_nonce_replay', 'Lease command digest was already consumed.');
    }
    assertLeaseMatchesExpected(input.lease, input.expected);
    this.#leaseInvocationNonces.add(input.commandInvocationNonce);
    this.#leaseCommandDigests.add(input.commandDigest);
    return { ok: true };
  }

  async #runSelfCheck(): Promise<ExternalSandboxSelfCheck> {
    const result = await this.#launcher(
      this.#sandboxExecutablePath,
      ['--forgeloop-self-check', '--json', '--config-digest', this.#sandboxConfigDigest],
      {
        cwd: this.#wrapperCwd,
        env: this.#wrapperEnv,
        timeoutMs: this.#selfCheckTimeoutMs,
        outputLimitBytes: this.#selfCheckOutputLimitBytes,
      },
    );
    if (
      result.timedOut ||
      result.exitCode !== 0 ||
      result.stderr.trim().length > 0 ||
      result.stdout.trim().length === 0 ||
      byteLength(result.stdout) > this.#selfCheckOutputLimitBytes
    ) {
      throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Sandbox self-check failed closed.');
    }
    const parsed = parseJsonObject(result.stdout);
    const selfCheck = normalizeSelfCheck(parsed);
    if (selfCheck.sandbox_config_digest !== this.#sandboxConfigDigest) {
      throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Sandbox config digest mismatch.');
    }
    if (selfCheck.sandbox_binary_digest !== this.#sandboxBinaryDigest) {
      throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Sandbox binary digest mismatch.');
    }
    return selfCheck;
  }

  async #requireSelfCheck(networkMode?: RuntimeNetworkMode, mountPolicyDigest?: string): Promise<ExternalSandboxSelfCheck> {
    const selfCheck = this.#selfCheck ?? (await this.#runSelfCheck());
    if (networkMode !== undefined && selfCheck.network_mode !== networkMode) {
      throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Sandbox network mode does not match the run binding.');
    }
    if (mountPolicyDigest !== undefined && selfCheck.mount_policy_digest !== mountPolicyDigest) {
      throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Sandbox mount policy digest does not match the run binding.');
    }
    this.#selfCheck = selfCheck;
    return selfCheck;
  }

  #nextNonce(): string {
    const nonce = this.#nonceFactory();
    if (this.#usedNonces.has(nonce)) {
      throw new ResourceGovernorError('resource_governor_nonce_replay', 'Sandbox command nonce was already consumed.');
    }
    this.#usedNonces.add(nonce);
    return nonce;
  }
}

const bootstrapArgs = (command: MaterializedStructuredCommand, bindings: BootstrapGovernorBindings, nonce: string): string[] => [
  '--forgeloop-bootstrap-run',
  '--json',
  '--bootstrap-id',
  bindings.bootstrapId,
  '--nonce',
  nonce,
  '--command-id',
  bindings.commandId,
  '--command-digest',
  bindings.commandDigest,
  '--repo-root',
  bindings.repoRoot,
  '--workspace-parent',
  bindings.workspaceParent,
  '--artifact-root',
  bindings.artifactRoot,
  '--cwd',
  bindings.cwd,
  '--safe-git-profile',
  bindings.safeGitProfile,
  '--timeout-ms',
  String(command.timeout_ms),
  '--output-limit-bytes',
  String(command.output_limit_bytes),
  '--',
  command.resolved_executable_path,
  ...command.args,
];

const runArgs = (command: MaterializedStructuredCommand, bindings: RunGovernorBindings, nonce: string): string[] => [
  ...[
    '--forgeloop-run',
    '--json',
    '--run-id',
    bindings.runId,
    '--nonce',
    nonce,
    '--command-id',
    bindings.commandId,
    '--command-digest',
    bindings.commandDigest,
    '--workspace-root',
    bindings.workspaceRoot,
    '--artifact-root',
    bindings.artifactRoot,
    '--sandbox-output-root',
    bindings.sandboxOutputRoot,
    '--cwd',
    commandCwd(command, bindings.workspaceRoot),
    '--policy-digest',
    bindings.policyDigest,
    '--env-policy-digest',
    bindings.envPolicyDigest,
    '--command-policy-digest',
    bindings.commandPolicyDigest,
    '--mount-policy-digest',
    bindings.mountPolicyDigest,
    '--network-policy-digest',
    bindings.networkPolicyDigest,
    '--resource-limit-digest',
    bindings.resourceLimitDigest,
    '--network-mode',
    bindings.networkMode,
    '--visibility',
    command.visibility satisfies Visibility,
    '--source-write-policy',
    command.source_write_policy satisfies SourceWritePolicy,
    '--timeout-ms',
    String(command.timeout_ms),
    '--output-limit-bytes',
    String(command.output_limit_bytes),
    '--cpu-ms',
    String(bindings.resourceLimits.cpu_ms),
    '--memory-mb',
    String(bindings.resourceLimits.memory_mb),
    '--pids',
    String(bindings.resourceLimits.pids),
    '--fds',
    String(bindings.resourceLimits.fds),
    '--workspace-bytes',
    String(bindings.resourceLimits.workspace_bytes),
    '--artifact-bytes',
    String(bindings.resourceLimits.artifact_bytes),
  ],
  ...(bindings.safeGitProfile === undefined ? [] : ['--safe-git-profile', bindings.safeGitProfile]),
  '--',
  command.resolved_executable_path,
  ...command.args,
];

const commandCwd = (command: MaterializedStructuredCommand, workspaceRoot: string): string =>
  command.cwd === 'workspace_root' ? workspaceRoot : resolve(workspaceRoot, command.cwd.repo_relative);

const assertRunInputShape = (input: ResourceGovernorRunInput): void => {
  if (input.scope === 'run') {
    const bindings = input.bindings;
    if (
      typeof bindings.runId !== 'string' ||
      typeof bindings.workspaceRoot !== 'string' ||
      typeof bindings.sandboxOutputRoot !== 'string' ||
      typeof bindings.resourceLimitDigest !== 'string' ||
      bindings.resourceLimits === undefined
    ) {
      throw new ResourceGovernorError('resource_governor_protocol_error', 'Run governor input requires run bindings.');
    }
    return;
  }

  const bindings = input.bindings;
  if (
    typeof bindings.bootstrapId !== 'string' ||
    typeof bindings.repoRoot !== 'string' ||
    typeof bindings.workspaceParent !== 'string' ||
    bindings.safeGitProfile !== 'forgeloop_default'
  ) {
    throw new ResourceGovernorError('resource_governor_protocol_error', 'Bootstrap governor input requires bootstrap bindings.');
  }
};

const assertRunDigests = (command: MaterializedStructuredCommand, bindings: RunGovernorBindings): void => {
  const actualResourceLimitDigest = resourceLimitDigest(bindings.resourceLimits);
  if (actualResourceLimitDigest !== bindings.resourceLimitDigest) {
    throw new ResourceGovernorError('resource_governor_digest_mismatch', 'Resource limit digest does not match resource limits.');
  }
  const digestInput = {
    command,
    resource_limit_digest: bindings.resourceLimitDigest,
    run_id: bindings.runId,
    workspace_root: bindings.workspaceRoot,
    artifact_root: bindings.artifactRoot,
    sandbox_output_root_policy: bindings.sandboxOutputRootPolicy,
    artifact_quota_policy: bindings.artifactQuotaPolicy,
  };
  const actualCommandDigest =
    bindings.primaryExecutor === undefined
      ? structuredCommandDigest(digestInput)
      : primaryExecutorCommandDigest({ ...digestInput, primary_executor: bindings.primaryExecutor });
  if (actualCommandDigest !== bindings.commandDigest) {
    throw new ResourceGovernorError('resource_governor_digest_mismatch', 'Command digest does not match materialized command.');
  }
};

const importSandboxResultRefs = async (
  result: ParsedSandboxResult,
  sandboxOutputRoot: string,
  outputImporter: SandboxOutputImporter | undefined,
  visibility: Visibility,
  artifactImports: SandboxOutputArtifactImports | undefined,
): Promise<ParsedSandboxResult> => {
  const stdoutArtifact = await importSandboxRef(
    result.stdout_ref,
    sandboxOutputRoot,
    outputImporter,
    artifactImports?.stdout ?? { kind: 'logs', name: 'stdout.txt', visibility },
  );
  const stderrArtifact = await importSandboxRef(
    result.stderr_ref,
    sandboxOutputRoot,
    outputImporter,
    artifactImports?.stderr ?? { kind: 'logs', name: 'stderr.txt', visibility },
  );
  const diagnosticImportSpec = artifactImports?.diagnostic;
  const diagnosticArtifact = await importSandboxRef(
    result.internal_diagnostic_ref,
    sandboxOutputRoot,
    outputImporter,
    diagnosticImportSpec === undefined
      ? { kind: 'logs', name: 'diagnostic.txt', visibility: 'internal' }
      : { ...diagnosticImportSpec, visibility: 'internal' },
  );
  const imported: ParsedSandboxResult = { ...result };
  const outputArtifacts: StructuredCommandOutputArtifacts = {};
  if (stdoutArtifact !== undefined) {
    imported.stdout_ref = artifactRefString(stdoutArtifact);
    outputArtifacts.stdout = stdoutArtifact;
  }
  if (stderrArtifact !== undefined) {
    imported.stderr_ref = artifactRefString(stderrArtifact);
    outputArtifacts.stderr = stderrArtifact;
  }
  if (diagnosticArtifact !== undefined) {
    imported.internal_diagnostic_ref = artifactRefString(diagnosticArtifact);
    outputArtifacts.internal_diagnostic = diagnosticArtifact;
  }
  if (Object.keys(outputArtifacts).length > 0) {
    imported.output_artifacts = outputArtifacts;
  }
  return imported;
};

const importSandboxRef = async (
  ref: string | undefined,
  sandboxOutputRoot: string,
  outputImporter: SandboxOutputImporter | undefined,
  importSpec: SandboxOutputArtifactImportSpec,
): Promise<ArtifactRef | undefined> => {
  if (ref === undefined) {
    return undefined;
  }
  assertSafeSandboxOutputRef(ref);
  if (outputImporter === undefined) {
    throw new ResourceGovernorError('resource_governor_protocol_error', 'Sandbox output refs require an ArtifactWriter importer.');
  }
  const importedArtifact = await outputImporter.importSandboxOutput({
    sandboxOutputRoot,
    relativePath: ref,
    kind: importSpec.kind,
    name: importSpec.name,
    contentType: importSpec.contentType ?? 'text/plain',
    ...(importSpec.visibility === undefined ? {} : { visibility: importSpec.visibility }),
  });
  return importedArtifact;
};

const artifactRefString = (artifact: ArtifactRef): string => artifact.storage_uri ?? artifact.local_ref ?? artifact.name;

const assertSafeSandboxOutputRef = (ref: string): void => {
  if (
    ref.length === 0 ||
    ref.startsWith('/') ||
    ref.includes('\\') ||
    ref.includes('\0') ||
    ref.split('/').some((part) => part === '..' || part.length === 0)
  ) {
    throw new ResourceGovernorError('resource_governor_protocol_error', 'Sandbox output ref must be a safe relative path.');
  }
};

const assertLeaseMatchesExpected = (
  lease: SandboxLease,
  expected: RunGovernorBindings & { promptDigest: string; runSpecDigest: string },
): void => {
  const mismatched = (
    [
      ['run_id', lease.run_id, expected.runId],
      ['workspace_root', lease.workspace_root, expected.workspaceRoot],
      ['artifact_root', lease.artifact_root, expected.artifactRoot],
      ['sandbox_output_root', lease.sandbox_output_root, expected.sandboxOutputRoot],
      ['policy_digest', lease.policy_digest, expected.policyDigest],
      ['policy_snapshot_version', lease.policy_snapshot_version, expected.policySnapshotVersion],
      ['env_policy_digest', lease.env_policy_digest, expected.envPolicyDigest],
      ['command_policy_digest', lease.command_policy_digest, expected.commandPolicyDigest],
      ['mount_policy_digest', lease.mount_policy_digest, expected.mountPolicyDigest],
      ['network_policy_digest', lease.network_policy_digest, expected.networkPolicyDigest],
      ['resource_limit_digest', lease.resource_limit_digest, expected.resourceLimitDigest],
      ['prompt_digest', lease.prompt_digest, expected.promptDigest],
      ['run_spec_digest', lease.run_spec_digest, expected.runSpecDigest],
    ] as const
  ).find(([, actual, expectedValue]) => actual !== expectedValue);
  if (mismatched !== undefined || resourceLimitDigest(lease.resource_limits) !== expected.resourceLimitDigest) {
    throw new ResourceGovernorError('resource_governor_lease_invalid', 'Sandbox lease does not match expected run binding.');
  }
};

type ParsedSandboxResult = {
  exit_code: number | null;
  timed_out?: boolean;
  stdout_ref?: string;
  stderr_ref?: string;
  stdout_truncated?: boolean;
  stderr_truncated?: boolean;
  visibility?: Visibility;
  public_summary?: string;
  internal_diagnostic_ref?: string;
  output_artifacts?: StructuredCommandOutputArtifacts;
};

const parseSandboxResult = (stdout: string): ParsedSandboxResult => {
  const value = parseJsonObject(stdout);
  const result: ParsedSandboxResult = {
    exit_code: requiredExitCode(value, 'exit_code'),
  };
  const timedOut = optionalBoolean(value, 'timed_out');
  const stdoutRef = optionalString(value, 'stdout_ref');
  const stderrRef = optionalString(value, 'stderr_ref');
  const stdoutTruncated = optionalBoolean(value, 'stdout_truncated');
  const stderrTruncated = optionalBoolean(value, 'stderr_truncated');
  const visibility = optionalVisibility(value, 'visibility');
  const publicSummary = optionalString(value, 'public_summary');
  const internalDiagnosticRef = optionalString(value, 'internal_diagnostic_ref');
  if (timedOut !== undefined) result.timed_out = timedOut;
  if (stdoutRef !== undefined) result.stdout_ref = stdoutRef;
  if (stderrRef !== undefined) result.stderr_ref = stderrRef;
  if (stdoutTruncated !== undefined) result.stdout_truncated = stdoutTruncated;
  if (stderrTruncated !== undefined) result.stderr_truncated = stderrTruncated;
  if (visibility !== undefined) result.visibility = visibility;
  if (publicSummary !== undefined) result.public_summary = publicSummary;
  if (internalDiagnosticRef !== undefined) result.internal_diagnostic_ref = internalDiagnosticRef;
  return result;
};

const normalizeSelfCheck = (value: Record<string, unknown>): ExternalSandboxSelfCheck => {
  const selfCheck = {
    sandbox_id: requiredString(value, 'sandbox_id'),
    sandbox_version: requiredString(value, 'sandbox_version'),
    sandbox_binary_digest: requiredString(value, 'sandbox_binary_digest'),
    sandbox_config_digest: requiredString(value, 'sandbox_config_digest'),
    supports_cpu_limit: requiredTrue(value, 'supports_cpu_limit'),
    supports_memory_limit: requiredTrue(value, 'supports_memory_limit'),
    supports_process_limit: requiredTrue(value, 'supports_process_limit'),
    supports_fd_limit: requiredTrue(value, 'supports_fd_limit'),
    supports_workspace_disk_limit: requiredTrue(value, 'supports_workspace_disk_limit'),
    supports_artifact_size_limit: requiredTrue(value, 'supports_artifact_size_limit'),
    supports_filesystem_containment: requiredTrue(value, 'supports_filesystem_containment'),
    supports_host_secret_isolation: requiredTrue(value, 'supports_host_secret_isolation'),
    supports_network_policy: requiredTrue(value, 'supports_network_policy'),
    supports_wrapper_env_isolation: requiredTrue(value, 'supports_wrapper_env_isolation'),
    supports_process_tree_kill: requiredTrue(value, 'supports_process_tree_kill'),
    mount_policy_digest: requiredString(value, 'mount_policy_digest'),
    network_mode: requiredNetworkMode(value, 'network_mode'),
    max_command_timeout_ms: requiredPositiveInteger(value, 'max_command_timeout_ms'),
    max_hook_timeout_ms: requiredPositiveInteger(value, 'max_hook_timeout_ms'),
    max_command_output_bytes: requiredPositiveInteger(value, 'max_command_output_bytes'),
    max_run_output_bytes: requiredPositiveInteger(value, 'max_run_output_bytes'),
  };
  return selfCheck;
};

const parseJsonObject = (input: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // handled below
  }
  throw new ResourceGovernorError('resource_governor_protocol_error', 'Sandbox output must be JSON object.');
};

const requiredString = (value: Record<string, unknown>, key: string): string => {
  const field = value[key];
  if (typeof field !== 'string' || field.trim().length === 0) {
    throw new ResourceGovernorError('runtime_hard_limits_unavailable', `Sandbox self-check field ${key} is required.`);
  }
  return field;
};

const requiredTrue = (value: Record<string, unknown>, key: string): true => {
  if (value[key] !== true) {
    throw new ResourceGovernorError('runtime_hard_limits_unavailable', `Sandbox self-check field ${key} must be true.`);
  }
  return true;
};

const requiredNetworkMode = (value: Record<string, unknown>, key: string): RuntimeNetworkMode => {
  const field = value[key];
  if (field !== 'disabled' && field !== 'egress_allowlist') {
    throw new ResourceGovernorError('runtime_hard_limits_unavailable', `Sandbox self-check field ${key} is invalid.`);
  }
  return field;
};

const requiredPositiveInteger = (value: Record<string, unknown>, key: string): number => {
  const field = value[key];
  if (typeof field !== 'number' || !Number.isInteger(field) || field <= 0) {
    throw new ResourceGovernorError('runtime_hard_limits_unavailable', `Sandbox self-check field ${key} must be a positive integer.`);
  }
  return field;
};

const requiredExitCode = (value: Record<string, unknown>, key: string): number | null => {
  const field = value[key];
  if (field === null || (typeof field === 'number' && Number.isInteger(field))) {
    return field;
  }
  throw new ResourceGovernorError('resource_governor_protocol_error', 'Sandbox result exit_code is invalid.');
};

const optionalString = (source: Record<string, unknown>, key: string): string | undefined => {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ResourceGovernorError('resource_governor_protocol_error', `Sandbox result field ${key} must be a string.`);
  }
  return value;
};

const optionalBoolean = (source: Record<string, unknown>, key: string): boolean | undefined => {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ResourceGovernorError('resource_governor_protocol_error', `Sandbox result field ${key} must be a boolean.`);
  }
  return value;
};

const optionalVisibility = (source: Record<string, unknown>, key: string): Visibility | undefined => {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'internal' && value !== 'public_safe') {
    throw new ResourceGovernorError('resource_governor_protocol_error', 'Sandbox result visibility is invalid.');
  }
  return value;
};

const unavailableReadiness = (governorId: string, provenance: RuntimeGovernorProvenance): ResourceGovernorReadiness => ({
  status: 'unavailable',
  governor_id: governorId,
  provenance,
  reason_code: 'runtime_hard_limits_unavailable',
});

const execFileSandboxLauncher: SandboxLauncher = async (file, args, options) =>
  new Promise((resolvePromise, reject) => {
    const child = execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        maxBuffer: options.outputLimitBytes,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const maybeError = error as Error & { code?: unknown; signal?: unknown; killed?: boolean };
          resolvePromise({
            stdout: String(stdout),
            stderr: String(stderr),
            exitCode: typeof maybeError.code === 'number' ? maybeError.code : 1,
            timedOut: maybeError.killed === true || maybeError.signal === 'SIGTERM',
          });
          return;
        }
        resolvePromise({ stdout: String(stdout), stderr: String(stderr), exitCode: 0, timedOut: false });
      },
    );
    child.stdin?.end();
  });

const canonicalAbsolutePath = (path: string): string => {
  if (!isAbsolute(path)) {
    throw new ResourceGovernorError('resource_governor_protocol_error', 'Sandbox path must be absolute.', { path });
  }
  return realpathSync(path);
};

const canonicalRootOrResolved = (path: string): string => {
  if (!isAbsolute(path)) {
    throw new ResourceGovernorError('resource_governor_protocol_error', 'Runtime root path must be absolute.', { path });
  }
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

const defaultSandboxTrustVerifier: SandboxTrustVerifier = ({
  sandboxExecutablePath,
  sandboxBinaryDigest,
  trustedRootPaths,
  disallowedRuntimeRoots,
  wrapperCwd,
}) => {
  assertTrustedExecutable(sandboxExecutablePath, sandboxBinaryDigest, trustedRootPaths, disallowedRuntimeRoots);
  assertTrustedWrapperCwd(wrapperCwd, trustedRootPaths, disallowedRuntimeRoots);
};

const assertTrustedExecutable = (
  executablePath: string,
  expectedDigest: string,
  trustedRootPaths: readonly string[],
  disallowedRuntimeRoots: readonly string[],
): void => {
  if (!statSync(executablePath).isFile() || !trustedRootPaths.some((root) => pathIsInside(executablePath, root))) {
    throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Sandbox executable is not under a trusted root.');
  }
  assertOutsideDisallowedRoots(executablePath, disallowedRuntimeRoots);
  assertNonWritablePathAndAncestors(executablePath);
  const actualDigest = `sha256:${createHash('sha256').update(readFileSync(executablePath)).digest('hex')}`;
  if (actualDigest !== expectedDigest) {
    throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Sandbox binary digest does not match trusted configuration.');
  }
};

const assertTrustedWrapperCwd = (
  wrapperCwd: string,
  trustedRootPaths: readonly string[],
  disallowedRuntimeRoots: readonly string[],
): void => {
  if (wrapperCwd === '/') {
    return;
  }
  if (!statSync(wrapperCwd).isDirectory() || !trustedRootPaths.some((root) => pathIsInside(wrapperCwd, root))) {
    throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Sandbox wrapper cwd is not trusted.');
  }
  assertOutsideDisallowedRoots(wrapperCwd, disallowedRuntimeRoots);
  assertNonWritablePathAndAncestors(wrapperCwd);
};

const assertOutsideDisallowedRoots = (path: string, disallowedRoots: readonly string[]): void => {
  if (disallowedRoots.some((root) => pathIsInside(path, root))) {
    throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Sandbox runtime path overlaps a disallowed root.', { path });
  }
};

const assertNonWritablePathAndAncestors = (path: string): void => {
  let current = path;
  while (true) {
    assertNonWritablePath(current);
    const parent = dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
};

const assertNonWritablePath = (path: string): void => {
  try {
    accessSync(path, fsConstants.W_OK);
  } catch {
    return;
  }
  throw new ResourceGovernorError('runtime_hard_limits_unavailable', 'Sandbox trusted paths must not be writable by the runtime user.', { path });
};

const pathIsInside = (candidate: string, root: string): boolean => {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !isAbsolute(rel) && !rel.split(sep).includes('..'));
};

const dangerousWrapperEnvNames = new Set([
  'PATH',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'GIT_ASKPASS',
  'SSH_AUTH_SOCK',
  'BASH_ENV',
  'ENV',
  'HOME',
]);

const sanitizeWrapperEnv = (env: Record<string, string>): Record<string, string> => {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (dangerousWrapperEnvNames.has(key) || /(^|_)(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH)(_|$)/i.test(key)) {
      throw new ResourceGovernorError('resource_governor_protocol_error', 'Sandbox wrapper env contains a forbidden variable.', { key });
    }
    sanitized[key] = value;
  }
  return sanitized;
};

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

const canonicalize = (value: unknown): CanonicalJsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .reduce<Record<string, CanonicalJsonValue>>((accumulator, [key, entry]) => {
        accumulator[key] = canonicalize(entry);
        return accumulator;
      }, {});
  }
  return null;
};

const digest = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;

export const sandboxWrapperEnvironmentDigest = (input: { cwd?: string; env?: Record<string, string> } = {}): string =>
  digest({
    cwd: canonicalAbsolutePath(input.cwd ?? '/'),
    env: sanitizeWrapperEnv(input.env ?? {}),
  });

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');
