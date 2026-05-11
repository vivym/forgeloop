import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { ArtifactRef, ChangedFile, CheckResult } from '@forgeloop/contracts';
import {
  sourceDirtyEntriesFromPorcelain,
  worktreePathForRun,
  type StrictPreflightBlocker,
  type StrictPreflightResult,
} from '../../packages/executor/src/index.js';
export type { StrictPreflightBlocker, StrictPreflightResult } from '../../packages/executor/src/index.js';

export type Env = Record<string, string | undefined>;

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Env; timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

export type StrictDirtySourceSummary<
  TSource extends string = typeof STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE,
> = {
  allowed_dirty_entries: string[];
  blocked_dirty_entries: string[];
  dirty_allowlist_source: TSource;
};

export type PreflightResult<TSource extends string = typeof STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE> =
  | (StrictPreflightResult & {
      ok: true;
      repoPath: string;
      dirtyFiles: string[];
      dirtySource: StrictDirtySourceSummary<TSource>;
      dirtyOverride?: { allowed: true; dirtyFiles: string[] };
      worktreeProbePath: string;
    })
  | (StrictPreflightResult & {
      ok: false;
      message: string;
      repoPath: string;
      dirtyFiles?: string[];
      dirtySource?: StrictDirtySourceSummary<TSource>;
      unexpectedDirtyFiles?: string[];
      worktreeProbePath?: string;
    });

export type RuntimeMetadataReport = {
  executor_type?: string;
  runtime_metadata?: Record<string, unknown>;
};

export type TerminalEvidenceReport = {
  changed_files?: Array<Partial<ChangedFile>>;
  check_results?: Array<Partial<CheckResult>>;
  artifacts?: Array<Partial<ArtifactRef>>;
  review_packet?: { id?: string; artifact_path?: string };
};

export type ObservedRunEvent = {
  event_type?: string;
  visibility?: string;
  status?: string;
  cursor?: string;
  runStatusAtObservation?: string;
  payload?: Record<string, unknown>;
};

type PreflightLocalCodexDogfoodInput<
  TSource extends string = typeof STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE,
> = {
  env: Env;
  repoPath: string;
  runCommand?: CommandRunner;
  dirtyAllowlist?: readonly string[];
  dirtyAllowlistSource?: TSource;
};

export const STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE = 'STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST';
export const STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST = [
  'docs/superpowers/reports/p0-dogfood-work-items-completion.md',
  '.superpowers/**',
] as const;
export const releaseStrictDirtyAllowlist = [
  'docs/superpowers/reports/p1-release-risk-radar-verification.md',
  '.superpowers/**',
] as const;

export type StrictMarkerStatus = 'PASSED' | 'BLOCKED with reason' | 'FAILED';

const execFile = promisify(execFileCallback);
const terminalStatuses = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
const DANGEROUS_MODE_CONFIRMATION_ENV = 'FORGELOOP_LOCAL_CODEX_DOGFOOD_CONFIRM_DANGEROUS_MODE';
const codexLiveProgressEventTypes = new Set([
  'thread_started',
  'thread_resumed',
  'turn_started',
  'agent_message_delta',
  'agent_message_completed',
  'command_output_delta',
  'driver_fallback_used',
]);

export const isCodexLiveProgressEventType = (eventType: unknown): eventType is string =>
  typeof eventType === 'string' && codexLiveProgressEventTypes.has(eventType);

export const isPublicCodexLiveProgressEvent = (
  event: Pick<ObservedRunEvent, 'event_type' | 'visibility' | 'runStatusAtObservation'>,
): boolean =>
  event.visibility === 'public' &&
  isCodexLiveProgressEventType(event.event_type) &&
  (event.runStatusAtObservation === undefined || !isTerminalStatus(event.runStatusAtObservation));

