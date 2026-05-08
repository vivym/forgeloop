import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  ExecutorFailure,
  ExecutorResult,
  RunSpec,
} from '../../contracts/src/executor.js';

import {
  createDefaultLocalCodexEnvironment,
  runLocalCodexPreflight,
  type LocalCodexEnvironment,
} from './local-codex-preflight.js';
import {
  captureFailedLocalCodexEvidence,
  captureLocalCodexEvidence,
} from './local-codex-evidence.js';
import { snapshotSourceRepoStatus } from './source-repo-guard.js';

const EXECUTOR_VERSION = '0.1.0';
const GIT_OUTPUT_MAX_BUFFER = 1024 * 1024 * 50;
const ALLOWED_ENV_KEYS = new Set(['PATH', 'TMPDIR', 'TEMP', 'TMP', 'SHELL', 'LANG', 'TERM']);

export interface CodexRunnerInput {
  runSpec: RunSpec;
  workspacePath: string;
  baseRef: string;
}

export interface CodexRunnerResult {
  status: 'succeeded' | 'failed';
  summary: string;
  failure?: ExecutorFailure;
}

export interface CodexRunner {
  run(input: CodexRunnerInput): Promise<CodexRunnerResult>;
}

export interface LocalCodexExecutorOptions {
  artifactRoot: string;
  codexHome?: string;
  environment?: LocalCodexEnvironment;
  runner?: CodexRunner;
}

const nowIso = () => new Date().toISOString();

const baseHermeticEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => ALLOWED_ENV_KEYS.has(key) || key.startsWith('LC_')));

const createHermeticEnv = async (root: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> => {
  const home = join(root, 'home');
  const xdgConfig = join(root, 'xdg-config');
  const xdgCache = join(root, 'xdg-cache');
  const xdgData = join(root, 'xdg-data');
  const npmCache = join(root, 'npm-cache');
  const pnpmHome = join(root, 'pnpm-home');
  const npmUserConfig = join(root, 'npmrc');
  const gitConfig = join(root, 'gitconfig');

  await mkdir(home, { recursive: true });
  await mkdir(xdgConfig, { recursive: true });
  await mkdir(xdgCache, { recursive: true });
  await mkdir(xdgData, { recursive: true });
  await mkdir(npmCache, { recursive: true });
  await mkdir(pnpmHome, { recursive: true });
  await writeFile(gitConfig, '');
  await writeFile(npmUserConfig, '');

  return {
    ...baseHermeticEnv(),
    HOME: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    XDG_DATA_HOME: xdgData,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_TERMINAL_PROMPT: '0',
    NPM_CONFIG_USERCONFIG: npmUserConfig,
    npm_config_userconfig: npmUserConfig,
    NPM_CONFIG_CACHE: npmCache,
    npm_config_cache: npmCache,
    PNPM_HOME: pnpmHome,
    ...extraEnv,
  };
};

export const createLocalCodexCheckEnv = async (
  environment: LocalCodexEnvironment,
  workspacePath: string,
): Promise<NodeJS.ProcessEnv> => {
  const { stdout } = await environment.runCommand('git', ['rev-parse', '--git-dir'], {
    cwd: workspacePath,
    maxBuffer: GIT_OUTPUT_MAX_BUFFER,
  });
  const gitDir = stdout.trim();
  const resolvedGitDir = resolve(workspacePath, gitDir);

  return createHermeticEnv(join(resolvedGitDir, '.forgeloop-hermetic-env'));
};

const configuredCodexHome = (options: LocalCodexExecutorOptions): string | undefined =>
  options.codexHome ?? process.env.FORGELOOP_CODEX_HOME ?? process.env.CODEX_HOME;

const createCodexEnv = (artifactRoot: string, runSpec: RunSpec, codexHome: string): Promise<NodeJS.ProcessEnv> =>
  createHermeticEnv(join(artifactRoot, safePathSegment(runSpec.run_session_id), 'codex-env'), {
    CODEX_HOME: codexHome,
  });

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : 'artifact';
};

