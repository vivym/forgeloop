import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import type { RunSpec } from '@forgeloop/contracts';
import {
  buildSourceGuardInjectionPlan,
  defaultRunCommand,
  evaluateLocalCodexDogfoodEnablement,
  extractPersistedTerminalEvidence,
  isTerminalStatus,
  preflightLocalCodexDogfood,
  recordLiveEventObservation,
  resolveReviewPacketReference,
  runSessionRuntimeMetadataReport,
  sanitizeStrictBlockerDetails,
  validateLocalCodexRuntimeMetadata,
  type CommandRunner,
  type Env,
  type ObservedRunEvent,
  type PreflightResult,
  type TerminalEvidenceReport,
} from './dogfood/strict-local-codex';

export {
  buildCodexExecFallbackCommand,
  buildSourceGuardInjectionPlan,
  classifyStrictDirtySource,
  classifyStrictLocalCodexExit,
  classifyStrictLocalCodexReportStatus,
  commandExists,
  evaluateLocalCodexDogfoodEnablement,
  extractPersistedTerminalEvidence,
  parseDirtySourceFiles,
  preflightLocalCodexDogfood,
  recordLiveEventObservation,
  releaseStrictDirtyAllowlist,
  resolveReviewPacketReference,
  runSessionRuntimeMetadataReport,
  sanitizeStrictBlockerDetails,
  sanitizeStrictPreflightBlockerDetails,
  selectCodexExecutionMode,
  strictBlocker,
  STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST,
  STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE,
  validateLocalCodexRuntimeMetadata,
  validateTerminalEvidence,
} from './dogfood/strict-local-codex';
export type {
  CommandRunner,
  Env,
  ObservedRunEvent,
  PreflightResult,
  RuntimeMetadataReport,
  StrictDirtySourceSummary,
  StrictMarkerStatus,
  TerminalEvidenceReport,
} from './dogfood/strict-local-codex';

const isMainModule = (): boolean => process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

const nowIso = (): string => new Date().toISOString();

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

const safeReportRecord = (details: Record<string, unknown>): string => JSON.stringify(sanitizeStrictBlockerDetails(details));

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
    '# Delivery Real Local Codex Dogfood',
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
        lines.push(`  - Details: ${safeReportRecord(blocker.details)}`);
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
    lines.push(
      [
        '- Runtime metadata:',
        `app_server_attempted=${String(input.runtimeMetadata.app_server_attempted === true)}`,
        `selected_execution_mode=${String(input.runtimeMetadata.selected_execution_mode ?? 'unknown')}`,
        `effective_dangerous_mode=${String(input.runtimeMetadata.effective_dangerous_mode ?? 'unknown')}`,
      ].join(' '),
    );
  }

  if (input.liveEvents !== undefined) {
    lines.push(`- Live events observed: ${input.liveEvents.map((event) => event.event_type ?? 'unknown').join(', ')}`);
  }

  if (input.terminalEvidence !== undefined) {
    lines.push(`- Changed files: ${(input.terminalEvidence.changed_files ?? []).map((file) => file.path).join(', ')}`);
    lines.push(`- Checks: ${(input.terminalEvidence.check_results ?? []).map((check) => check.check_id).join(', ')}`);
    lines.push(`- Artifacts: ${(input.terminalEvidence.artifacts ?? []).map((artifact) => artifact.kind).join(', ')}`);
    lines.push(`- Review Packet: ${input.terminalEvidence.review_packet === undefined ? 'missing' : 'available'}`);
  }

  if (input.sourceGuardInjection !== undefined) {
    lines.push(
      `- Source guard injection: ${input.sourceGuardInjection.relativePath} cleanup=${String(input.sourceGuardInjection.cleanedUp)}${
        input.sourceGuardInjection.failureKind === undefined ? '' : ` failure=${input.sourceGuardInjection.failureKind}`
      }`,
    );
  }

  if (input.error !== undefined) {
    lines.push(`- Error: ${safeReportRecord({ error: input.error })}`);
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

const actorHeaders = (actorId: string): Record<string, string> => ({
  'X-Forgeloop-Actor-Id': actorId,
  'X-Forgeloop-Actor-Class': 'human_admin',
});

export const startApi = async (): Promise<{ apiUrl: string; close: () => Promise<void> }> => {
  const [{ Test }, { AppModule }, { RunWorkerLifecycleService }] = await Promise.all([
    import('@nestjs/testing'),
    import('../apps/control-plane-api/src/app.module.js'),
    import('../apps/control-plane-api/src/modules/run-control/run-worker-lifecycle.service.js'),
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
      kind: 'tech_debt',
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
  await requestJson(apiUrl, `/specs/${encodeURIComponent(spec.id)}/submit-for-approval`, {
    method: 'POST',
    headers: actorHeaders(actor),
    body: { actor_id: actor },
  });
  await requestJson(apiUrl, `/specs/${encodeURIComponent(spec.id)}/approve`, {
    method: 'POST',
    headers: actorHeaders(actor),
    body: { actor_id: actor },
  });

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
  await requestJson(apiUrl, `/plans/${encodeURIComponent(plan.id)}/submit-for-approval`, {
    method: 'POST',
    headers: actorHeaders(actor),
    body: { actor_id: actor },
  });
  await requestJson(apiUrl, `/plans/${encodeURIComponent(plan.id)}/approve`, {
    method: 'POST',
    headers: actorHeaders(actor),
    body: { actor_id: actor },
  });

  const packageShape = buildBoundedLocalCodexRunPackage({ repoPath, baseCommitSha });
  const executionPackage = await requestJson<{ id: string; version: number }>(
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
    headers: actorHeaders(actor),
    body: { actor_id: actor, expected_package_version: executionPackage.version },
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
      `/run-sessions/${encodeURIComponent(runSessionId)}/events${after === undefined ? '' : `?after=${encodeURIComponent(after)}`}`,
      { headers: { 'X-Forgeloop-Actor-Id': 'local-codex-dogfood-actor' } },
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
