import { accessSync, constants as fsConstants, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface ExecutorRuntimeSafetyConfig {
  sandbox: {
    executable_path: string;
    binary_digest: string;
    config_digest: string;
    config_path?: string;
    default_cpu_ms: number;
    default_memory_mb: number;
    default_pids: number;
    default_fds: number;
    default_workspace_bytes: number;
    default_artifact_bytes: number;
  };
  trusted_toolchains: Record<
    string,
    {
      root_paths: string[];
      executable_names: string[];
      config_digest: string;
    }
  >;
  artifact_root: string;
}

export type ExecutorRuntimeSafetyConfigParseResult =
  | { status: 'available'; config: ExecutorRuntimeSafetyConfig }
  | { status: 'unavailable'; reason_code: 'runtime_hard_limits_unavailable'; missing_keys: string[] }
  | {
      status: 'invalid';
      reason_code: 'runtime_safety_config_invalid';
      diagnostics: Array<{ code: string; message: string; path?: string }>;
    };

export interface ExecutorRuntimeSafetyConfigParseOptions {
  workspaceRoot?: string;
  tempRoot?: string;
  packageControlledPaths?: readonly string[];
}

type Env = Record<string, string | undefined>;

const requiredKeys = [
  'FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE',
  'FORGELOOP_EXECUTOR_SANDBOX_BINARY_DIGEST',
  'FORGELOOP_EXECUTOR_SANDBOX_CONFIG_DIGEST',
  'FORGELOOP_EXECUTOR_ARTIFACT_ROOT',
  'FORGELOOP_EXECUTOR_TRUSTED_TOOLCHAINS',
  'FORGELOOP_EXECUTOR_DEFAULT_CPU_MS',
  'FORGELOOP_EXECUTOR_DEFAULT_MEMORY_MB',
  'FORGELOOP_EXECUTOR_DEFAULT_PIDS',
  'FORGELOOP_EXECUTOR_DEFAULT_FDS',
  'FORGELOOP_EXECUTOR_DEFAULT_WORKSPACE_BYTES',
  'FORGELOOP_EXECUTOR_DEFAULT_ARTIFACT_BYTES',
] as const;

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const controlCharacterPattern = /[\x00-\x1f\x7f]/;

export const parseExecutorRuntimeSafetyConfigFromEnv = (
  env: Env,
  options: ExecutorRuntimeSafetyConfigParseOptions = {},
): ExecutorRuntimeSafetyConfigParseResult => {
  const missingKeys = requiredKeys.filter((key) => !hasText(env[key]));
  if (missingKeys.length > 0) {
    return { status: 'unavailable', reason_code: 'runtime_hard_limits_unavailable', missing_keys: missingKeys };
  }

  const diagnostics: Array<{ code: string; message: string; path?: string }> = [];
  const disallowedBaseRoots = canonicalOptionalRoots([
    options.workspaceRoot,
    options.tempRoot,
    ...(options.packageControlledPaths ?? []),
  ]);

  const sandboxExecutable = canonicalExecutable(env.FORGELOOP_EXECUTOR_SANDBOX_EXECUTABLE, diagnostics);
  const artifactRoot = canonicalDirectory(env.FORGELOOP_EXECUTOR_ARTIFACT_ROOT, diagnostics, 'Artifact root must be an existing directory.');
  const sandboxConfigPath =
    env.FORGELOOP_EXECUTOR_SANDBOX_CONFIG_PATH === undefined || env.FORGELOOP_EXECUTOR_SANDBOX_CONFIG_PATH.trim().length === 0
      ? undefined
      : canonicalFile(env.FORGELOOP_EXECUTOR_SANDBOX_CONFIG_PATH, diagnostics, 'Sandbox config path must be an existing file.');
  const sandboxBinaryDigest = parseDigest(env.FORGELOOP_EXECUTOR_SANDBOX_BINARY_DIGEST, diagnostics, 'Sandbox binary digest must be a sha256 digest.');
  const sandboxConfigDigest = parseDigest(env.FORGELOOP_EXECUTOR_SANDBOX_CONFIG_DIGEST, diagnostics, 'Sandbox config digest must be a sha256 digest.');
  const trustedToolchains = parseTrustedToolchains(env.FORGELOOP_EXECUTOR_TRUSTED_TOOLCHAINS, diagnostics);

  const sandboxDefaults = {
    default_cpu_ms: parsePositiveInteger(env.FORGELOOP_EXECUTOR_DEFAULT_CPU_MS, diagnostics, 'FORGELOOP_EXECUTOR_DEFAULT_CPU_MS'),
    default_memory_mb: parsePositiveInteger(env.FORGELOOP_EXECUTOR_DEFAULT_MEMORY_MB, diagnostics, 'FORGELOOP_EXECUTOR_DEFAULT_MEMORY_MB'),
    default_pids: parsePositiveInteger(env.FORGELOOP_EXECUTOR_DEFAULT_PIDS, diagnostics, 'FORGELOOP_EXECUTOR_DEFAULT_PIDS'),
    default_fds: parsePositiveInteger(env.FORGELOOP_EXECUTOR_DEFAULT_FDS, diagnostics, 'FORGELOOP_EXECUTOR_DEFAULT_FDS'),
    default_workspace_bytes: parsePositiveInteger(
      env.FORGELOOP_EXECUTOR_DEFAULT_WORKSPACE_BYTES,
      diagnostics,
      'FORGELOOP_EXECUTOR_DEFAULT_WORKSPACE_BYTES',
    ),
    default_artifact_bytes: parsePositiveInteger(
      env.FORGELOOP_EXECUTOR_DEFAULT_ARTIFACT_BYTES,
      diagnostics,
      'FORGELOOP_EXECUTOR_DEFAULT_ARTIFACT_BYTES',
    ),
  };

  if (artifactRoot !== undefined) {
    rejectPathInsideRoots(artifactRoot, disallowedBaseRoots, diagnostics);
  }
  const disallowedRuntimeRoots = [...disallowedBaseRoots, ...(artifactRoot === undefined ? [] : [artifactRoot])];
  if (sandboxExecutable !== undefined) {
    rejectPathInsideRoots(sandboxExecutable, disallowedRuntimeRoots, diagnostics);
    rejectWritablePathOrAncestors(sandboxExecutable, diagnostics);
  }
  if (sandboxConfigPath !== undefined) {
    rejectPathInsideRoots(sandboxConfigPath, disallowedRuntimeRoots, diagnostics);
  }
  for (const toolchain of Object.values(trustedToolchains ?? {})) {
    for (const rootPath of toolchain.root_paths) {
      rejectPathInsideRoots(rootPath, disallowedRuntimeRoots, diagnostics);
      rejectWritablePathOrAncestors(rootPath, diagnostics);
    }
  }

  const defaultCpuMs = sandboxDefaults.default_cpu_ms;
  const defaultMemoryMb = sandboxDefaults.default_memory_mb;
  const defaultPids = sandboxDefaults.default_pids;
  const defaultFds = sandboxDefaults.default_fds;
  const defaultWorkspaceBytes = sandboxDefaults.default_workspace_bytes;
  const defaultArtifactBytes = sandboxDefaults.default_artifact_bytes;

  if (
    diagnostics.length > 0 ||
    sandboxExecutable === undefined ||
    sandboxBinaryDigest === undefined ||
    artifactRoot === undefined ||
    sandboxConfigDigest === undefined ||
    trustedToolchains === undefined ||
    defaultCpuMs === undefined ||
    defaultMemoryMb === undefined ||
    defaultPids === undefined ||
    defaultFds === undefined ||
    defaultWorkspaceBytes === undefined ||
    defaultArtifactBytes === undefined
  ) {
    return { status: 'invalid', reason_code: 'runtime_safety_config_invalid', diagnostics };
  }

  const sandbox: ExecutorRuntimeSafetyConfig['sandbox'] = {
    executable_path: sandboxExecutable,
    binary_digest: sandboxBinaryDigest,
    config_digest: sandboxConfigDigest,
    default_cpu_ms: defaultCpuMs,
    default_memory_mb: defaultMemoryMb,
    default_pids: defaultPids,
    default_fds: defaultFds,
    default_workspace_bytes: defaultWorkspaceBytes,
    default_artifact_bytes: defaultArtifactBytes,
  };
  if (sandboxConfigPath !== undefined) {
    sandbox.config_path = sandboxConfigPath;
  }

  return {
    status: 'available',
    config: {
      sandbox,
      artifact_root: artifactRoot,
      trusted_toolchains: trustedToolchains,
    },
  };
};

const hasText = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0;

const addDiagnostic = (
  diagnostics: Array<{ code: string; message: string; path?: string }>,
  code: string,
  message: string,
  path?: string,
): void => {
  diagnostics.push(path === undefined ? { code, message } : { code, message, path });
};

const parseDigest = (
  value: string | undefined,
  diagnostics: Array<{ code: string; message: string; path?: string }>,
  message: string,
): string | undefined => {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    addDiagnostic(diagnostics, 'runtime_safety_config_invalid', message);
    return undefined;
  }
  return value;
};

