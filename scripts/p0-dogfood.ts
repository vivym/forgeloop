import { writeFile, mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExecutorResult, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';

import { AppModule } from '../apps/control-plane-api/src/app.module';
import {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  RUN_DURABILITY_MODE,
  RUN_WORKER,
} from '../apps/control-plane-api/src/p0/p0.service';
import { InMemoryP0Repository, type P0Repository } from '../packages/db/src';
import type { CodexSessionDriver } from '../packages/executor/src';
import { FakeCodexSessionDriver, type FakeCodexScriptItem, RunWorker } from '../packages/run-worker/src';

type JsonObject = Record<string, unknown>;

type PublicRunEvent = {
  cursor: string;
  event_type: string;
  summary: string;
  payload: JsonObject;
};

type DogfoodResult = {
  label: string;
  packageId: string;
  runSessionId: string;
  reviewPacketId: string;
  status: 'passed' | 'failed';
  notes: string[];
};

const reportPath = resolve(process.env.FORGELOOP_REPORT_PATH ?? 'docs/superpowers/reports/p0-delivery-loop-verification.md');
const repoPath = resolve(process.env.FORGELOOP_REPO_PATH ?? process.cwd());
const repoId = process.env.FORGELOOP_REPO_ID ?? 'forgeloop';
const actorOwner = process.env.FORGELOOP_ACTOR_OWNER ?? 'actor-owner';
const actorReviewer = process.env.FORGELOOP_ACTOR_REVIEWER ?? 'actor-reviewer';
const actorQa = process.env.FORGELOOP_ACTOR_QA ?? 'actor-qa';

const commandLog = ['pnpm test', 'pnpm build', 'pnpm smoke:p0', 'pnpm dogfood:p0'];
const terminalRunStatuses = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);

const noopRunWorker = {
  kick: () => undefined,
  drainOnce: async () => undefined,
} as RunWorker;

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

const stringField = (value: JsonObject, field: string): string => {
  const raw = value[field];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`Expected ${field} in API response`);
  }
  return raw;
};

const arrayField = (value: JsonObject, field: string): unknown[] => {
  const raw = value[field];
  if (!Array.isArray(raw)) {
    throw new Error(`Expected ${field} array in API response`);
  }
  return raw;
};

const makeClock = (start: string): (() => string) => {
  let current = Date.parse(start);
  return () => {
    const value = new Date(current).toISOString();
    current += 10;
    return value;
  };
};

const requestJson = async (
  apiUrl: string,
  path: string,
  options: { method?: string; body?: JsonObject } = {},
): Promise<JsonObject> => {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const payload = text.length === 0 ? {} : JSON.parse(text);

  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed with ${response.status}: ${text}`);
  }
  if (!isObject(payload)) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned a non-object response`);
  }

  return payload;
};

const eventQuery = (after?: string): string => {
  const params = new URLSearchParams({ actor_id: actorOwner });
  if (after !== undefined) {
    params.set('after', after);
  }
  return params.toString();
};

const listRunEvents = async (apiUrl: string, runSessionId: string, after?: string): Promise<PublicRunEvent[]> => {
  const response = await requestJson(apiUrl, `/run-sessions/${encodeURIComponent(runSessionId)}/events?${eventQuery(after)}`);
  return arrayField(response, 'events') as PublicRunEvent[];
};

