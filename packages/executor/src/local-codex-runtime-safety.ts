import { createHash } from 'node:crypto';
import { accessSync, constants as fsConstants } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { RunSpec } from '@forgeloop/contracts';
import type { PackageRuntimePolicySnapshot, RuntimeSafetyEnvironment } from '@forgeloop/domain';
import { resourceLimitDigest, type ResourceLimitVector } from '@forgeloop/domain';

import { ArtifactWriter } from './artifact-writer.js';
import { runAfterRunHooks, runBeforeRunHooks, type HookRunnerCommandContext } from './hook-runner.js';
import type { LocalCodexRuntimeSafety } from './local-codex-preflight.js';
import { PathSafety } from './path-safety.js';
import {
  ExternalSandboxResourceGovernor,
  UnavailableResourceGovernor,
  type ResourceGovernor,
  type RuntimeNetworkMode,
} from './resource-governor.js';
import { RuntimePolicyError } from './runtime-policy.js';
import type { ExecutorRuntimeSafetyConfig } from './runtime-safety-config.js';
import type { TrustedToolchainConfig } from './structured-command.js';

export interface CreateLocalCodexRuntimeSafetyInput {
  runSpec: RunSpec;
  runtimeConfig: ExecutorRuntimeSafetyConfig;
  frozenSnapshot: PackageRuntimePolicySnapshot;
  workspaceRoot: string;
  artifactRoot?: string;
  sandboxOutputRoot?: string;
  runtimeEnvironment?: RuntimeSafetyEnvironment;
  now?: () => string;
}

const digest = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const requiredSnapshotDigest = (
  snapshot: PackageRuntimePolicySnapshot,
  key: 'env_policy_digest' | 'command_policy_digest' | 'mount_policy_digest' | 'network_policy_digest',
): string => {
  const value = snapshot[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RuntimePolicyError('policy_snapshot_invalid', `Frozen runtime policy snapshot is missing ${key}.`, {
      missing_field: key,
    });
  }
  return value;
};

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : 'run-session';
};

const executableUnderRoot = (roots: readonly string[], executableName: string): string | undefined => {
  for (const root of roots) {
    const candidate = join(root, executableName);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next trusted root.
    }
  }
  return undefined;
};

const trustedToolchainsFromConfig = (config: ExecutorRuntimeSafetyConfig): TrustedToolchainConfig => {
  const rootPaths: string[] = [];
  const executablePaths: Record<string, string> = {};

  for (const toolchain of Object.values(config.trusted_toolchains)) {
    rootPaths.push(...toolchain.root_paths);
    for (const executableName of toolchain.executable_names) {
      const executablePath = executableUnderRoot(toolchain.root_paths, executableName);
      if (executablePath !== undefined) {
        executablePaths[executableName] = executablePath;
      }
    }
  }

  return {
    root_paths: [...new Set(rootPaths)],
    executable_paths: executablePaths,
    path_entries: [...new Set(rootPaths)],
    writable: false,
  };
};

const resourceLimitsFromConfig = (config: ExecutorRuntimeSafetyConfig, runSpec: RunSpec): ResourceLimitVector => ({
  cpu_ms: config.sandbox.default_cpu_ms,
  memory_mb: config.sandbox.default_memory_mb,
  pids: config.sandbox.default_pids,
  fds: config.sandbox.default_fds,
  workspace_bytes: config.sandbox.default_workspace_bytes,
  artifact_bytes: config.sandbox.default_artifact_bytes,
  timeout_ms: runSpec.timeout_seconds * 1000,
  output_limit_bytes: 1_000_000,
  run_output_limit_bytes: 5_000_000,
});

const governorFromConfig = (
  config: ExecutorRuntimeSafetyConfig,
  artifactWriter: ArtifactWriter,
  now: () => string,
): ResourceGovernor => {
  const trustedRootPaths = [...new Set(Object.values(config.trusted_toolchains).flatMap((toolchain) => toolchain.root_paths))];
  if (trustedRootPaths.length === 0) {
    return new UnavailableResourceGovernor('runtime-safety-config-missing-trusted-toolchains');
  }

  return new ExternalSandboxResourceGovernor({
    governorId: 'external-sandbox',
    sandboxExecutablePath: config.sandbox.executable_path,
    sandboxBinaryDigest: config.sandbox.binary_digest,
    sandboxConfigDigest: config.sandbox.config_digest,
    trustedRootPaths,
    disallowedRuntimeRoots: [config.artifact_root],
    outputImporter: artifactWriter,
    now,
  });
};

