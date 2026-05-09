import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { ArtifactRef, ChangedFile, CheckResult, RunSpec } from '@forgeloop/contracts';
import {
  sourceDirtyEntriesFromPorcelain,
  worktreePathForRun,
  type StrictPreflightBlocker,
  type StrictPreflightResult,
} from '../packages/executor/src/index.js';

type Env = Record<string, string | undefined>;

type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Env; timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

type PreflightResult =
  | (StrictPreflightResult & {
      ok: true;
      repoPath: string;
      dirtyFiles: string[];
      dirtySource: StrictDirtySourceSummary;
      dirtyOverride?: { allowed: true; dirtyFiles: string[] };
      worktreeProbePath: string;
    })
  | (StrictPreflightResult & {
      ok: false;
      message: string;
      repoPath: string;
      dirtyFiles?: string[];
      dirtySource?: StrictDirtySourceSummary;
      unexpectedDirtyFiles?: string[];
      worktreeProbePath?: string;
    });

type StrictDirtySourceSummary = {
  allowed_dirty_entries: string[];
  blocked_dirty_entries: string[];
  dirty_allowlist_source: typeof STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE;
};

type RuntimeMetadataReport = {
  executor_type?: string;
  runtime_metadata?: Record<string, unknown>;
};

type TerminalEvidenceReport = {
  changed_files?: Array<Partial<ChangedFile>>;
  check_results?: Array<Partial<CheckResult>>;
  artifacts?: Array<Partial<ArtifactRef>>;
  review_packet?: { id?: string; artifact_path?: string };
};

type ObservedRunEvent = {
  event_type?: string;
  visibility?: string;
  status?: string;
  cursor?: string;
  runStatusAtObservation?: string;
  payload?: Record<string, unknown>;
};

const execFile = promisify(execFileCallback);

const terminalStatuses = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);

export const STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE = 'STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST';
export const STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST = [
  'docs/superpowers/reports/p0-dogfood-work-items-completion.md',
  '.superpowers/**',
] as const;
const DANGEROUS_MODE_CONFIRMATION_ENV = 'FORGELOOP_LOCAL_CODEX_DOGFOOD_CONFIRM_DANGEROUS_MODE';

const defaultRunCommand: CommandRunner = async (command, args, options = {}) => {
  const childOptions: Parameters<typeof execFile>[2] = { maxBuffer: 1024 * 1024 * 10 };
  if (options.cwd !== undefined) {
    childOptions.cwd = options.cwd;
  }
  if (options.env !== undefined) {
    childOptions.env = { ...process.env, ...options.env };
  }
  if (options.timeoutMs !== undefined) {
    childOptions.timeout = options.timeoutMs;
  }
  const { stdout, stderr } = await execFile(command, args, childOptions);
  return { stdout: String(stdout), stderr: String(stderr) };
};

const isMainModule = (): boolean => process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

const nowIso = (): string => new Date().toISOString();

const isTerminalStatus = (status: unknown): boolean => typeof status === 'string' && terminalStatuses.has(status);

const codexLiveProgressEventTypes = new Set([
  'thread_started',
  'thread_resumed',
  'turn_started',
  'agent_message_delta',
  'agent_message_completed',
  'command_output_delta',
  'driver_fallback_used',
]);

export const evaluateLocalCodexDogfoodEnablement = (env: Env): {
  enabled: boolean;
  exitCode: number;
  status: 'enabled' | 'skipped';
  message: string;
} => {
  if (env.FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD === '1') {
    return {
      enabled: true,
      exitCode: 0,
      status: 'enabled',
      message: 'Real local Codex dogfood enabled.',
    };
  }

  return {
    enabled: false,
    exitCode: 0,
    status: 'skipped',
    message: 'Real local Codex dogfood disabled; set FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 to run.',
  };
};

export const parseDirtySourceFiles = (porcelain: string): string[] => sourceDirtyEntriesFromPorcelain(porcelain);

const matchesStrictDirtyAllowlist = (path: string): boolean => {
  if (path !== path.trim()) {
    return false;
  }

  return STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST.some((pattern) => {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -'/**'.length);

      return path === prefix || path.startsWith(`${prefix}/`);
    }

    return path === pattern;
  });
};

const classifyStrictDirtySource = (dirtyFiles: string[]): StrictDirtySourceSummary => {
  const allowed_dirty_entries = dirtyFiles.filter(matchesStrictDirtyAllowlist);
  const allowed = new Set(allowed_dirty_entries);
  const blocked_dirty_entries = dirtyFiles.filter((path) => !allowed.has(path));

  return {
    allowed_dirty_entries,
    blocked_dirty_entries,
    dirty_allowlist_source: STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE,
  };
};