const waitForEvent = async (
  apiUrl: string,
  runSessionId: string,
  predicate: (event: PublicRunEvent) => boolean,
  options: { after?: string; label: string; timeoutMs?: number },
): Promise<PublicRunEvent> => {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const seen = new Set<string>();

  for (;;) {
    const events = await listRunEvents(apiUrl, runSessionId, options.after);
    for (const event of events) {
      if (!seen.has(event.cursor)) {
        seen.add(event.cursor);
        console.log(`[events] ${runSessionId} ${event.cursor} ${event.event_type}: ${event.summary}`);
      }
      if (predicate(event)) {
        return event;
      }
    }

    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${options.label} on ${runSessionId}`);
    }
    await delay(25);
  }
};

const waitForRunStatus = async (
  apiUrl: string,
  runSessionId: string,
  predicate: (status: string) => boolean,
  label: string,
): Promise<JsonObject> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const runSession = await requestJson(apiUrl, `/run-sessions/${encodeURIComponent(runSessionId)}`);
    const status = stringField(runSession, 'status');
    if (predicate(status)) {
      return runSession;
    }
    await delay(25);
  }

  const latest = await requestJson(apiUrl, `/run-sessions/${encodeURIComponent(runSessionId)}`);
  const events = await listRunEvents(apiUrl, runSessionId);
  const lastEvent = events.at(-1);
  throw new Error(
    `Timed out waiting for ${label} on ${runSessionId}; latest status=${String(latest.status)} summary=${String(
      latest.summary,
    )}; last_event=${lastEvent === undefined ? 'none' : `${lastEvent.event_type} ${JSON.stringify(lastEvent.payload)}`}`,
  );
};

const createApiApp = async (repository: P0Repository): Promise<{ app: INestApplication; apiUrl: string }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(P0_REPOSITORY)
    .useValue(repository)
    .overrideProvider(RUN_DURABILITY_MODE)
    .useValue('volatile_demo')
    .overrideProvider(P0_DEMO_ACTOR_ID_FALLBACK)
    .useValue(true)
    .overrideProvider(RUN_WORKER)
    .useValue(noopRunWorker)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  const apiUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[dogfood] API started in-process at ${apiUrl}`);
  return { app, apiUrl };
};

const dogfoodEvidence = async (input: Parameters<ConstructorParameters<typeof RunWorker>[0]['evidenceCollector']>[0]): Promise<ExecutorResult> => ({
  run_session_id: input.runSpec.run_session_id,
  executor_type: input.runSpec.executor_type,
  executor_version: 'dogfood-fake-driver',
  status: 'succeeded',
  started_at: input.startedAt,
  finished_at: new Date(Date.parse(input.startedAt) + 1_000).toISOString(),
  summary: input.summary,
  changed_files: [
    {
      repo_id: input.runSpec.repo.repo_id,
      path: 'docs/superpowers/reports/p0-dogfood-generated.md',
      change_kind: 'modified',
    },
  ],
  checks: input.runSpec.required_checks.map((check) => ({
    check_id: check.check_id,
    command: check.command,
    status: 'succeeded',
    exit_code: 0,
    duration_seconds: 0,
    blocks_review: check.blocks_review,
  })),
  artifacts: [...new Set(input.runSpec.artifact_policy.requested_artifacts)].map((kind) => ({
    kind,
    name: `${kind}.txt`,
    content_type: 'text/plain',
    local_ref: `${input.artifactRoot}/${input.runSpec.run_session_id}/${kind}.txt`,
  })),
  raw_metadata: { dogfood: true, workspace_path: `${repoPath}/.worktrees/${input.runSpec.run_session_id}` },
});

const dogfoodSelfReview = async (input: SelfReviewInput): Promise<SelfReviewResult> => ({
  status: 'succeeded',
  summary: `Dogfood self-review completed for ${input.run_session_id}.`,
  spec_plan_alignment: 'The dogfood run used the approved spec and plan revision ids.',
  test_assessment: `${input.check_results.length} required checks were reported.`,
  risk_notes: [],
  follow_up_questions: [],
});

const createWorker = (repository: P0Repository, driver: CodexSessionDriver, workerId: string, now = makeClock('2026-05-08T00:00:00.000Z')) =>
  new RunWorker({
    repository,
    workerId,
    driverFactory: () => driver,
    execFallbackDriverFactory: () => driver,
    evidenceCollector: dogfoodEvidence,
    selfReview: dogfoodSelfReview,
    now,
    heartbeatIntervalMs: 20,
    commandPollIntervalMs: 10,
    leaseDurationMs: 60_000,
    idleThresholdMs: 30_000,
    artifactRoot: '.forgeloop/dogfood-artifacts',
  });

const driverStarted = (summary: string): FakeCodexScriptItem => ({
  kind: 'event',
  event: {
    event_type: 'driver_started',
    source: 'codex',
    visibility: 'public',
    summary,
    payload: {},
  },
  runtimeMetadata: {
    driver_kind: 'fake',
    driver_status: 'active',
    codex_thread_id: 'dogfood-thread',
    active_turn_id: 'dogfood-turn',
    effective_dangerous_mode: 'not_requested',
  },
});

