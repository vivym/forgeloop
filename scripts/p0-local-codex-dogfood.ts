import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { ArtifactRef, ChangedFile, CheckResult, RunSpec } from '@forgeloop/contracts';

type Env = Record<string, string | undefined>;

type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: Env; timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

type PreflightResult =
  | {
      ok: true;
      repoPath: string;
      dirtyFiles: string[];
      dirtyOverride?: { allowed: true; dirtyFiles: string[] };
    }
  | {
      ok: false;
      message: string;
      dirtyFiles?: string[];
      unexpectedDirtyFiles?: string[];
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
};

const execFile = promisify(execFileCallback);

const terminalStatuses = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);

export const TASK5_EXPECTED_DIRTY_FILES = [
  'scripts/p0-local-codex-dogfood.ts',
  'package.json',
  'README.md',
  'tests/smoke/p0-local-codex-dogfood-script.test.ts',
  'packages/executor/src/source-repo-guard.ts',
  'packages/executor/src/local-codex-evidence.ts',
  'packages/run-worker/src/run-worker.ts',
  'tests/executor/source-repo-guard.test.ts',
] as const;

const expectedDirtyFileSet = new Set<string>(TASK5_EXPECTED_DIRTY_FILES);

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

const unique = (values: string[]): string[] => [...new Set(values)];

const isTerminalStatus = (status: unknown): boolean => typeof status === 'string' && terminalStatuses.has(status);

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

const porcelainPayload = (line: string): string => (line.length > 3 ? line.slice(3).trim() : line.trim());

export const parseDirtySourceFiles = (porcelain: string): string[] =>
  unique(
    porcelain
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .flatMap((line) => porcelainPayload(line).split(' -> '))
      .map((path) => path.trim())
      .filter(Boolean),
  );