const codexPromptFor = (runSpec: RunSpec) =>
  [
    `Objective:\n${runSpec.objective}`,
    `Spec revision summary:\n${runSpec.context.spec_revision_summary}`,
    `Plan revision summary:\n${runSpec.context.plan_revision_summary}`,
    `Package instructions:\n${runSpec.context.package_instructions}`,
    `Required checks:\n${JSON.stringify(runSpec.context.required_checks, null, 2)}`,
    `Allowed paths:\n${runSpec.allowed_paths.join('\n')}`,
    `Forbidden paths:\n${runSpec.forbidden_paths.join('\n')}`,
    `Requested change context:\n${JSON.stringify(runSpec.review_context.requested_changes, null, 2)}`,
    'Do not push, open a pull request, merge, release, or modify files outside the allowed paths.',
  ].join('\n\n');

const defaultRunner = (environment: LocalCodexEnvironment, env: NodeJS.ProcessEnv): CodexRunner => ({
  run: async ({ runSpec, workspacePath }) => {
    if (!(await environment.commandExists('codex'))) {
      return {
        status: 'failed',
        summary: 'Codex runtime became unavailable after preflight.',
        failure: {
          kind: 'executor_process_failed',
          message: 'Codex runtime became unavailable after preflight.',
          retryable: true,
        },
      };
    }

    try {
      await environment.runCodex({
        workspacePath,
        prompt: codexPromptFor(runSpec),
        env,
      });

      return {
        status: 'succeeded',
        summary: 'Codex runner completed.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex process failed.';

      return {
        status: 'failed',
        summary: `Codex process failed: ${message}`,
        failure: {
          kind: 'executor_error',
          message: `Codex process failed: ${message}`,
          retryable: true,
        },
      };
    }
  },
});

const executorFailureResult = (input: {
  runSpec: RunSpec;
  startedAt: string;
  summary: string;
  failure: ExecutorFailure;
  rawMetadata?: Record<string, string | number | boolean | null>;
}): ExecutorResult => ({
  run_session_id: input.runSpec.run_session_id,
  executor_type: 'local_codex',
  executor_version: EXECUTOR_VERSION,
  status: 'failed',
  started_at: input.startedAt,
  finished_at: nowIso(),
  summary: input.summary,
  changed_files: [],
  checks: [],
  artifacts: [],
  failure: input.failure,
  raw_metadata: input.rawMetadata ?? {},
});

const appendGitConfigEnv = (
  env: NodeJS.ProcessEnv,
  entries: Array<{ key: string; value: string }>,
) => {
  const existingCount = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
  const offset = Number.isFinite(existingCount) ? existingCount : 0;

  env.GIT_CONFIG_COUNT = String(offset + entries.length);
  entries.forEach((entry, index) => {
    const envIndex = offset + index;
    env[`GIT_CONFIG_KEY_${envIndex}`] = entry.key;
    env[`GIT_CONFIG_VALUE_${envIndex}`] = entry.value;
  });
};

const neutralizeGitRemotes = async (
  environment: LocalCodexEnvironment,
  workspacePath: string,
  env: NodeJS.ProcessEnv,
): Promise<Array<{ key: string; value: string }>> => {
  const { stdout } = await environment.runCommand('git', ['remote'], {
    cwd: workspacePath,
    env,
    maxBuffer: GIT_OUTPUT_MAX_BUFFER,
  });
  const remotes = stdout
    .split('\n')
    .map((remote) => remote.trim())
    .filter(Boolean);

  if (remotes.length === 0) {
    return [];
  }

  const entries = remotes.map((remote) => ({
    key: `remote.${remote}.pushurl`,
    value: 'DISABLED_BY_FORGELOOP',
  }));

  // Use process-local Git config overrides so linked worktrees do not mutate shared source repo config.
  appendGitConfigEnv(env, entries);

  return entries;
};

const applyRemoteNeutralization = async (input: {
  environment: LocalCodexEnvironment;
  workspacePath: string;
  checkEnv: NodeJS.ProcessEnv;
  codexEnv?: NodeJS.ProcessEnv;
}) => {
  const entries = await neutralizeGitRemotes(input.environment, input.workspacePath, input.checkEnv);

  if (input.codexEnv !== undefined) {
    appendGitConfigEnv(input.codexEnv, entries);
  }
};

export const runLocalCodexExecutor = async (
  runSpec: RunSpec,
  options: LocalCodexExecutorOptions,
): Promise<ExecutorResult> => {
  const startedAt = nowIso();
  const environment = options.environment ?? createDefaultLocalCodexEnvironment();
  const usesDefaultRunner = options.runner === undefined;
  const codexHome = configuredCodexHome(options);

  if (usesDefaultRunner && codexHome === undefined) {
    return executorFailureResult({
      runSpec,
      startedAt,
      summary: 'Local Codex preflight failed: Codex home is not configured for hermetic execution.',
      failure: {
        kind: 'preflight_failed',
        message: 'Codex home is not configured for hermetic execution. Set codexHome, FORGELOOP_CODEX_HOME, or CODEX_HOME.',
        retryable: false,
      },
    });
  }

  let codexEnv: NodeJS.ProcessEnv | undefined;
  if (usesDefaultRunner && codexHome !== undefined) {
    try {
      codexEnv = await createCodexEnv(options.artifactRoot, runSpec, codexHome);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown Codex environment setup error';
      return executorFailureResult({
        runSpec,
        startedAt,
        summary: `Local Codex preflight failed: Codex environment setup failed: ${message}`,
        failure: {
          kind: 'preflight_failed',
          message: `Codex environment setup failed: ${message}`,
          retryable: false,
        },
      });
    }
  }

  const preflightOptions = {
    artifactRoot: options.artifactRoot,
    environment,
    ...(codexEnv === undefined ? {} : { codexEnv }),
  };
  const preflight = await runLocalCodexPreflight(runSpec, preflightOptions);

  if (!preflight.ok) {
    return executorFailureResult({
      runSpec,
      startedAt,
      summary: `Local Codex preflight failed: ${preflight.failure.message}`,
      failure: preflight.failure,
    });
  }

  const checkEnv = await createLocalCodexCheckEnv(environment, preflight.workspacePath);
  await applyRemoteNeutralization({
    environment,
    workspacePath: preflight.workspacePath,
    checkEnv,
    ...(codexEnv === undefined ? {} : { codexEnv }),
  });
  let sourceRepoSnapshot: Awaited<ReturnType<typeof snapshotSourceRepoStatus>>;
  try {
    sourceRepoSnapshot = await snapshotSourceRepoStatus(environment, runSpec.repo.local_path);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown source repo snapshot error';

    return executorFailureResult({
      runSpec,
      startedAt,
      summary: `Local Codex preflight failed: Source repo status snapshot failed: ${message}`,
      failure: {
        kind: 'preflight_failed',
        message: `Source repo status snapshot failed: ${message}`,
        retryable: false,
      },
      rawMetadata: {
        workspace_path: preflight.workspacePath,
        base_ref: preflight.resolvedBaseRef,
        source_repo_before_status: null,
        source_repo_after_status: null,
        effective_dangerous_mode: usesDefaultRunner ? 'confirmed' : 'not_requested',
      },
    });
  }
  const effectiveDangerousMode = usesDefaultRunner ? 'confirmed' : 'not_requested';

  const runner = options.runner ?? defaultRunner(environment, codexEnv ?? checkEnv);
  const runnerResult = await runner.run({
    runSpec,
    workspacePath: preflight.workspacePath,
    baseRef: preflight.resolvedBaseRef,
  });

  if (runnerResult.status !== 'succeeded') {
    return captureFailedLocalCodexEvidence({
      runSpec,
      workspacePath: preflight.workspacePath,
      baseRef: preflight.resolvedBaseRef,
      artifactRoot: options.artifactRoot,
      summary: runnerResult.summary,
      startedAt,
      environment,
      checkEnv,
      sourceRepoSnapshot,
      effectiveDangerousMode,
      failure:
        runnerResult.failure ??
        ({
          kind: 'executor_process_failed',
          message: runnerResult.summary,
          retryable: true,
        } satisfies ExecutorFailure),
    });
  }

  return captureLocalCodexEvidence({
    runSpec,
    workspacePath: preflight.workspacePath,
    baseRef: preflight.resolvedBaseRef,
    artifactRoot: options.artifactRoot,
    summary: runnerResult.summary,
    startedAt,
    environment,
    checkEnv,
    sourceRepoSnapshot,
    effectiveDangerousMode,
  });
};