const waitingForInput = (): FakeCodexScriptItem => ({
  kind: 'event',
  event: {
    event_type: 'waiting_for_input',
    source: 'codex',
    visibility: 'public',
    summary: 'Fake driver is waiting for operator input.',
    payload: { prompt: 'Choose the dogfood continuation path.' },
  },
  runtimeMetadata: {
    driver_status: 'waiting_for_input',
    active_turn_id: 'dogfood-turn',
  },
});

const terminalSucceeded = (summary: string): FakeCodexScriptItem => ({
  kind: 'terminal',
  status: 'succeeded',
  summary,
  runtimeMetadata: { driver_status: 'terminal' },
});

const createProjectAndRepo = async (apiUrl: string): Promise<string> => {
  const project = await requestJson(apiUrl, '/projects', {
    method: 'POST',
    body: { name: 'Forgeloop P0 dogfood', owner_actor_id: actorOwner },
  });
  const projectId = stringField(project, 'id');
  await requestJson(apiUrl, `/projects/${encodeURIComponent(projectId)}/repos`, {
    method: 'POST',
    body: {
      repo_id: repoId,
      name: repoId,
      local_path: repoPath,
      default_branch: 'main',
      base_commit_sha: 'dogfood-base',
    },
  });
  return projectId;
};

const createApprovedPlan = async (apiUrl: string, projectId: string, label: string): Promise<string> => {
  const workItem = await requestJson(apiUrl, '/work-items', {
    method: 'POST',
    body: {
      project_id: projectId,
      kind: 'test_refactor',
      title: `Dogfood ${label}`,
      goal: 'Verify the long-running run console control flow.',
      success_criteria: ['Live events are visible before terminal completion.', 'Review evidence is persisted.'],
      priority: 'P0',
      risk: 'medium',
      owner_actor_id: actorOwner,
    },
  });
  const workItemId = stringField(workItem, 'id');

  const spec = await requestJson(apiUrl, `/work-items/${encodeURIComponent(workItemId)}/specs`, { method: 'POST', body: {} });
  const specId = stringField(spec, 'id');
  await requestJson(apiUrl, `/specs/${encodeURIComponent(specId)}/generate-draft`, { method: 'POST', body: {} });
  await requestJson(apiUrl, `/specs/${encodeURIComponent(specId)}/submit-for-approval`, { method: 'POST', body: { actor_id: actorOwner } });
  await requestJson(apiUrl, `/specs/${encodeURIComponent(specId)}/approve`, { method: 'POST', body: { actor_id: actorReviewer } });

  const plan = await requestJson(apiUrl, `/work-items/${encodeURIComponent(workItemId)}/plans`, { method: 'POST', body: {} });
  const planId = stringField(plan, 'id');
  const planRevision = await requestJson(apiUrl, `/plans/${encodeURIComponent(planId)}/generate-draft`, { method: 'POST', body: {} });
  await requestJson(apiUrl, `/plans/${encodeURIComponent(planId)}/submit-for-approval`, { method: 'POST', body: { actor_id: actorOwner } });
  await requestJson(apiUrl, `/plans/${encodeURIComponent(planId)}/approve`, { method: 'POST', body: { actor_id: actorReviewer } });
  return stringField(planRevision, 'id');
};

const createReadyPackage = async (apiUrl: string, planRevisionId: string, label: string): Promise<string> => {
  const executionPackage = await requestJson(apiUrl, `/plan-revisions/${encodeURIComponent(planRevisionId)}/execution-packages`, {
    method: 'POST',
    body: {
      repo_id: repoId,
      objective: `Dogfood ${label}: exercise async run events, input, restart recovery, and final review evidence.`,
      owner_actor_id: actorOwner,
      reviewer_actor_id: actorReviewer,
      qa_owner_actor_id: actorQa,
      required_checks: [
        {
          check_id: 'dogfood-required',
          display_name: 'Dogfood required check',
          command: 'pnpm dogfood:p0',
          timeout_seconds: 600,
          blocks_review: true,
        },
      ],
      required_artifact_kinds: ['diff', 'changed_files', 'check_output', 'execution_summary'],
      allowed_paths: ['docs/superpowers/reports/**'],
      forbidden_paths: ['.git/**', 'node_modules/**'],
    },
  });
  const packageId = stringField(executionPackage, 'id');
  await requestJson(apiUrl, `/execution-packages/${encodeURIComponent(packageId)}/mark-ready`, {
    method: 'POST',
    body: { actor_id: actorOwner },
  });
  return packageId;
};