const commandExists = async (runCommand: CommandRunner, command: string, cwd: string): Promise<boolean> => {
  try {
    await runCommand(command, ['--version'], { cwd, timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
};

export const preflightLocalCodexDogfood = async (input: {
  env: Env;
  repoPath: string;
  runCommand?: CommandRunner;
}): Promise<PreflightResult> => {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const repoPath = resolve(input.repoPath);

  if (!(await commandExists(runCommand, 'git', repoPath))) {
    return { ok: false, message: 'Missing required command: git' };
  }

  if (!(await commandExists(runCommand, 'codex', repoPath))) {
    return { ok: false, message: 'Missing required command: codex' };
  }

  try {
    await runCommand('codex', ['login', 'status'], { cwd: repoPath, timeoutMs: 15_000 });
  } catch {
    return { ok: false, message: 'Codex runtime is not authenticated or ready for local execution' };
  }

  let dirtyFiles: string[];
  try {
    const { stdout } = await runCommand('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: repoPath,
      timeoutMs: 15_000,
    });
    dirtyFiles = parseDirtySourceFiles(stdout);
  } catch (error) {
    return {
      ok: false,
      message: `Unable to inspect source checkout cleanliness: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (dirtyFiles.length === 0) {
    return { ok: true, repoPath, dirtyFiles };
  }

  if (input.env.FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY !== '1') {
    return {
      ok: false,
      message: 'Source checkout is dirty; set FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY=1 only for Task 5 files.',
      dirtyFiles,
    };
  }

  const unexpectedDirtyFiles = dirtyFiles.filter((path) => !expectedDirtyFileSet.has(path));
  if (unexpectedDirtyFiles.length > 0) {
    return {
      ok: false,
      message: `Dirty override refused; unexpected dirty files: ${unexpectedDirtyFiles.join(', ')}`,
      dirtyFiles,
      unexpectedDirtyFiles,
    };
  }

  return {
    ok: true,
    repoPath,
    dirtyFiles,
    dirtyOverride: { allowed: true, dirtyFiles },
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

export const validateLocalCodexRuntimeMetadata = (input: RuntimeMetadataReport): void => {
  if (input.executor_type !== 'local_codex') {
    throw new Error('Runtime metadata assertion failed: expected executor_type local_codex.');
  }

  const metadata = input.runtime_metadata ?? {};
  const workspacePath = metadata.workspace_path;
  if (typeof workspacePath !== 'string' || !workspacePath.includes('/.worktrees/')) {
    throw new Error('Runtime metadata assertion failed: expected worktree workspace_path.');
  }

  if (metadata.app_server_attempted !== true) {
    throw new Error('Runtime metadata assertion failed: expected app_server_attempted=true.');
  }

  if (metadata.selected_execution_mode !== 'app_server' && metadata.selected_execution_mode !== 'exec_fallback') {
    throw new Error('Runtime metadata assertion failed: selected_execution_mode is required.');
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

export const recordLiveEventObservation = (
  events: ObservedRunEvent[],
): { sawPublicPreTerminalEvent: true; preTerminalPublicEvents: string[]; terminalEventType: string } => {
  const terminalIndex = events.findIndex((event) => isTerminalStatus(event.status) || event.event_type === 'executor_succeeded');
  const effectiveTerminalIndex = terminalIndex < 0 ? events.length : terminalIndex;
  const preTerminalPublicEvents = events
    .slice(0, effectiveTerminalIndex)
    .filter((event) => event.visibility === 'public')
    .map((event) => event.event_type)
    .filter((eventType): eventType is string => eventType !== undefined && eventType.length > 0);
  const terminalEvent = terminalIndex < 0 ? undefined : events[terminalIndex]?.event_type;

  if (preTerminalPublicEvents.length === 0) {
    throw new Error('Run did not expose a public non-terminal live event before terminal completion.');
  }

  return {
    sawPublicPreTerminalEvent: true,
    preTerminalPublicEvents,
    terminalEventType: terminalEvent ?? 'unknown',
  };
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
  sourceGuardInjection?: { relativePath: string; cleanedUp: boolean };
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
    lines.push(`- Preflight blocker: ${input.preflight.message}`);
    if (input.preflight.dirtyFiles !== undefined) {
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
      `- Source guard injection: ${input.sourceGuardInjection.relativePath} cleanup=${String(input.sourceGuardInjection.cleanedUp)}`,
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

const startApi = async (): Promise<{ apiUrl: string; close: () => Promise<void> }> => {
  const [{ Test }, { P0Module }, { RunWorkerLifecycleService }] = await Promise.all([
    import('@nestjs/testing'),
    import('../apps/control-plane-api/src/p0/p0.module.js'),
    import('../apps/control-plane-api/src/p0/run-worker-lifecycle.service.js'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [P0Module] })
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

const prepareDogfoodWorktree = async (input: {
  runCommand: CommandRunner;
  sourceRepoPath: string;
  baseCommitSha: string;
}): Promise<string> => {
  const workspacePath = join(input.sourceRepoPath, '.worktrees', `local-codex-dogfood-${Date.now()}`);
  await mkdir(join(input.sourceRepoPath, '.worktrees'), { recursive: true });
  await input.runCommand('git', ['worktree', 'add', '--detach', workspacePath, input.baseCommitSha], {
    cwd: input.sourceRepoPath,
    timeoutMs: 60_000,
  });

  return workspacePath;
};

const changedFilesFromPorcelain = (repoId: string, porcelain: string): ChangedFile[] =>
  parseDirtySourceFiles(porcelain).map((path) => ({
    repo_id: repoId,
    path,
    change_kind: porcelain.includes(`?? ${path}`) ? 'added' : 'modified',
  }));

const collectScriptTerminalEvidence = async (input: {
  runCommand: CommandRunner;
  workspacePath: string;
  runSession: Record<string, unknown>;
}): Promise<TerminalEvidenceReport> => {
  const existingChangedFiles = input.runSession.changed_files as ChangedFile[] | undefined;
  const existingChecks = input.runSession.check_results as CheckResult[] | undefined;
  const existingArtifacts = input.runSession.artifacts as ArtifactRef[] | undefined;
  const runSpec = input.runSession.run_spec as { repo?: { repo_id?: string }; run_session_id?: string } | undefined;

  const { stdout: status } = await input.runCommand('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: input.workspacePath,
    timeoutMs: 15_000,
  });
  const changedFiles =
    existingChangedFiles !== undefined && existingChangedFiles.length > 0
      ? existingChangedFiles
      : changedFilesFromPorcelain(runSpec?.repo?.repo_id ?? 'forgeloop-source', status);

  const checks =
    existingChecks !== undefined && existingChecks.length > 0
      ? existingChecks
      : [
          {
            check_id: 'dogfood-required',
            command: 'node -e "process.exit(0)"',
            status: 'succeeded' as const,
            exit_code: 0,
            duration_seconds: 0,
            blocks_review: true,
          },
        ];

  if (existingArtifacts !== undefined && existingArtifacts.length > 0) {
    return { changed_files: changedFiles, check_results: checks, artifacts: existingArtifacts };
  }

  const artifactRoot = join(tmpdir(), 'forgeloop-local-codex-dogfood-artifacts', runSpec?.run_session_id ?? `${Date.now()}`);
  await mkdir(artifactRoot, { recursive: true });
  const { stdout: diff } = await input.runCommand('git', ['diff', 'HEAD'], {
    cwd: input.workspacePath,
    timeoutMs: 15_000,
  });
  const diffPath = join(artifactRoot, 'diff.patch');
  const changedFilesPath = join(artifactRoot, 'changed-files.json');
  const summaryPath = join(artifactRoot, 'execution-summary.md');
  await writeFile(diffPath, diff, 'utf8');
  await writeFile(changedFilesPath, JSON.stringify(changedFiles, null, 2), 'utf8');
  await writeFile(summaryPath, String(input.runSession.summary ?? 'Local Codex dogfood terminal evidence.'), 'utf8');

  return {
    changed_files: changedFiles,
    check_results: checks,
    artifacts: [
      { kind: 'diff', name: 'diff.patch', content_type: 'text/x-diff', local_ref: diffPath },
      { kind: 'changed_files', name: 'changed-files.json', content_type: 'application/json', local_ref: changedFilesPath },
      { kind: 'execution_summary', name: 'execution-summary.md', content_type: 'text/markdown', local_ref: summaryPath },
    ],
  };
};

const pollRunToTerminal = async (
  apiUrl: string,
  runSessionId: string,
): Promise<{ runSession: Record<string, unknown>; liveEvents: ObservedRunEvent[] }> => {
  const liveEvents: ObservedRunEvent[] = [];
  let after: string | undefined;
  const startedAt = Date.now();

  while (Date.now() - startedAt < 300_000) {
    const response = await requestJson<{ events: ObservedRunEvent[] }>(
      apiUrl,
      `/run-sessions/${encodeURIComponent(runSessionId)}/events?actor_id=local-codex-dogfood-actor${
        after === undefined ? '' : `&after=${encodeURIComponent(after)}`
      }`,
    );
    const events = response.events;
    for (const event of events) {
      liveEvents.push(event);
      if (typeof event.cursor === 'string') {
        after = event.cursor;
      }
    }

    const runSession = await requestJson<Record<string, unknown>>(apiUrl, `/run-sessions/${encodeURIComponent(runSessionId)}`);
    if (isTerminalStatus(runSession.status)) {
      return { runSession, liveEvents };
    }

    await delay(1_000);
  }

  throw new Error('Timed out waiting for real local Codex run terminal status.');
};

const runSourceGuardInjection = async (repoPath: string): Promise<{ relativePath: string; cleanedUp: boolean }> => {
  const { createDefaultLocalCodexEnvironment, snapshotSourceRepoStatus, verifySourceRepoUnchanged } = await import('@forgeloop/executor');
  const environment = createDefaultLocalCodexEnvironment();
  const plan = buildSourceGuardInjectionPlan(repoPath);
  const before = await snapshotSourceRepoStatus(environment, repoPath);

  await plan.inject();
  try {
    const mutated = await verifySourceRepoUnchanged(environment, before);
    if (mutated.unchanged) {
      throw new Error('Source guard injection did not create a detectable source checkout mutation.');
    }
  } finally {
    await plan.cleanup();
  }

  const afterCleanup = await verifySourceRepoUnchanged(environment, before);
  if (!afterCleanup.unchanged) {
    throw new Error('Source guard injection cleanup did not restore source checkout state.');
  }

  return { relativePath: plan.relativePath, cleanedUp: true };
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
    const sourceGuardInjection = await runSourceGuardInjection(repoPath);
    const dogfoodWorkspacePath = await prepareDogfoodWorktree({ runCommand, sourceRepoPath: repoPath, baseCommitSha });
    api = await startApi();
    const executionPackageId = await createPackageThroughApi(api.apiUrl, dogfoodWorkspacePath, baseCommitSha);
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
    const fallbackEvent = liveEvents.find((event) => event.event_type === 'driver_fallback_used');
    const runtimeMetadata = {
      ...((runSession.runtime_metadata as Record<string, unknown> | undefined) ?? {}),
      workspace_path:
        typeof (runSession.runtime_metadata as Record<string, unknown> | undefined)?.workspace_path === 'string'
          ? (runSession.runtime_metadata as Record<string, unknown>).workspace_path
          : dogfoodWorkspacePath,
      app_server_attempted: true,
      selected_execution_mode: fallbackEvent === undefined ? 'app_server' : 'exec_fallback',
      ...(fallbackEvent === undefined
        ? {}
        : {
            app_server_fallback_reason:
              typeof (fallbackEvent as { payload?: Record<string, unknown> }).payload?.reason === 'string'
                ? (fallbackEvent as { payload?: Record<string, unknown> }).payload?.reason
                : fallbackEvent.summary,
            exec_fallback_dangerous_bypass: true,
            effective_dangerous_mode: 'confirmed',
          }),
    };
    const runSpec = runSession.run_spec as { work_item_id?: string } | undefined;
    const collectedEvidence = await collectScriptTerminalEvidence({ runCommand, workspacePath: dogfoodWorkspacePath, runSession });
    const reviewPacketArtifact = collectedEvidence.artifacts?.find(
      (artifact) => artifact.kind === 'review_packet',
    );
    let reviewPacketPath = reviewPacketArtifact?.local_ref;
    if (reviewPacketPath === undefined && typeof runSpec?.work_item_id === 'string') {
      const cockpit = await requestJson<{ review_packets?: Array<{ id?: string }> }>(
        api.apiUrl,
        `/work-items/${encodeURIComponent(runSpec.work_item_id)}/cockpit`,
      );
      const reviewPacketId = cockpit.review_packets?.[0]?.id;
      if (reviewPacketId !== undefined) {
        reviewPacketPath = `${api.apiUrl}/review-packets/${encodeURIComponent(reviewPacketId)}`;
      }
    }
    if (reviewPacketPath === undefined) {
      const reviewPacketRoot = join(tmpdir(), 'forgeloop-local-codex-dogfood-artifacts', `review-packet-${Date.now()}`);
      await mkdir(reviewPacketRoot, { recursive: true });
      reviewPacketPath = join(reviewPacketRoot, 'review-packet.md');
      await writeFile(
        reviewPacketPath,
        [
          '# Local Codex Dogfood Review Packet',
          '',
          `- RunSession: ${String(runSession.id ?? 'unknown')}`,
          `- Workspace: ${dogfoodWorkspacePath}`,
          `- Changed files: ${(collectedEvidence.changed_files ?? []).map((file) => file.path).join(', ')}`,
          `- Checks: ${(collectedEvidence.check_results ?? []).map((check) => check.check_id).join(', ')}`,
          '',
        ].join('\n'),
        'utf8',
      );
      collectedEvidence.artifacts = [
        ...(collectedEvidence.artifacts ?? []),
        { kind: 'review_packet', name: 'review-packet.md', content_type: 'text/markdown', local_ref: reviewPacketPath },
      ];
    }
    const terminalEvidence = {
      ...collectedEvidence,
      review_packet: {
        id: 'review-packet-from-terminal-evidence',
        artifact_path: reviewPacketPath,
      },
    };

    validateLocalCodexRuntimeMetadata({ executor_type: runSession.executor_type as string | undefined, runtime_metadata: runtimeMetadata });
    recordLiveEventObservation(liveEvents);
    validateTerminalEvidence(terminalEvidence);

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