const commandExists = async (runCommand: CommandRunner, command: string, cwd: string): Promise<boolean> => {
  try {
    await runCommand(command, ['--version'], { cwd, timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
};

const strictBlocker = (
  code: StrictPreflightBlocker['code'],
  message: string,
  details?: Record<string, unknown>,
): StrictPreflightBlocker => ({
  code,
  message,
  ...(details === undefined ? {} : { details }),
});

const strictFailure = (input: {
  repoPath: string;
  blockers: StrictPreflightBlocker[];
  dirtyFiles?: string[];
  dirtySource?: StrictDirtySourceSummary;
  unexpectedDirtyFiles?: string[];
  worktreeProbePath?: string;
}): PreflightResult => ({
  ok: false,
  repoPath: input.repoPath,
  blockers: input.blockers,
  message: input.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`).join('; '),
  ...(input.dirtyFiles === undefined ? {} : { dirtyFiles: input.dirtyFiles }),
  ...(input.dirtySource === undefined ? {} : { dirtySource: input.dirtySource }),
  ...(input.unexpectedDirtyFiles === undefined ? {} : { unexpectedDirtyFiles: input.unexpectedDirtyFiles }),
  ...(input.worktreeProbePath === undefined ? {} : { worktreeProbePath: input.worktreeProbePath }),
});

const checkDurableRepositoryAvailable = async (input: {
  env: Env;
  repoPath: string;
  runCommand: CommandRunner;
}): Promise<StrictPreflightBlocker | undefined> => {
  if (input.env.FORGELOOP_DATABASE_URL?.trim() === undefined || input.env.FORGELOOP_DATABASE_URL.trim().length === 0) {
    return undefined;
  }

  try {
    await input.runCommand('pnpm', ['db:push'], {
      cwd: input.repoPath,
      env: { FORGELOOP_DATABASE_URL: input.env.FORGELOOP_DATABASE_URL },
      timeoutMs: 60_000,
    });

    return undefined;
  } catch (error) {
    return strictBlocker('durable_repo_unavailable', 'Durable repository is unavailable for FORGELOOP_DATABASE_URL', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const probeWorktreeCreation = async (input: {
  repoPath: string;
  runCommand: CommandRunner;
}): Promise<{ workspacePath: string; blocker?: StrictPreflightBlocker }> => {
  const runSessionId = `strict-preflight-${Date.now()}`;
  const workspacePath = worktreePathForRun(input.repoPath, runSessionId);

  try {
    await input.runCommand('git', ['worktree', 'add', '--detach', workspacePath, 'HEAD'], {
      cwd: input.repoPath,
      timeoutMs: 60_000,
    });

    return { workspacePath };
  } catch (error) {
    return {
      workspacePath,
      blocker: strictBlocker('worktree_create_failed', 'Unable to create isolated local Codex worktree', {
        workspace_path: workspacePath,
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  } finally {
    await input.runCommand('git', ['worktree', 'remove', '--force', workspacePath], {
      cwd: input.repoPath,
      timeoutMs: 60_000,
    }).catch(() => undefined);
    await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
  }
};

export const preflightLocalCodexDogfood = async (input: {
  env: Env;
  repoPath: string;
  runCommand?: CommandRunner;
}): Promise<PreflightResult> => {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const repoPath = resolve(input.repoPath);
  const blockers: StrictPreflightBlocker[] = [];
  let codexCommandAvailable = true;
  let dirtyFiles: string[] | undefined;
  let dirtySource: StrictDirtySourceSummary | undefined;
  let worktreeProbePath: string | undefined;

  if (!(await commandExists(runCommand, 'git', repoPath))) {
    return strictFailure({
      repoPath,
      blockers: [strictBlocker('worktree_create_failed', 'Missing required command: git')],
    });
  }

  if (!(await commandExists(runCommand, 'codex', repoPath))) {
    codexCommandAvailable = false;
    blockers.push(strictBlocker('missing_codex_command', 'Missing required command: codex'));
  }

  if (codexCommandAvailable) {
    try {
      await runCommand('codex', ['login', 'status'], { cwd: repoPath, timeoutMs: 15_000 });
    } catch {
      blockers.push(
        strictBlocker('codex_not_authenticated', 'Codex runtime is not authenticated or ready for local execution'),
      );
    }
  }

  if (input.env[DANGEROUS_MODE_CONFIRMATION_ENV] !== '1') {
    blockers.push(
      strictBlocker(
        'dangerous_mode_unconfirmed',
        `Dangerous local Codex execution mode is unconfirmed; set ${DANGEROUS_MODE_CONFIRMATION_ENV}=1 to acknowledge --dangerously-bypass-approvals-and-sandbox.`,
        {
          required_env: DANGEROUS_MODE_CONFIRMATION_ENV,
          actual_value: input.env[DANGEROUS_MODE_CONFIRMATION_ENV] ?? null,
        },
      ),
    );
  }

  try {
    const { stdout } = await runCommand('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: repoPath,
      timeoutMs: 15_000,
    });
    dirtyFiles = parseDirtySourceFiles(stdout);
  } catch (error) {
    blockers.push(
      strictBlocker('source_dirty_blocked', 'Unable to inspect source checkout cleanliness', {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    dirtyFiles = [];
  }

  dirtySource = classifyStrictDirtySource(dirtyFiles);
  if (dirtySource.blocked_dirty_entries.length > 0) {
    blockers.push(
      strictBlocker('source_dirty_blocked', 'Source checkout is dirty', {
        ...dirtySource,
      }),
    );
  }

  if (blockers.length > 0) {
    return strictFailure({
      repoPath,
      blockers,
      dirtyFiles,
      dirtySource,
      unexpectedDirtyFiles: dirtySource.blocked_dirty_entries.length === 0 ? undefined : dirtySource.blocked_dirty_entries,
      worktreeProbePath,
    });
  }

  const durableRepoBlocker = await checkDurableRepositoryAvailable({ env: input.env, repoPath, runCommand });
  if (durableRepoBlocker !== undefined) {
    blockers.push(durableRepoBlocker);
  }

  if (blockers.length > 0) {
    return strictFailure({
      repoPath,
      blockers,
      dirtyFiles,
      dirtySource,
      unexpectedDirtyFiles: dirtySource.blocked_dirty_entries.length === 0 ? undefined : dirtySource.blocked_dirty_entries,
      worktreeProbePath,
    });
  }

  const worktreeProbe = await probeWorktreeCreation({ repoPath, runCommand });
  worktreeProbePath = worktreeProbe.workspacePath;
  if (worktreeProbe.blocker !== undefined) {
    blockers.push(worktreeProbe.blocker);
  }

  if (blockers.length > 0) {
    return strictFailure({
      repoPath,
      blockers,
      dirtyFiles,
      dirtySource,
      unexpectedDirtyFiles: dirtySource.blocked_dirty_entries.length === 0 ? undefined : dirtySource.blocked_dirty_entries,
      worktreeProbePath,
    });
  }

  return {
    ok: true,
    blockers: [],
    repoPath,
    dirtyFiles,
    dirtySource,
    worktreeProbePath,
    ...(input.env.FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY === '1' && dirtySource.allowed_dirty_entries.length > 0
      ? { dirtyOverride: { allowed: true as const, dirtyFiles: dirtySource.allowed_dirty_entries } }
      : {}),
  };
};

export const buildCodexExecFallbackCommand = (prompt: string): { command: 'codex'; args: string[] } => ({
  command: 'codex',
  args: ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', prompt],
});

export const selectCodexExecutionMode = async (input: {
  attemptAppServer: () => Promise<{ ok: true } | { ok: false; reason: string }>;
  buildExecFallback: () => { command: string; args: string[] };
}): Promise<
  | { mode: 'app_server'; appServerAttempted: true; fallbackReason?: undefined; execFallbackCommand?: undefined }
  | {
      mode: 'exec_fallback';
      appServerAttempted: true;
      fallbackReason: string;
      execFallbackCommand: { command: string; args: string[] };
    }
> => {
  const appServer = await input.attemptAppServer();
  if (appServer.ok) {
    return { mode: 'app_server', appServerAttempted: true };
  }

  return {
    mode: 'exec_fallback',
    appServerAttempted: true,
    fallbackReason: appServer.reason,
    execFallbackCommand: input.buildExecFallback(),
  };
};

export const buildBoundedLocalCodexRunPackage = (input: {
  repoPath: string;
  baseCommitSha: string;
}): Partial<RunSpec> => {
  const requiredChecks = [
    {
      check_id: 'dogfood-required',
      display_name: 'Local Codex dogfood required check',
      command: 'node -e "process.exit(0)"',
      timeout_seconds: 30,
      blocks_review: true,
    },
  ];

  return {
    run_session_id: `local-codex-dogfood-${Date.now()}`,
    execution_package_id: 'local-codex-dogfood-package',
    work_item_id: 'local-codex-dogfood-work-item',
    spec_revision_id: 'local-codex-dogfood-spec-revision',
    plan_revision_id: 'local-codex-dogfood-plan-revision',
    executor_type: 'local_codex',
    repo: {
      repo_id: 'forgeloop-source',
      local_path: input.repoPath,
      base_branch: 'HEAD',
      base_commit_sha: input.baseCommitSha,
    },
    objective:
      'Append a short local Codex dogfood marker line to README.md only. Do not edit files outside README.md.',
    context: {
      spec_revision_summary: 'Opt-in real local Codex dogfood.',
      plan_revision_summary: 'Validate app-server first, exec fallback, live events, and terminal evidence.',
      package_instructions: 'Modify only README.md with a harmless marker line for evidence capture.',
      required_checks: requiredChecks,
    },
    review_context: { requested_changes: [] },
    workflow_only: false,
    allowed_paths: ['README.md'],
    forbidden_paths: ['.git', '.env', 'node_modules'],
    required_checks: requiredChecks,
    artifact_policy: { requested_artifacts: ['execution_summary', 'diff', 'changed_files', 'check_output', 'review_packet'] },
    timeout_seconds: 300,
    idempotency_key: `local-codex-dogfood-${Date.now()}`,
  };
};

export const validateLocalCodexRuntimeMetadata = (
  input: RuntimeMetadataReport,
  options: { expectedRunSessionId?: string } = {},
): void => {
  if (input.executor_type !== 'local_codex') {
    throw new Error('Runtime metadata assertion failed: expected executor_type local_codex.');
  }

  const metadata = input.runtime_metadata ?? {};
  const workspacePath = metadata.workspace_path;
  if (typeof workspacePath !== 'string' || !workspacePath.includes('/.worktrees/')) {
    throw new Error('Runtime metadata assertion failed: expected worktree workspace_path.');
  }
  if (
    options.expectedRunSessionId !== undefined &&
    !workspacePath.endsWith(`/.worktrees/${options.expectedRunSessionId}`)
  ) {
    throw new Error('Runtime metadata assertion failed: expected run-session-id worktree workspace_path.');
  }

  if (metadata.app_server_attempted !== true) {
    throw new Error('Runtime metadata assertion failed: expected app_server_attempted=true.');
  }

  if (metadata.selected_execution_mode !== 'app_server' && metadata.selected_execution_mode !== 'exec_fallback') {
    throw new Error('Runtime metadata assertion failed: selected_execution_mode is required.');
  }

  if (metadata.effective_dangerous_mode !== 'confirmed') {
    throw new Error('Runtime metadata assertion failed: expected confirmed dangerous mode.');
  }

  if (metadata.selected_execution_mode === 'exec_fallback') {
    if (metadata.exec_fallback_dangerous_bypass !== true || metadata.effective_dangerous_mode !== 'confirmed') {
      throw new Error('Runtime metadata assertion failed: exec fallback must record confirmed dangerous bypass mode.');
    }
    if (typeof metadata.app_server_fallback_reason !== 'string' || metadata.app_server_fallback_reason.length === 0) {
      throw new Error('Runtime metadata assertion failed: exec fallback must record app_server_fallback_reason.');
    }
  }
};

export const runSessionRuntimeMetadataReport = (runSession: RuntimeMetadataReport): RuntimeMetadataReport => ({
  executor_type: runSession.executor_type,
  runtime_metadata: runSession.runtime_metadata,
});

export const recordLiveEventObservation = (
  events: ObservedRunEvent[],
): { sawPublicPreTerminalEvent: true; preTerminalPublicEvents: string[]; terminalEventType: string } => {
  const terminalIndex = events.findIndex((event) => isTerminalStatus(event.status) || event.event_type === 'executor_succeeded');
  const effectiveTerminalIndex = terminalIndex < 0 ? events.length : terminalIndex;
  const preTerminalPublicEvents = events
    .slice(0, effectiveTerminalIndex)
    .filter(
      (event) =>
        event.visibility === 'public' &&
        typeof event.event_type === 'string' &&
        codexLiveProgressEventTypes.has(event.event_type) &&
        typeof event.runStatusAtObservation === 'string' &&
        !isTerminalStatus(event.runStatusAtObservation),
    )
    .map((event) => event.event_type)
    .filter((eventType): eventType is string => eventType !== undefined && eventType.length > 0);
  const terminalEvent = terminalIndex < 0 ? undefined : events[terminalIndex]?.event_type;

  if (preTerminalPublicEvents.length === 0) {
    throw new Error('Run did not expose a public non-terminal live event with Codex live progress before terminal completion.');
  }

  return {
    sawPublicPreTerminalEvent: true,
    preTerminalPublicEvents,
    terminalEventType: terminalEvent ?? 'unknown',
  };
};

export const extractPersistedTerminalEvidence = (input: {
  runSession: Record<string, unknown>;
  reviewPacket?: { id?: string; path?: string };
}): TerminalEvidenceReport => {
  const evidence = {
    changed_files: Array.isArray(input.runSession.changed_files)
      ? (input.runSession.changed_files as Array<Partial<ChangedFile>>)
      : [],
    check_results: Array.isArray(input.runSession.check_results)
      ? (input.runSession.check_results as Array<Partial<CheckResult>>)
      : [],
    artifacts: Array.isArray(input.runSession.artifacts) ? (input.runSession.artifacts as Array<Partial<ArtifactRef>>) : [],
    review_packet:
      input.reviewPacket?.path === undefined
        ? undefined
        : {
            id: input.reviewPacket.id,
            artifact_path: input.reviewPacket.path,
          },
  };
  validateTerminalEvidence(evidence);

  return evidence;
};

export const resolveReviewPacketReference = (input: {
  apiUrl: string;
  runSession: Record<string, unknown>;
  cockpit?: { review_packets?: Array<{ id?: string }> };
}): { id?: string; path: string } | undefined => {
  const artifacts = Array.isArray(input.runSession.artifacts) ? (input.runSession.artifacts as ArtifactRef[]) : [];
  const reviewPacketArtifact = artifacts.find((artifact) => artifact.kind === 'review_packet');
  if (typeof reviewPacketArtifact?.local_ref === 'string' && reviewPacketArtifact.local_ref.length > 0) {
    return { id: reviewPacketArtifact.name, path: reviewPacketArtifact.local_ref };
  }

  const reviewPacketId = input.cockpit?.review_packets?.find((packet) => typeof packet.id === 'string')?.id;
  if (reviewPacketId !== undefined) {
    return { id: reviewPacketId, path: `${input.apiUrl}/review-packets/${encodeURIComponent(reviewPacketId)}` };
  }

  return undefined;
};

export const validateTerminalEvidence = (input: TerminalEvidenceReport): void => {
  if ((input.changed_files ?? []).length === 0) {
    throw new Error('Terminal evidence is missing changed files.');
  }
  if ((input.check_results ?? []).length === 0) {
    throw new Error('Terminal evidence is missing checks.');
  }
  if ((input.artifacts ?? []).length === 0) {
    throw new Error('Terminal evidence is missing artifacts.');
  }
  if (typeof input.review_packet?.artifact_path !== 'string' || input.review_packet.artifact_path.length === 0) {
    throw new Error('Terminal evidence is missing a Review Packet artifact/path.');
  }
};

export const buildSourceGuardInjectionPlan = (repoPath: string): {
  relativePath: string;
  mutationPath: string;
  inject: () => Promise<void>;
  cleanup: () => Promise<void>;
} => {
  const relativePath = '.forgeloop/dogfood-source-guard-probe.txt';
  const mutationPath = join(resolve(repoPath), relativePath);

  return {
    relativePath,
    mutationPath,
    inject: async () => {
      await mkdir(join(resolve(repoPath), '.forgeloop'), { recursive: true });
      await writeFile(mutationPath, `forgeloop dogfood source guard probe ${nowIso()}\n`, 'utf8');
    },
    cleanup: async () => {
      await rm(mutationPath, { force: true });
    },
  };
};

export const renderLocalCodexDogfoodReport = (input: {
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  preflight?: PreflightResult;
  runtimeMetadata?: Record<string, unknown>;
  terminalEvidence?: TerminalEvidenceReport;
  liveEvents?: ObservedRunEvent[];
  sourceGuardInjection?: { relativePath: string; cleanedUp: boolean; failureKind?: string };
  error?: string;
}): string => {
  const lines = [
    '# P0 Real Local Codex Dogfood',
    '',
    `- Status: ${input.status}`,
  ];

  if (input.preflight?.ok === true && input.preflight.dirtyOverride !== undefined) {
    lines.push(`- Dirty override: ENABLED for ${input.preflight.dirtyOverride.dirtyFiles.join(', ')}`);
  } else {
    lines.push('- Dirty override: not used');
  }

  if (input.preflight?.ok === false) {
    for (const blocker of input.preflight.blockers) {
      lines.push(`- Strict preflight blocker: ${blocker.code} - ${blocker.message}`);
      if (blocker.details !== undefined) {
        lines.push(`  - Details: ${JSON.stringify(blocker.details)}`);
      }
    }
    if (input.preflight.dirtySource !== undefined) {
      lines.push(`- Allowed dirty entries: ${input.preflight.dirtySource.allowed_dirty_entries.join(', ')}`);
      lines.push(`- Blocked dirty entries: ${input.preflight.dirtySource.blocked_dirty_entries.join(', ')}`);
      lines.push(`- Dirty allowlist source: ${input.preflight.dirtySource.dirty_allowlist_source}`);
    } else if (input.preflight.dirtyFiles !== undefined) {
      lines.push(`- Dirty files: ${input.preflight.dirtyFiles.join(', ')}`);
    }
  }

  if (input.runtimeMetadata !== undefined) {
    lines.push(`- Runtime metadata: ${JSON.stringify(input.runtimeMetadata)}`);
  }

  if (input.liveEvents !== undefined) {
    lines.push(`- Live events observed: ${input.liveEvents.map((event) => event.event_type ?? 'unknown').join(', ')}`);
  }

  if (input.terminalEvidence !== undefined) {
    lines.push(`- Changed files: ${(input.terminalEvidence.changed_files ?? []).map((file) => file.path).join(', ')}`);
    lines.push(`- Checks: ${(input.terminalEvidence.check_results ?? []).map((check) => check.check_id).join(', ')}`);
    lines.push(`- Artifacts: ${(input.terminalEvidence.artifacts ?? []).map((artifact) => artifact.kind).join(', ')}`);
    lines.push(`- Review Packet: ${input.terminalEvidence.review_packet?.artifact_path ?? 'missing'}`);
  }

  if (input.sourceGuardInjection !== undefined) {
    lines.push(
      `- Source guard injection: ${input.sourceGuardInjection.relativePath} cleanup=${String(input.sourceGuardInjection.cleanedUp)}${
        input.sourceGuardInjection.failureKind === undefined ? '' : ` failure=${input.sourceGuardInjection.failureKind}`
      }`,
    );
  }

  if (input.error !== undefined) {
    lines.push(`- Error: ${input.error}`);
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
};

const requestJson = async <T>(apiUrl: string, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const response = await fetch(`${apiUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed with ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
};

export const startApi = async (): Promise<{ apiUrl: string; close: () => Promise<void> }> => {
  const [{ Test }, { AppModule }, { RunWorkerLifecycleService }] = await Promise.all([
    import('@nestjs/testing'),
    import('../apps/control-plane-api/src/app.module.js'),
    import('../apps/control-plane-api/src/p0/run-worker-lifecycle.service.js'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RunWorkerLifecycleService)
    .useValue({ onModuleInit: () => undefined, onModuleDestroy: () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('Unable to determine local API port.');
  }
  return {
    apiUrl: `http://127.0.0.1:${address.port}`,
    close: () => app.close(),
  };
};

const createPackageThroughApi = async (apiUrl: string, repoPath: string, baseCommitSha: string): Promise<string> => {
  const actor = 'local-codex-dogfood-actor';
  const project = await requestJson<{ id: string }>(apiUrl, '/projects', {
    method: 'POST',
    body: { name: `Local Codex Dogfood ${Date.now()}`, owner_actor_id: actor },
  });
  await requestJson(apiUrl, `/projects/${encodeURIComponent(project.id)}/repos`, {
    method: 'POST',
    body: {
      repo_id: 'forgeloop-source',
      name: 'Forgeloop Source',
      local_path: repoPath,
      default_branch: 'HEAD',
      base_commit_sha: baseCommitSha,
    },
  });
  const workItem = await requestJson<{ id: string }>(apiUrl, '/work-items', {
    method: 'POST',
    body: {
      project_id: project.id,
      kind: 'test_refactor',
      title: 'Real local Codex dogfood',
      goal: 'Validate real local_codex execution path.',
      success_criteria: ['Local Codex run produces terminal review evidence.'],
      priority: 'P0',
      risk: 'medium',
      owner_actor_id: actor,
    },
  });
  const spec = await requestJson<{ id: string }>(apiUrl, `/work-items/${encodeURIComponent(workItem.id)}/specs`, { method: 'POST' });
  const specRevision = await requestJson<{ id: string }>(apiUrl, `/specs/${encodeURIComponent(spec.id)}/revisions`, {
    method: 'POST',
    body: {
      summary: 'Real local Codex dogfood spec',
      content: 'Validate opt-in real local_codex execution.',
      background: 'Task 5 requires a production-shaped local Codex run.',
      goals: ['Run local_codex through the public API.'],
      scope_in: ['README.md marker change'],
      scope_out: ['Source checkout mutation by Codex'],
      acceptance_criteria: ['Terminal evidence and Review Packet artifact are present.'],
      risk_notes: ['Requires local Codex runtime.'],
      test_strategy_summary: 'Run harmless node check.',
      author_actor_id: actor,
    },
  });
  await requestJson(apiUrl, `/specs/${encodeURIComponent(spec.id)}/submit-for-approval`, { method: 'POST', body: { actor_id: actor } });
  await requestJson(apiUrl, `/specs/${encodeURIComponent(spec.id)}/approve`, { method: 'POST', body: { actor_id: actor } });

  const plan = await requestJson<{ id: string }>(apiUrl, `/work-items/${encodeURIComponent(workItem.id)}/plans`, { method: 'POST' });
  const planRevision = await requestJson<{ id: string }>(apiUrl, `/plans/${encodeURIComponent(plan.id)}/revisions`, {
    method: 'POST',
    body: {
      summary: 'Real local Codex dogfood plan',
      content: 'Create one bounded package and run it through local_codex.',
      implementation_summary: 'Bound writes to README.md and collect evidence.',
      split_strategy: 'Single package.',
      dependency_order: [],
      test_matrix: ['node -e "process.exit(0)"'],
      risk_mitigations: ['Run in persistent worktree, not source checkout.'],
      rollback_notes: 'Remove the marker from the worktree if needed.',
      author_actor_id: actor,
    },
  });
  await requestJson(apiUrl, `/plans/${encodeURIComponent(plan.id)}/submit-for-approval`, { method: 'POST', body: { actor_id: actor } });
  await requestJson(apiUrl, `/plans/${encodeURIComponent(plan.id)}/approve`, { method: 'POST', body: { actor_id: actor } });

  const packageShape = buildBoundedLocalCodexRunPackage({ repoPath, baseCommitSha });
  const executionPackage = await requestJson<{ id: string }>(
    apiUrl,
    `/plan-revisions/${encodeURIComponent(planRevision.id)}/execution-packages`,
    {
      method: 'POST',
      body: {
        repo_id: packageShape.repo?.repo_id,
        objective: packageShape.objective,
        owner_actor_id: actor,
        reviewer_actor_id: actor,
        qa_owner_actor_id: actor,
        required_checks: packageShape.required_checks,
        required_artifact_kinds: packageShape.artifact_policy?.requested_artifacts,
        allowed_paths: packageShape.allowed_paths,
        forbidden_paths: packageShape.forbidden_paths,
      },
    },
  );
  await requestJson(apiUrl, `/execution-packages/${encodeURIComponent(executionPackage.id)}/mark-ready`, {
    method: 'POST',
    body: { actor_id: actor },
  });

  return executionPackage.id;
};

const pollRunToTerminal = async (
  apiUrl: string,
  runSessionId: string,
): Promise<{ runSession: Record<string, unknown>; liveEvents: ObservedRunEvent[] }> => {
  const liveEvents: ObservedRunEvent[] = [];
  let after: string | undefined;
  const startedAt = Date.now();

  while (Date.now() - startedAt < 300_000) {
    const runSession = await requestJson<Record<string, unknown>>(apiUrl, `/run-sessions/${encodeURIComponent(runSessionId)}`);
    const runStatusAtObservation = typeof runSession.status === 'string' ? runSession.status : undefined;
    const response = await requestJson<{ events: ObservedRunEvent[] }>(
      apiUrl,
      `/run-sessions/${encodeURIComponent(runSessionId)}/events?actor_id=local-codex-dogfood-actor${
        after === undefined ? '' : `&after=${encodeURIComponent(after)}`
      }`,
    );
    const events = response.events;
    for (const event of events) {
      liveEvents.push({ ...event, runStatusAtObservation });
      if (typeof event.cursor === 'string') {
        after = event.cursor;
      }
    }

    if (isTerminalStatus(runSession.status)) {
      return { runSession, liveEvents };
    }

    await delay(1_000);
  }

  throw new Error('Timed out waiting for real local Codex run terminal status.');
};

const waitForReviewPacketReference = async (input: {
  apiUrl: string;
  runSession: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ id?: string; path: string }> => {
  const runSpec = input.runSession.run_spec as { work_item_id?: string } | undefined;
  const startedAt = Date.now();

  while (Date.now() - startedAt < (input.timeoutMs ?? 60_000)) {
    const artifactReference = resolveReviewPacketReference({ apiUrl: input.apiUrl, runSession: input.runSession });
    if (artifactReference !== undefined) {
      return artifactReference;
    }

    if (typeof runSpec?.work_item_id === 'string') {
      const cockpit = await requestJson<{ review_packets?: Array<{ id?: string }> }>(
        input.apiUrl,
        `/query/work-item-cockpit/${encodeURIComponent(runSpec.work_item_id)}`,
      );
      const cockpitReference = resolveReviewPacketReference({ apiUrl: input.apiUrl, runSession: input.runSession, cockpit });
      if (cockpitReference !== undefined) {
        return cockpitReference;
      }
    }

    await delay(500);
  }

  throw new Error('Timed out waiting for persisted Review Packet.');
};

export const runSourceGuardInjection = async (input: {
  repoPath: string;
  baseCommitSha: string;
  runCommand?: CommandRunner;
}): Promise<{ relativePath: string; cleanedUp: boolean; failureKind: string }> => {
  const {
    captureLocalCodexEvidence,
    createDefaultLocalCodexEnvironment,
    createLocalCodexCheckEnv,
    snapshotSourceRepoStatus,
    verifySourceRepoUnchanged,
  } = await import('../packages/executor/src/index.js');
  const runCommand = input.runCommand ?? defaultRunCommand;
  const commandRunner = (command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number } = {}) =>
    runCommand(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeout,
    });
  const environment = createDefaultLocalCodexEnvironment({ commandRunner });
  const runSessionId = `local-codex-dogfood-source-guard-${Date.now()}`;
  const workspacePath = join(resolve(input.repoPath), '.worktrees', runSessionId);
  const plan = buildSourceGuardInjectionPlan(input.repoPath);
  const before = await snapshotSourceRepoStatus(environment, input.repoPath);

  await mkdir(join(resolve(input.repoPath), '.worktrees'), { recursive: true });
  await runCommand('git', ['worktree', 'add', '--detach', workspacePath, input.baseCommitSha], {
    cwd: input.repoPath,
    timeoutMs: 60_000,
  });

  let failureKind = '';
  let cleanedUp = false;
  try {
    await plan.inject();
    const result = await captureLocalCodexEvidence({
      runSpec: {
        ...buildBoundedLocalCodexRunPackage({ repoPath: input.repoPath, baseCommitSha: input.baseCommitSha }),
        run_session_id: runSessionId,
        repo: {
          repo_id: 'forgeloop-source',
          local_path: input.repoPath,
          base_branch: 'HEAD',
          base_commit_sha: input.baseCommitSha,
        },
        required_checks: [],
        context: {
          spec_revision_summary: 'Opt-in real local Codex dogfood source guard.',
          plan_revision_summary: 'Verify source repo mutation detection around evidence capture.',
          package_instructions: 'No workspace mutation is required for the source guard injection check.',
          required_checks: [],
        },
        idempotency_key: runSessionId,
      } as RunSpec,
      workspacePath,
      baseRef: input.baseCommitSha,
      artifactRoot: join(workspacePath, '.forgeloop', 'source-guard-artifacts'),
      summary: 'Source guard injection evidence capture.',
      startedAt: nowIso(),
      environment,
      checkEnv: await createLocalCodexCheckEnv(environment, workspacePath),
      sourceRepoSnapshot: before,
      effectiveDangerousMode: 'not_requested',
    });
    if (result.status !== 'failed' || result.failure?.kind !== 'path_violation') {
      throw new Error('Source guard injection did not fail evidence capture with path_violation.');
    }

    failureKind = result.failure.kind;
  } finally {
    await plan.cleanup();
    cleanedUp = true;
    const afterCleanup = await verifySourceRepoUnchanged(environment, before);
    if (!afterCleanup.unchanged) {
      throw new Error('Source guard injection cleanup did not restore source checkout state.');
    }
    await runCommand('git', ['worktree', 'remove', '--force', workspacePath], {
      cwd: input.repoPath,
      timeoutMs: 60_000,
    }).catch(() => undefined);
    await rm(workspacePath, { recursive: true, force: true });
  }

  return { relativePath: plan.relativePath, cleanedUp, failureKind };
};

export const main = async (env: Env = process.env, runCommand: CommandRunner = defaultRunCommand): Promise<number> => {
  const enablement = evaluateLocalCodexDogfoodEnablement(env);
  if (!enablement.enabled) {
    console.log(enablement.message);
    return enablement.exitCode;
  }

  const repoPath = resolve(env.FORGELOOP_REPO_PATH ?? process.cwd());
  let report = '';
  let api: Awaited<ReturnType<typeof startApi>> | undefined;
  let preflightReport: PreflightResult | undefined;

  try {
    const preflight = await preflightLocalCodexDogfood({ env, repoPath, runCommand });
    preflightReport = preflight;
    if (!preflight.ok) {
      report = renderLocalCodexDogfoodReport({ status: 'FAIL', preflight, error: preflight.message });
      console.error(report);
      return 1;
    }

    const { stdout: baseStdout } = await runCommand('git', ['rev-parse', env.FORGELOOP_BASE_COMMIT_SHA ?? 'HEAD'], {
      cwd: repoPath,
      timeoutMs: 15_000,
    });
    const baseCommitSha = baseStdout.trim();
    const sourceGuardInjection = await runSourceGuardInjection({ repoPath, baseCommitSha, runCommand });
    api = await startApi();
    const executionPackageId = await createPackageThroughApi(api.apiUrl, repoPath, baseCommitSha);
    const run = await requestJson<{ run_session_id: string }>(api.apiUrl, `/execution-packages/${encodeURIComponent(executionPackageId)}/run`, {
      method: 'POST',
      body: {
        requested_by_actor_id: 'local-codex-dogfood-actor',
        executor_type: 'local_codex',
        workflow_only: false,
      },
      headers: { 'X-Forgeloop-Actor-Id': 'local-codex-dogfood-actor' },
    });
    const { runSession, liveEvents } = await pollRunToTerminal(api.apiUrl, run.run_session_id);
    const runtimeMetadataReport = runSessionRuntimeMetadataReport({
      executor_type: runSession.executor_type as string | undefined,
      runtime_metadata: runSession.runtime_metadata as Record<string, unknown> | undefined,
    });
    validateLocalCodexRuntimeMetadata(runtimeMetadataReport, { expectedRunSessionId: run.run_session_id });
    const runtimeMetadata = runtimeMetadataReport.runtime_metadata ?? {};
    if (runSession.status !== 'succeeded') {
      throw new Error(
        `Real local Codex run ended with status ${String(runSession.status)}: ${String(
          runSession.failure_reason ?? runSession.summary ?? 'no failure summary',
        )}`,
      );
    }
    const reviewPacket = await waitForReviewPacketReference({ apiUrl: api.apiUrl, runSession });
    const terminalEvidence = extractPersistedTerminalEvidence({ runSession, reviewPacket });

    recordLiveEventObservation(liveEvents);

    report = renderLocalCodexDogfoodReport({
      status: 'PASS',
      preflight,
      runtimeMetadata,
      terminalEvidence,
      liveEvents,
      sourceGuardInjection,
    });
    console.log(report);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report = renderLocalCodexDogfoodReport({ status: 'FAIL', preflight: preflightReport, error: message });
    console.error(report);
    return 1;
  } finally {
    await api?.close();
    if (env.FORGELOOP_LOCAL_CODEX_DOGFOOD_REPORT_PATH !== undefined && report.length > 0) {
      await mkdir(dirname(resolve(env.FORGELOOP_LOCAL_CODEX_DOGFOOD_REPORT_PATH)), { recursive: true });
      await writeFile(env.FORGELOOP_LOCAL_CODEX_DOGFOOD_REPORT_PATH, report, 'utf8');
    }
  }
};

if (isMainModule()) {
  process.exit(await main());
}