const runPackage = async (apiUrl: string, packageId: string): Promise<string> => {
  const run = await requestJson(apiUrl, `/execution-packages/${encodeURIComponent(packageId)}/run`, {
    method: 'POST',
    body: {
      requested_by_actor_id: actorOwner,
      workflow_only: true,
      executor_type: 'mock',
    },
  });
  if (run.status !== 'accepted') {
    throw new Error(`Run command did not return accepted: ${JSON.stringify(run)}`);
  }
  if ('workflow_result' in run) {
    throw new Error('Run command returned obsolete workflow_result payload');
  }
  const runSessionId = stringField(run, 'run_session_id');
  console.log(`[dogfood] run_session_id=${runSessionId}`);
  return runSessionId;
};

const approveReviewPacket = async (apiUrl: string, reviewPacketId: string): Promise<void> => {
  await requestJson(apiUrl, `/review-packets/${encodeURIComponent(reviewPacketId)}/approve`, {
    method: 'POST',
    body: {
      summary: 'Dogfood review approved.',
      reviewed_by_actor_id: actorReviewer,
      reviewed_at: new Date().toISOString(),
    },
  });
};

const reviewPacketIdForRun = async (repository: P0Repository, runSessionId: string): Promise<string> => {
  const runSession = await repository.getRunSession(runSessionId);
  if (runSession === undefined) {
    throw new Error(`Missing RunSession ${runSessionId}`);
  }
  const packet = (await repository.listReviewPacketsForPackage(runSession.execution_package_id)).find(
    (item) => item.run_session_id === runSessionId,
  );
  if (packet === undefined) {
    throw new Error(`Missing ReviewPacket for ${runSessionId}`);
  }
  return packet.id;
};

const assertFinalEvidence = async (apiUrl: string, repository: P0Repository, runSessionId: string): Promise<string> => {
  const runSession = await waitForRunStatus(apiUrl, runSessionId, (status) => status === 'succeeded', 'terminal success');
  const changedFiles = arrayField(runSession, 'changed_files');
  const checks = arrayField(runSession, 'check_results');
  const artifacts = arrayField(runSession, 'artifacts');
  if (changedFiles.length === 0) {
    throw new Error(`RunSession ${runSessionId} has no changed files`);
  }
  if (!checks.some((check) => isObject(check) && check.check_id === 'dogfood-required' && check.status === 'succeeded')) {
    throw new Error(`RunSession ${runSessionId} is missing succeeded dogfood-required check`);
  }
  if (!artifacts.some((artifact) => isObject(artifact) && artifact.kind === 'diff')) {
    throw new Error(`RunSession ${runSessionId} is missing diff artifact`);
  }

  const reviewPacketId = await reviewPacketIdForRun(repository, runSessionId);
  const reviewPacket = await requestJson(apiUrl, `/review-packets/${encodeURIComponent(reviewPacketId)}`);
  if (reviewPacket.status !== 'ready') {
    throw new Error(`ReviewPacket ${reviewPacketId} was not ready`);
  }
  await approveReviewPacket(apiUrl, reviewPacketId);
  return reviewPacketId;
};