export const defaultRunCommand: CommandRunner = async (command, args, options = {}) => {
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

const nowIso = (): string => new Date().toISOString();

export const isTerminalStatus = (status: unknown): boolean => typeof status === 'string' && terminalStatuses.has(status);

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

const matchesStrictDirtyAllowlist = (path: string, allowlist: readonly string[]): boolean => {
  if (path !== path.trim()) {
    return false;
  }

  return allowlist.some((pattern) => {
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -'/**'.length);

      return path === prefix || path.startsWith(`${prefix}/`);
    }

    return path === pattern;
  });
};

export const classifyStrictDirtySource = <
  TSource extends string = typeof STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE,
>(
  dirtyFiles: string[],
  allowlist: readonly string[] = STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST,
  allowlistSource: TSource = STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE as TSource,
): StrictDirtySourceSummary<TSource> => {
  const allowed_dirty_entries = dirtyFiles.filter((path) => matchesStrictDirtyAllowlist(path, allowlist));
  const allowed = new Set(allowed_dirty_entries);
  const blocked_dirty_entries = dirtyFiles.filter((path) => !allowed.has(path));

  return {
    allowed_dirty_entries,
    blocked_dirty_entries,
    dirty_allowlist_source: allowlistSource,
  };
};

export const commandExists = async (runCommand: CommandRunner, command: string, cwd: string): Promise<boolean> => {
  try {
    await runCommand(command, ['--version'], { cwd, timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
};

export const strictBlocker = (
  code: StrictPreflightBlocker['code'],
  message: string,
  details?: Record<string, unknown>,
): StrictPreflightBlocker => ({
  code,
  message,
  ...(details === undefined ? {} : { details }),
});

const strictFailure = <TSource extends string>(input: {
  repoPath: string;
  blockers: StrictPreflightBlocker[];
  dirtyFiles?: string[];
  dirtySource?: StrictDirtySourceSummary<TSource>;
  unexpectedDirtyFiles?: string[];
  worktreeProbePath?: string;
}): PreflightResult<TSource> => ({
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

export function preflightLocalCodexDogfood<TSource extends string>(
  input: PreflightLocalCodexDogfoodInput<TSource> & { dirtyAllowlistSource: TSource },
): Promise<PreflightResult<TSource>>;
export function preflightLocalCodexDogfood(input: PreflightLocalCodexDogfoodInput): Promise<PreflightResult>;
export async function preflightLocalCodexDogfood<
  TSource extends string = typeof STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE,
>(input: PreflightLocalCodexDogfoodInput<TSource>): Promise<PreflightResult<TSource>> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const repoPath = resolve(input.repoPath);
  const blockers: StrictPreflightBlocker[] = [];
  let codexCommandAvailable = true;
  let dirtyFiles: string[] | undefined;
  let dirtySource: StrictDirtySourceSummary<TSource> | undefined;
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

  dirtySource = classifyStrictDirtySource(
    dirtyFiles,
    input.dirtyAllowlist ?? STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST,
    input.dirtyAllowlistSource ?? (STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE as TSource),
  );
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
}

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
    .filter((event) => typeof event.runStatusAtObservation === 'string' && isPublicCodexLiveProgressEvent(event))
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

export const classifyStrictLocalCodexReportStatus = (code: string): StrictMarkerStatus => {
  if (
    code === 'local_codex_terminal_failed' ||
    code === 'local_codex_run_terminal_timeout' ||
    code === 'missing_terminal_evidence' ||
    code === 'missing_public_non_terminal_live_event' ||
    code === 'public_projection_leak'
  ) {
    return 'FAILED';
  }
  return 'BLOCKED with reason';
};

export const classifyStrictLocalCodexExit = (input: {
  markers: StrictMarkerStatus[];
  allowBlocked: boolean;
}): 0 | 1 => {
  if (input.markers.includes('FAILED')) {
    return 1;
  }
  if (input.markers.every((marker) => marker === 'PASSED')) {
    return 0;
  }
  return input.allowBlocked ? 0 : 1;
};

const repoRelativeOrBasename = (value: string): string => {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized)) {
    return normalized;
  }
  const marker = '/forgeloop/';
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) {
    return normalized.slice(index + marker.length);
  }
  return normalized.split('/').filter(Boolean).at(-1) ?? '[redacted]';
};

const unsafeReportDetailKeyPattern = /path|url|secret|metadata|stderr|token|password|api[\s_-]?key|authorization/i;
const unsafeReportDetailValuePattern =
  /(?:[a-z][a-z0-9+.-]*:\/\/)|(?:postgres(?:ql)?:\/\/)|(?:^|[\s"'(=])\/Users\/|(?:^|[\s"'(=])\/(?:tmp|var|private|home|repo|workspace|workspaces|opt|mnt)\b|(?:^|\/)\.worktrees(?:\/|$)|(?:^|\/)artifacts\/|review-packet|(?:authorization|api[\s_-]?key|token|password|secret)\s*[:=]|\bbearer\s+\S+|\b(?:sk|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_=-]+|stderr\s*:/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type SanitizedDetailValue = {
  value?: unknown;
  redactedDetailCount: number;
};

const sanitizeStrictDetailValue = (value: unknown, options: { dirtyEntry?: boolean } = {}): SanitizedDetailValue => {
  if (typeof value === 'string') {
    const sanitizedValue = options.dirtyEntry ? repoRelativeOrBasename(value) : value;
    if (!options.dirtyEntry && unsafeReportDetailValuePattern.test(sanitizedValue)) {
      return { redactedDetailCount: 1 };
    }
    if (options.dirtyEntry && sanitizedValue === '[redacted]') {
      return { value: sanitizedValue, redactedDetailCount: 1 };
    }

    return { value: sanitizedValue, redactedDetailCount: 0 };
  }

  if (Array.isArray(value)) {
    const sanitizedItems: unknown[] = [];
    let redactedDetailCount = 0;
    for (const entry of value) {
      const sanitizedEntry = sanitizeStrictDetailValue(entry, options);
      redactedDetailCount += sanitizedEntry.redactedDetailCount;
      if ('value' in sanitizedEntry) {
        sanitizedItems.push(sanitizedEntry.value);
      }
    }

    return {
      value: sanitizedItems,
      redactedDetailCount,
    };
  }

  if (isRecord(value)) {
    const sanitizedRecord = sanitizeStrictDetailRecord(value);
    return { value: sanitizedRecord, redactedDetailCount: 0 };
  }

  if (options.dirtyEntry) {
    return { value: '[redacted]', redactedDetailCount: 1 };
  }

  return { value, redactedDetailCount: 0 };
};

const sanitizeStrictDetailRecord = (details: Record<string, unknown>): Record<string, unknown> => {
  const sanitized: Record<string, unknown> = {};
  let redactedDetailCount = 0;

  for (const [key, value] of Object.entries(details)) {
    if (unsafeReportDetailKeyPattern.test(key)) {
      redactedDetailCount += 1;
      continue;
    }
    if (Array.isArray(value) && /dirty_entries/i.test(key)) {
      const sanitizedDirtyEntries = sanitizeStrictDetailValue(value, { dirtyEntry: true });
      redactedDetailCount += sanitizedDirtyEntries.redactedDetailCount;
      sanitized[key] = sanitizedDirtyEntries.value ?? [];
      continue;
    }

    const sanitizedValue = sanitizeStrictDetailValue(value);
    redactedDetailCount += sanitizedValue.redactedDetailCount;
    if ('value' in sanitizedValue) {
      sanitized[key] = sanitizedValue.value;
    }
  }

  if (redactedDetailCount > 0) {
    sanitized.redacted_detail_count = redactedDetailCount;
  }
  return sanitized;
};

export const sanitizeStrictBlockerDetails = (details: Record<string, unknown>): Record<string, unknown> =>
  sanitizeStrictDetailRecord(details);

export const sanitizeStrictPreflightBlockerDetails = (preflight: {
  blockers: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
}): string[] =>
  preflight.blockers.map((blocker) => {
    const details = blocker.details === undefined ? undefined : sanitizeStrictBlockerDetails(blocker.details);
    return `${blocker.code}: ${blocker.message}${details === undefined ? '' : ` ${JSON.stringify(details)}`}`;
  });