const parsePositiveInteger = (
  value: string | undefined,
  diagnostics: Array<{ code: string; message: string; path?: string }>,
  key: string,
): number | undefined => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    addDiagnostic(diagnostics, 'runtime_safety_config_invalid', `${key} must be a positive integer.`);
    return undefined;
  }
  return parsed;
};

const parseTrustedToolchains = (
  value: string | undefined,
  diagnostics: Array<{ code: string; message: string; path?: string }>,
): ExecutorRuntimeSafetyConfig['trusted_toolchains'] | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? '');
  } catch {
    addDiagnostic(diagnostics, 'runtime_safety_config_invalid', 'Trusted toolchains must be valid JSON.');
    return undefined;
  }
  if (!isPlainObject(parsed) || Object.keys(parsed).length === 0) {
    addDiagnostic(diagnostics, 'runtime_safety_config_invalid', 'Trusted toolchains must be a non-empty object.');
    return undefined;
  }

  const toolchains: ExecutorRuntimeSafetyConfig['trusted_toolchains'] = {};
  for (const [name, toolchain] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || !isPlainObject(toolchain)) {
      addDiagnostic(diagnostics, 'runtime_safety_config_invalid', 'Trusted toolchain entries must be named objects.');
      continue;
    }
    const rootPaths = parseStringArray(toolchain.root_paths);
    const executableNames = parseStringArray(toolchain.executable_names);
    const configDigest = parseDigest(
      typeof toolchain.config_digest === 'string' ? toolchain.config_digest : undefined,
      diagnostics,
      'Trusted toolchain config digest must be a sha256 digest.',
    );
    if (rootPaths === undefined || executableNames === undefined || rootPaths.length === 0 || executableNames.length === 0 || configDigest === undefined) {
      addDiagnostic(diagnostics, 'runtime_safety_config_invalid', 'Trusted toolchain entries require roots, executable names, and config digest.');
      continue;
    }
    const canonicalRoots = rootPaths
      .map((root) => canonicalDirectory(root, diagnostics, 'Trusted toolchain root must be an existing directory.'))
      .filter((root): root is string => root !== undefined);
    const normalizedNames = executableNames.filter((executableName) => {
      const valid =
        executableName.length > 0 &&
        !controlCharacterPattern.test(executableName) &&
        !executableName.includes('/') &&
        !executableName.includes('\\');
      if (!valid) {
        addDiagnostic(diagnostics, 'runtime_safety_config_invalid', 'Trusted executable names must be logical executable names.');
      }
      return valid;
    });
    toolchains[name] = {
      root_paths: canonicalRoots,
      executable_names: normalizedNames,
      config_digest: configDigest,
    };
  }

  return toolchains;
};

const parseStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return undefined;
  }
  return value;
};

const canonicalOptionalRoots = (paths: readonly (string | undefined)[]): string[] =>
  paths.filter(hasText).map((path) => canonicalRootOrResolved(path));

const canonicalRootOrResolved = (path: string): string => {
  const normalized = normalizedAbsolutePath(path);
  try {
    return realpathSync(normalized);
  } catch {
    return normalized;
  }
};

const canonicalDirectory = (
  path: string | undefined,
  diagnostics: Array<{ code: string; message: string; path?: string }>,
  message: string,
): string | undefined => {
  const normalized = canonicalExistingPath(path, diagnostics, message);
  if (normalized === undefined) {
    return undefined;
  }
  if (!statSync(normalized).isDirectory()) {
    addDiagnostic(diagnostics, 'runtime_safety_config_invalid', message, normalized);
    return undefined;
  }
  return normalized;
};

const canonicalFile = (
  path: string | undefined,
  diagnostics: Array<{ code: string; message: string; path?: string }>,
  message: string,
): string | undefined => {
  const normalized = canonicalExistingPath(path, diagnostics, message);
  if (normalized === undefined) {
    return undefined;
  }
  if (!statSync(normalized).isFile()) {
    addDiagnostic(diagnostics, 'runtime_safety_config_invalid', message, normalized);
    return undefined;
  }
  return normalized;
};