const dogfoodLiveInputRun = async (apiUrl: string, repository: P0Repository, projectId: string): Promise<DogfoodResult> => {
  const notes: string[] = [];
  const planRevisionId = await createApprovedPlan(apiUrl, projectId, 'live input');
  const packageId = await createReadyPackage(apiUrl, planRevisionId, 'live input');
  const runSessionId = await runPackage(apiUrl, packageId);
  const queued = await waitForEvent(apiUrl, runSessionId, (event) => event.event_type === 'run_queued', {
    label: 'run_queued before terminal status',
  });

  const driver = new FakeCodexSessionDriver({
    script: [driverStarted('Fake driver started.'), waitingForInput(), { kind: 'delay', ms: 200 }, terminalSucceeded('Fake driver completed.')],
    inputAcks: [{ continuity: { thread_id: 'dogfood-thread', turn_id: 'dogfood-turn-after-input' } }],
  });
  const worker = createWorker(repository, driver, 'dogfood-worker-live', makeClock('2026-05-08T01:00:00.000Z'));
  const workerRun = worker.drainOnce();

  const waiting = await waitForEvent(apiUrl, runSessionId, (event) => event.event_type === 'waiting_for_input', {
    after: queued.cursor,
    label: 'waiting_for_input',
  });
  const preTerminal = await requestJson(apiUrl, `/run-sessions/${encodeURIComponent(runSessionId)}`);
  if (terminalRunStatuses.has(stringField(preTerminal, 'status'))) {
    notes.push('Run reached terminal status before waiting_for_input was observed.');
  }

  const command = await requestJson(apiUrl, `/run-sessions/${encodeURIComponent(runSessionId)}/input`, {
    method: 'POST',
    body: { actor_id: actorOwner, message: 'Continue with the fake dogfood path.' },
  });
  const commandId = stringField(command, 'command_id');
  if (command.status !== 'accepted') {
    notes.push('Input command was not accepted.');
  }

  await waitForEvent(
    apiUrl,
    runSessionId,
    (event) => event.event_type === 'user_input' && event.payload.command_id === commandId && event.summary === 'User input submitted.',
    { after: waiting.cursor, label: 'submitted user_input event' },
  );
  await waitForEvent(
    apiUrl,
    runSessionId,
    (event) => event.event_type === 'user_input' && event.payload.command_id === commandId && event.summary === 'User input delivered.',
    { after: waiting.cursor, label: 'delivered user_input event' },
  );

  await workerRun;
  if (driver.inputs.length !== 1 || driver.inputs[0]?.message !== 'Continue with the fake dogfood path.') {
    notes.push('Fake driver did not receive the submitted input exactly once.');
  }

  const reviewPacketId = await assertFinalEvidence(apiUrl, repository, runSessionId);
  return { label: 'live-input-fake-driver', packageId, runSessionId, reviewPacketId, status: notes.length === 0 ? 'passed' : 'failed', notes };
};

const dogfoodRestartRun = async (
  app: INestApplication,
  apiUrl: string,
  repository: P0Repository,
  projectId: string,
): Promise<{ app: INestApplication; apiUrl: string; result: DogfoodResult }> => {
  const notes: string[] = [];
  const planRevisionId = await createApprovedPlan(apiUrl, projectId, 'restart recovery');
  const packageId = await createReadyPackage(apiUrl, planRevisionId, 'restart recovery');
  const runSessionId = await runPackage(apiUrl, packageId);
  const queued = await waitForEvent(apiUrl, runSessionId, (event) => event.event_type === 'run_queued', {
    label: 'restart run_queued',
  });

  const command = await requestJson(apiUrl, `/run-sessions/${encodeURIComponent(runSessionId)}/input`, {
    method: 'POST',
    body: { actor_id: actorOwner, message: 'Already-applied input should not be replayed.' },
  });
  const commandId = stringField(command, 'command_id');
  const oldLease = { workerId: 'dogfood-worker-old', leaseToken: 'dogfood-old-lease' };
  await repository.claimRunWorkerLease({
    run_session_id: runSessionId,
    worker_id: oldLease.workerId,
    lease_token: oldLease.leaseToken,
    now: '2026-05-08T02:00:00.000Z',
    expires_at: '2026-05-08T02:00:05.000Z',
  });
  const claimed = await repository.claimNextRunCommand(runSessionId, oldLease.workerId, oldLease.leaseToken, '2026-05-08T02:00:01.000Z');
  if (claimed?.command.id !== commandId) {
    throw new Error(`Expected to claim ${commandId} before restart`);
  }
  const driverAck = { continuity: { thread_id: 'dogfood-thread', turn_id: 'already-applied-turn' } };
  await repository.recordRunCommandDriverAck(commandId, oldLease, driverAck, '2026-05-08T02:00:02.000Z');
  await repository.markRunCommandApplied(commandId, oldLease, '2026-05-08T02:00:03.000Z', driverAck);

  await app.close();
  const restarted = await createApiApp(repository);
  const afterRestartEvents = await listRunEvents(restarted.apiUrl, runSessionId, queued.cursor);
  console.log(`[dogfood] backfilled ${afterRestartEvents.length} events after API rebuild`);
  if (!afterRestartEvents.some((event) => event.event_type === 'user_input' && event.payload.command_id === commandId)) {
    notes.push('Restarted API did not backfill submitted input event by cursor.');
  }

  const restartDriver = new FakeCodexSessionDriver({
    script: [driverStarted('Restart worker reclaimed run.'), terminalSucceeded('Restart worker completed.')],
    inputAcks: [{ continuity: { thread_id: 'dogfood-thread', turn_id: 'duplicate-input-turn' } }],
  });
  const restartWorker = createWorker(repository, restartDriver, 'dogfood-worker-restart', makeClock('2026-05-08T02:01:00.000Z'));
  await restartWorker.drainOnce();

  const lease = await repository.getRunWorkerLease(runSessionId);
  if (lease?.worker_id !== 'dogfood-worker-restart' || lease.status !== 'released') {
    notes.push('Restart worker did not reclaim and release the run lease.');
  }
  if (restartDriver.inputs.length !== 0) {
    notes.push('Restart worker duplicated already-applied input.');
  }
  const restartBackfill = await listRunEvents(restarted.apiUrl, runSessionId, queued.cursor);
  if (!restartBackfill.some((event) => event.event_type === 'driver_started')) {
    notes.push('Restarted API did not backfill worker events after recovery.');
  }

  const reviewPacketId = await assertFinalEvidence(restarted.apiUrl, repository, runSessionId);
  return {
    app: restarted.app,
    apiUrl: restarted.apiUrl,
    result: {
      label: 'restart-backfill-lease-takeover',
      packageId,
      runSessionId,
      reviewPacketId,
      status: notes.length === 0 ? 'passed' : 'failed',
      notes,
    },
  };
};