const runtimeEnvironmentFor = (input: CreateLocalCodexRuntimeSafetyInput): RuntimeSafetyEnvironment =>
  input.runtimeEnvironment ?? (process.env.NODE_ENV === 'production' ? 'production' : 'local_dogfood');

const snapshotNetworkMode = (snapshot: PackageRuntimePolicySnapshot): RuntimeNetworkMode => {
  const codexRuntimeMode = snapshot.codex_runtime_mode;
  return typeof codexRuntimeMode === 'object' &&
    codexRuntimeMode !== null &&
    'network_mode' in codexRuntimeMode &&
    (codexRuntimeMode as { network_mode?: unknown }).network_mode === 'egress_allowlist'
    ? 'egress_allowlist'
    : 'disabled';
};

export const createLocalCodexRuntimeSafety = async (
  input: CreateLocalCodexRuntimeSafetyInput,
): Promise<LocalCodexRuntimeSafety> => {
  const now = input.now ?? (() => new Date().toISOString());
  const runSegment = safePathSegment(input.runSpec.run_session_id);
  const artifactRoot = resolve(input.artifactRoot ?? join(input.runtimeConfig.artifact_root, runSegment));
  const sandboxOutputRoot = resolve(input.sandboxOutputRoot ?? join(input.runtimeConfig.artifact_root, 'sandbox-output', runSegment));
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(sandboxOutputRoot, { recursive: true });

  const pathSafety = await PathSafety.create({
    repoRoot: input.runSpec.repo.local_path,
    artifactRoot,
    worktreeRoot: input.workspaceRoot,
  });
  const resourceLimits = resourceLimitsFromConfig(input.runtimeConfig, input.runSpec);
  const artifactWriter = await ArtifactWriter.create({
    runSessionId: input.runSpec.run_session_id,
    repoRoot: input.runSpec.repo.local_path,
    worktreeRoot: input.workspaceRoot,
    artifactRoot,
    packageControlledPaths: input.runSpec.allowed_paths,
    policy: {
      defaultVisibility: 'internal',
      perArtifactByteLimit: resourceLimits.artifact_bytes,
      perRunByteLimit: resourceLimits.artifact_bytes,
      publicSafeKinds: [],
    },
  });
  const trustedToolchains = trustedToolchainsFromConfig(input.runtimeConfig);
  const networkMode = snapshotNetworkMode(input.frozenSnapshot);
  const envPolicyDigest = requiredSnapshotDigest(input.frozenSnapshot, 'env_policy_digest');
  const commandPolicyDigest = requiredSnapshotDigest(input.frozenSnapshot, 'command_policy_digest');
  const mountPolicyDigest = requiredSnapshotDigest(input.frozenSnapshot, 'mount_policy_digest');
  const networkPolicyDigest = requiredSnapshotDigest(input.frozenSnapshot, 'network_policy_digest');
  const commandContext: HookRunnerCommandContext = {
    runId: input.runSpec.run_session_id,
    workspaceRoot: input.workspaceRoot,
    artifactRoot,
    sandboxOutputRoot,
    policyDigest: input.frozenSnapshot.policy_digest,
    policySnapshotVersion: input.frozenSnapshot.policy_snapshot_version,
    envPolicyDigest,
    commandPolicyDigest,
    mountPolicyDigest,
    networkPolicyDigest,
    resourceLimitDigest: resourceLimitDigest(resourceLimits),
    sandboxOutputRootPolicy: 'ephemeral_sandbox_output_only',
    artifactQuotaPolicy: digest({ per_run_bytes: resourceLimits.artifact_bytes }),
    networkMode,
    resourceLimits,
    trustedToolchains,
    ...(input.frozenSnapshot.safe_git_profile === undefined ? {} : { safeGitProfile: input.frozenSnapshot.safe_git_profile }),
  };
  const runGovernor = governorFromConfig(input.runtimeConfig, artifactWriter, now);

  return {
    config: input.runtimeConfig,
    frozenSnapshot: input.frozenSnapshot,
    pathSafety,
    artifactWriter,
    bootstrapGovernor: runGovernor,
    runGovernor,
    hookRunner: {
      runBeforeRun: runBeforeRunHooks,
      runAfterRun: runAfterRunHooks,
    },
    hookCommandContext: commandContext,
    maxHookTimeoutMs: resourceLimits.timeout_ms,
    runtimeEnvironment: runtimeEnvironmentFor(input),
  };
};