const canonicalExecutable = (
  path: string | undefined,
  diagnostics: Array<{ code: string; message: string; path?: string }>,
): string | undefined => {
  const normalized = canonicalFile(path, diagnostics, 'Sandbox executable must be an existing file.');
  if (normalized === undefined) {
    return undefined;
  }
  try {
    accessSync(normalized, fsConstants.X_OK);
  } catch {
    addDiagnostic(diagnostics, 'runtime_safety_config_invalid', 'Sandbox executable must be executable.', normalized);
    return undefined;
  }
  return normalized;
};

const canonicalExistingPath = (
  path: string | undefined,
  diagnostics: Array<{ code: string; message: string; path?: string }>,
  message: string,
): string | undefined => {
  if (!hasText(path) || controlCharacterPattern.test(path) || !isAbsolute(path)) {
    addDiagnostic(diagnostics, 'runtime_safety_config_invalid', message, path);
    return undefined;
  }
  try {
    return realpathSync(resolve(path));
  } catch {
    addDiagnostic(diagnostics, 'runtime_safety_config_invalid', message, path);
    return undefined;
  }
};

const normalizedAbsolutePath = (path: string): string => resolve(path);

const rejectPathInsideRoots = (
  candidate: string,
  roots: readonly string[],
  diagnostics: Array<{ code: string; message: string; path?: string }>,
): void => {
  const disallowedRoot = roots.find((root) => pathIsInside(candidate, root));
  if (disallowedRoot !== undefined) {
    addDiagnostic(
      diagnostics,
      'runtime_safety_path_rejected',
      'Runtime safety configured paths must not live under workspace, artifact, temp, or package-controlled roots.',
      candidate,
    );
  }
};

const rejectWritablePathOrAncestors = (
  candidate: string,
  diagnostics: Array<{ code: string; message: string; path?: string }>,
): void => {
  let current = candidate;
  while (true) {
    if (isWritable(current)) {
      addDiagnostic(diagnostics, 'runtime_safety_path_rejected', 'Trusted runtime executables and toolchains must not be writable.', candidate);
      return;
    }
    const parent = dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
};

const isWritable = (path: string): boolean => {
  try {
    accessSync(path, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const pathIsInside = (candidate: string, root: string): boolean => {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !isAbsolute(rel) && !rel.split(sep).includes('..'));
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