const renderReport = (data: { status: 'PASS' | 'FAIL'; apiUrl?: string; results: DogfoodResult[]; error?: string }): string => {
  const resultLines =
    data.results.length === 0
      ? ['- No dogfood runs completed.']
      : data.results.map((result) =>
          [
            `- ${result.label}: ${result.status.toUpperCase()}`,
            `  - Package: ${result.packageId}`,
            `  - RunSession: ${result.runSessionId}`,
            `  - ReviewPacket: ${result.reviewPacketId}`,
            ...(result.notes.length === 0 ? ['  - Evidence checks passed.'] : result.notes.map((note) => `  - ${note}`)),
          ].join('\n'),
        );

  return [
    '# P0 Delivery Loop Verification',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Dogfood status: ${data.status}`,
    '',
    '## Commands',
    '',
    ...commandLog.map((command) => `- \`${command}\``),
    '',
    '## Expected Outcomes',
    '',
    '- `pnpm test`: all Vitest suites pass.',
    '- `pnpm build`: all workspace packages and apps compile.',
    '- `pnpm smoke:p0`: P0 smoke suite passes and observes public run events before waiting for terminal evidence.',
    '- `pnpm dogfood:p0`: exits 0 only when fake-driver live events, input delivery, event backfill, lease takeover, final evidence, and Review Packet approval pass.',
    '',
    '## Dogfood Preconditions',
    '',
    `- API URL: ${data.apiUrl ?? 'not started'}`,
    `- Repo path: ${repoPath}`,
    `- Repo id: ${repoId}`,
    '- Dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.',
    '- Real local_codex acceptance is separate from this deterministic dogfood pass and requires a local Codex runtime.',
    '',
    '## Dogfood Results',
    '',
    ...resultLines,
    '',
    '## Actual Results',
    '',
    data.error === undefined ? `- Last dogfood run finished with status ${data.status}.` : `- ${data.error}`,
    '',
  ].join('\n');
};

const writeReport = async (content: string): Promise<void> => {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, content);
};

const main = async (): Promise<number> => {
  const repository = new InMemoryP0Repository();
  let app: INestApplication | undefined;
  let apiUrl: string | undefined;
  const results: DogfoodResult[] = [];

  try {
    const started = await createApiApp(repository);
    app = started.app;
    apiUrl = started.apiUrl;
    const projectId = await createProjectAndRepo(apiUrl);

    results.push(await dogfoodLiveInputRun(apiUrl, repository, projectId));
    const restarted = await dogfoodRestartRun(app, apiUrl, repository, projectId);
    app = restarted.app;
    apiUrl = restarted.apiUrl;
    results.push(restarted.result);

    const failed = results.filter((result) => result.status === 'failed');
    const status = failed.length === 0 ? 'PASS' : 'FAIL';
    await writeReport(renderReport({ status, apiUrl, results }));
    return failed.length === 0 ? 0 : 1;
  } catch (error) {
    await writeReport(
      renderReport({
        status: 'FAIL',
        apiUrl,
        results,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return 1;
  } finally {
    await app?.close();
  }
};

process.exitCode = await main();
