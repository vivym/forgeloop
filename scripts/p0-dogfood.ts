import { execFile as execFileCallback } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExecutorResult, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import type {
  ExecutionPackage,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  RunCommand,
  RunSession,
  Spec,
  SpecRevision,
  WorkItem,
} from '../packages/domain/src';
import { transitionExecutionPackage, transitionRunSession } from '../packages/domain/src';

import { AppModule } from '../apps/control-plane-api/src/app.module';
import {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  RUN_DURABILITY_MODE,
  RUN_WORKER,
} from '../apps/control-plane-api/src/p0/p0.service';
import { createDbClient, createDrizzleP0Repository, InMemoryP0Repository, type DbClient, type P0Repository } from '../packages/db/src';
import type { CodexSessionDriver } from '../packages/executor/src';
import { FakeCodexSessionDriver, type FakeCodexScriptItem, RunWorker } from '../packages/run-worker/src';

const execFile = promisify(execFileCallback);

type JsonObject = Record<string, unknown>;

export type DogfoodDurabilityMode = 'volatile_demo' | 'durable';

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

type CheckStatus = 'passed' | 'failed' | 'skipped';

export type VerificationCheck = {
  label: string;
  status: CheckStatus;
  details: string[];
};

export type PublicApiAuthEvidence = {
  durablePublicApiHeaderAuth: boolean;
  durableSseStreamTokenAuth: boolean;
  volatileActorFallback: boolean;
};

type DogfoodRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: JsonObject;
};

type DogfoodRequest = {
  path: string;
  init: DogfoodRequestInit;
};

const actorHeaderName = 'X-Forgeloop-Actor-Id';

const reportPath = resolve(process.env.FORGELOOP_REPORT_PATH ?? 'docs/superpowers/reports/p0-delivery-loop-verification.md');
const repoPath = resolve(process.env.FORGELOOP_REPO_PATH ?? process.cwd());
const repoId = process.env.FORGELOOP_REPO_ID ?? 'forgeloop';
const actorOwner = process.env.FORGELOOP_ACTOR_OWNER ?? 'actor-owner';
const actorReviewer = process.env.FORGELOOP_ACTOR_REVIEWER ?? 'actor-reviewer';
const actorQa = process.env.FORGELOOP_ACTOR_QA ?? 'actor-qa';
const databaseUrl = process.env.FORGELOOP_DATABASE_URL?.trim();
const webUrlCandidates = (process.env.FORGELOOP_WEB_URL ?? 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter((value) => value.length > 0);

const commandLog = ['pnpm test', 'pnpm build', 'pnpm smoke:p0', 'pnpm dogfood:p0'];
const terminalRunStatuses = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);

const noopRunWorker = {
  kick: () => undefined,
  drainOnce: async () => undefined,
} as RunWorker;

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

const durableModeFromEnv = (): DogfoodDurabilityMode => (databaseUrl === undefined || databaseUrl.length === 0 ? 'volatile_demo' : 'durable');

const actorHeaders = (mode: DogfoodDurabilityMode, actorId: string): Record<string, string> =>
  mode === 'durable' ? { [actorHeaderName]: actorId } : {};

const maybeJsonHeaders = (body: JsonObject | undefined, headers: Record<string, string>): Record<string, string> =>
  body === undefined ? headers : { 'content-type': 'application/json', ...headers };

const runEventsPath = (
  runSessionId: string,
  options: { mode: DogfoodDurabilityMode; actorId: string; after?: string; streamToken?: string },
): string => {
  const params = new URLSearchParams();
  if (options.mode === 'volatile_demo') {
    params.set('actor_id', options.actorId);
  }
  if (options.streamToken !== undefined) {
    params.set('stream_token', options.streamToken);
  }
  if (options.after !== undefined) {
    params.set('after', options.after);
  }
  const query = params.toString();
  return `/run-sessions/${encodeURIComponent(runSessionId)}/events${query.length === 0 ? '' : `?${query}`}`;
};

export const buildRunEventListRequest = (
  runSessionId: string,
  options: { mode: DogfoodDurabilityMode; actorId: string; after?: string },
): DogfoodRequest => ({
  path: runEventsPath(runSessionId, options),
  init: { headers: actorHeaders(options.mode, options.actorId) },
});

export const buildRunPackageRequest = (
  packageId: string,
  options: { mode: DogfoodDurabilityMode; actorId: string },
): DogfoodRequest => {
  const body = { requested_by_actor_id: options.actorId, workflow_only: true, executor_type: 'mock' };
  return {
    path: `/execution-packages/${encodeURIComponent(packageId)}/run`,
    init: {
      method: 'POST',
      headers: actorHeaders(options.mode, options.actorId),
      body,
    },
  };
};

export const buildRunInputRequest = (
  runSessionId: string,
  options: { mode: DogfoodDurabilityMode; actorId: string; message: string },
): DogfoodRequest => {
  const body = options.mode === 'durable' ? { message: options.message } : { actor_id: options.actorId, message: options.message };
  return {
    path: `/run-sessions/${encodeURIComponent(runSessionId)}/input`,
    init: {
      method: 'POST',
      headers: actorHeaders(options.mode, options.actorId),
      body,
    },
  };
};

export const buildRunControlRequest = (
  runSessionId: string,
  command: 'cancel' | 'resume',
  options: { mode: DogfoodDurabilityMode; actorId: string; reason: string },
): DogfoodRequest => {
  const body = options.mode === 'durable' ? { reason: options.reason } : { actor_id: options.actorId, reason: options.reason };
  return {
    path: `/run-sessions/${encodeURIComponent(runSessionId)}/${command}`,
    init: {
      method: 'POST',
      headers: actorHeaders(options.mode, options.actorId),
      body,
    },
  };
};

export const buildRunEventStreamTokenRequest = (
  runSessionId: string,
  options: { mode: DogfoodDurabilityMode; actorId: string },
): DogfoodRequest => {
  const body = options.mode === 'durable' ? undefined : { actor_id: options.actorId };
  return {
    path: `/run-sessions/${encodeURIComponent(runSessionId)}/events/stream-token`,
    init: {
      method: 'POST',
      headers: actorHeaders(options.mode, options.actorId),
      ...(body === undefined ? {} : { body }),
    },
  };
};

export const buildRunEventStreamRequest = (
  apiUrl: string,
  runSessionId: string,
  options: { mode: DogfoodDurabilityMode; actorId: string; after?: string; streamToken?: string },
): { url: string; headers: Record<string, string> } => {
  const path =
    options.mode === 'durable'
      ? runEventsPath(runSessionId, { ...options, streamToken: options.streamToken })
      : runEventsPath(runSessionId, options);
  return {
    url: `${apiUrl}${path.replace('/events', '/events/stream')}`,
    headers: actorHeaders(options.mode, options.actorId),
  };
};

export const publicApiAuthChecks = (mode: DogfoodDurabilityMode, evidence: PublicApiAuthEvidence): VerificationCheck[] => {
  if (mode === 'durable') {
    return [
      {
        label: 'Durable public API actor header auth',
        status: evidence.durablePublicApiHeaderAuth ? 'passed' : 'failed',
        details: [
          evidence.durablePublicApiHeaderAuth
            ? 'Run, event backfill, input, cancel, and resume public APIs were exercised with X-Forgeloop-Actor-Id.'
            : 'Durable public API actor-header flow was not exercised.',
        ],
      },
      {
        label: 'Durable SSE stream-token auth',
        status: evidence.durableSseStreamTokenAuth ? 'passed' : 'failed',
        details: [
          evidence.durableSseStreamTokenAuth
            ? 'SSE first requested a stream token with X-Forgeloop-Actor-Id and opened the stream with stream_token.'
            : 'Durable SSE stream-token flow was not exercised.',
        ],
      },
    ];
  }

  return [
    {
      label: 'Volatile public API actor fallback',
      status: evidence.volatileActorFallback ? 'passed' : 'failed',
      details: [
        evidence.volatileActorFallback
          ? 'Volatile demo public APIs were exercised with legacy body/query actor fallback.'
          : 'Volatile demo actor fallback was not exercised.',
      ],
    },
  ];
};

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
  options: { method?: string; body?: JsonObject; headers?: Record<string, string> } = {},
): Promise<JsonObject> => {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: maybeJsonHeaders(options.body, options.headers ?? {}),
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

const requestBuiltJson = (apiUrl: string, request: DogfoodRequest): Promise<JsonObject> =>
  requestJson(apiUrl, request.path, {
    method: request.init.method,
    body: request.init.body,
    headers: request.init.headers,
  });

export const requestRunEventStreamToken = async (
  apiUrl: string,
  runSessionId: string,
  options: { mode: DogfoodDurabilityMode; actorId: string; fetchImpl?: typeof fetch },
): Promise<string> => {
  const request = buildRunEventStreamTokenRequest(runSessionId, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${apiUrl}${request.path}`, {
    method: request.init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(request.init.headers ?? {}) },
    body: request.init.body === undefined ? undefined : JSON.stringify(request.init.body),
  });
  const text = await response.text();
  const payload = text.length === 0 ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`POST ${request.path} failed with ${response.status}: ${text}`);
  }
  if (!isObject(payload) || typeof payload.token !== 'string' || payload.token.trim().length === 0) {
    throw new Error('Malformed run event stream token response');
  }
  return payload.token;
};

const runCommand = async (
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> => {
  const { stdout, stderr } = await execFile(command, args, {
    cwd: repoPath,
    env: { ...process.env, ...options.env },
    timeout: options.timeoutMs ?? 30_000,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
};

const listRunEvents = async (
  apiUrl: string,
  runSessionId: string,
  after: string | undefined,
  mode: DogfoodDurabilityMode,
  evidence?: PublicApiAuthEvidence,
): Promise<PublicRunEvent[]> => {
  const request = buildRunEventListRequest(runSessionId, { mode, actorId: actorOwner, ...(after === undefined ? {} : { after }) });
  if (mode === 'durable') {
    evidence && (evidence.durablePublicApiHeaderAuth = true);
  } else {
    evidence && (evidence.volatileActorFallback = true);
  }
  const response = await requestBuiltJson(apiUrl, request);
  return arrayField(response, 'events') as PublicRunEvent[];
};

const parseSseData = (buffer: string): { events: PublicRunEvent[]; remaining: string } => {
  const events: PublicRunEvent[] = [];
  const chunks = buffer.split(/\n\n/);
  const remaining = chunks.pop() ?? '';

  for (const chunk of chunks) {
    const dataLines = chunk
      .split(/\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());
    if (dataLines.length === 0) {
      continue;
    }
    const parsed = JSON.parse(dataLines.join('\n'));
    if (isObject(parsed)) {
      events.push(parsed as PublicRunEvent);
    }
  }

  return { events, remaining };
};

const waitForSseEvent = async (
  apiUrl: string,
  runSessionId: string,
  predicate: (event: PublicRunEvent) => boolean,
  options: { after?: string; label: string; timeoutMs?: number; mode: DogfoodDurabilityMode; evidence?: PublicApiAuthEvidence },
): Promise<PublicRunEvent> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  let buffer = '';

  try {
    const streamToken =
      options.mode === 'durable'
        ? await requestRunEventStreamToken(apiUrl, runSessionId, { mode: options.mode, actorId: actorOwner })
        : undefined;
    const streamRequest = buildRunEventStreamRequest(apiUrl, runSessionId, {
      mode: options.mode,
      actorId: actorOwner,
      ...(options.after === undefined ? {} : { after: options.after }),
      ...(streamToken === undefined ? {} : { streamToken }),
    });
    if (options.mode === 'durable') {
      options.evidence && (options.evidence.durableSseStreamTokenAuth = true);
    } else {
      options.evidence && (options.evidence.volatileActorFallback = true);
    }

    const response = await fetch(streamRequest.url, {
      headers: { accept: 'text/event-stream', ...streamRequest.headers },
      signal: controller.signal,
    });
    if (!response.ok || response.body === null) {
      throw new Error(`SSE ${options.label} failed with ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const read = await reader.read();
      if (read.done) {
        throw new Error(`SSE stream ended before ${options.label}`);
      }
      buffer += decoder.decode(read.value, { stream: true });
      const parsed = parseSseData(buffer);
      buffer = parsed.remaining;
      for (const event of parsed.events) {
        console.log(`[sse] ${runSessionId} ${event.cursor} ${event.event_type}: ${event.summary}`);
        if (predicate(event)) {
          await reader.cancel();
          return event;
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Timed out waiting for SSE ${options.label} on ${runSessionId}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
};

const waitForEvent = async (
  apiUrl: string,
  runSessionId: string,
  predicate: (event: PublicRunEvent) => boolean,
  options: { after?: string; label: string; timeoutMs?: number; mode: DogfoodDurabilityMode; evidence?: PublicApiAuthEvidence },
): Promise<PublicRunEvent> => {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const seen = new Set<string>();

  for (;;) {
    const events = await listRunEvents(apiUrl, runSessionId, options.after, options.mode, options.evidence);
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
  mode: DogfoodDurabilityMode,
  evidence?: PublicApiAuthEvidence,
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
  const events = await listRunEvents(apiUrl, runSessionId, undefined, mode, evidence);
  const lastEvent = events.at(-1);
  throw new Error(
    `Timed out waiting for ${label} on ${runSessionId}; latest status=${String(latest.status)} summary=${String(
      latest.summary,
    )}; last_event=${lastEvent === undefined ? 'none' : `${lastEvent.event_type} ${JSON.stringify(lastEvent.payload)}`}`,
  );
};

const createApiApp = async (
  repository: P0Repository,
  options: { durabilityMode?: DogfoodDurabilityMode } = {},
): Promise<{ app: INestApplication; apiUrl: string }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(P0_REPOSITORY)
    .useValue(repository)
    .overrideProvider(RUN_DURABILITY_MODE)
    .useValue(options.durabilityMode ?? 'volatile_demo')
    .overrideProvider(P0_DEMO_ACTOR_ID_FALLBACK)
    .useValue((options.durabilityMode ?? 'volatile_demo') === 'volatile_demo')
    .overrideProvider(RUN_WORKER)
    .useValue(noopRunWorker)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  const apiUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[dogfood] API started in-process at ${apiUrl} (${options.durabilityMode ?? 'volatile_demo'})`);
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

const runPackage = async (
  apiUrl: string,
  packageId: string,
  mode: DogfoodDurabilityMode,
  evidence?: PublicApiAuthEvidence,
): Promise<string> => {
  const run = await requestBuiltJson(apiUrl, buildRunPackageRequest(packageId, { mode, actorId: actorOwner }));
  if (mode === 'durable') {
    evidence && (evidence.durablePublicApiHeaderAuth = true);
  } else {
    evidence && (evidence.volatileActorFallback = true);
  }
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

const runControlCommand = async (
  apiUrl: string,
  runSessionId: string,
  command: 'cancel' | 'resume',
  reason: string,
  mode: DogfoodDurabilityMode,
  evidence?: PublicApiAuthEvidence,
): Promise<string> => {
  const response = await requestBuiltJson(apiUrl, buildRunControlRequest(runSessionId, command, { mode, actorId: actorOwner, reason }));
  if (mode === 'durable') {
    evidence && (evidence.durablePublicApiHeaderAuth = true);
  } else {
    evidence && (evidence.volatileActorFallback = true);
  }
  if (response.status !== 'accepted' || response.command_type !== command) {
    throw new Error(`${command} command was not accepted: ${JSON.stringify(response)}`);
  }
  return stringField(response, 'command_id');
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

const assertFinalEvidence = async (
  apiUrl: string,
  repository: P0Repository,
  runSessionId: string,
  mode: DogfoodDurabilityMode,
  evidence?: PublicApiAuthEvidence,
): Promise<string> => {
  const runSession = await waitForRunStatus(apiUrl, runSessionId, (status) => status === 'succeeded', 'terminal success', mode, evidence);
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

const assertRepositoryFinalEvidence = async (repository: P0Repository, runSessionId: string): Promise<void> => {
  const runSession = await repository.getRunSession(runSessionId);
  if (runSession === undefined) {
    throw new Error(`Missing durable RunSession ${runSessionId}`);
  }
  if (runSession.status !== 'succeeded') {
    throw new Error(`Durable RunSession ${runSessionId} status is ${runSession.status}`);
  }
  if (runSession.changed_files.length === 0) {
    throw new Error(`Durable RunSession ${runSessionId} has no changed files`);
  }
  if (!runSession.check_results.some((check) => check.check_id === 'dogfood-required' && check.status === 'succeeded')) {
    throw new Error(`Durable RunSession ${runSessionId} is missing succeeded dogfood-required check`);
  }
  if (!runSession.artifacts.some((artifact) => artifact.kind === 'diff')) {
    throw new Error(`Durable RunSession ${runSessionId} is missing diff artifact`);
  }

  const reviewPacketId = await reviewPacketIdForRun(repository, runSessionId);
  const reviewPacket = await repository.getReviewPacket(reviewPacketId);
  if (reviewPacket?.status !== 'ready' || reviewPacket.decision !== 'none') {
    throw new Error(`Durable ReviewPacket ${reviewPacketId} was not ready for review`);
  }
};

const dogfoodLiveInputRun = async (
  apiUrl: string,
  repository: P0Repository,
  projectId: string,
  mode: DogfoodDurabilityMode,
  evidence: PublicApiAuthEvidence,
): Promise<DogfoodResult> => {
  const notes: string[] = [];
  const planRevisionId = await createApprovedPlan(apiUrl, projectId, 'live input');
  const packageId = await createReadyPackage(apiUrl, planRevisionId, 'live input');
  const runSessionId = await runPackage(apiUrl, packageId, mode, evidence);
  const queued = await waitForEvent(apiUrl, runSessionId, (event) => event.event_type === 'run_queued', {
    label: 'run_queued before terminal status',
    mode,
    evidence,
  });
  const sseDriverStarted = waitForSseEvent(apiUrl, runSessionId, (event) => event.event_type === 'driver_started', {
    after: queued.cursor,
    label: 'driver_started append',
    mode,
    evidence,
  });

  const driver = new FakeCodexSessionDriver({
    script: [driverStarted('Fake driver started.'), waitingForInput(), { kind: 'delay', ms: 2_500 }, terminalSucceeded('Fake driver completed.')],
    inputAcks: [{ continuity: { thread_id: 'dogfood-thread', turn_id: 'dogfood-turn-after-input' } }],
    cancelAcks: [{ cancelled: true, reason: 'dogfood cancel command accepted' }],
  });
  const worker = createWorker(repository, driver, 'dogfood-worker-live', makeClock('2026-05-08T01:00:00.000Z'));
  const workerRun = worker.drainOnce();
  await sseDriverStarted;

  const waiting = await waitForEvent(apiUrl, runSessionId, (event) => event.event_type === 'waiting_for_input', {
    after: queued.cursor,
    label: 'waiting_for_input',
    mode,
    evidence,
  });
  const preTerminal = await requestJson(apiUrl, `/run-sessions/${encodeURIComponent(runSessionId)}`);
  if (terminalRunStatuses.has(stringField(preTerminal, 'status'))) {
    notes.push('Run reached terminal status before waiting_for_input was observed.');
  }

  const resumeCommandId = await runControlCommand(apiUrl, runSessionId, 'resume', 'Dogfood verifies Run Console resume command.', mode, evidence);
  await waitForEvent(
    apiUrl,
    runSessionId,
    (event) => event.event_type === 'resuming' && event.payload.command_id === resumeCommandId,
    { after: waiting.cursor, label: 'resuming event', mode, evidence },
  );

  const command = await requestBuiltJson(
    apiUrl,
    buildRunInputRequest(runSessionId, { mode, actorId: actorOwner, message: 'Continue with the fake dogfood path.' }),
  );
  if (mode === 'durable') {
    evidence.durablePublicApiHeaderAuth = true;
  } else {
    evidence.volatileActorFallback = true;
  }
  const commandId = stringField(command, 'command_id');
  if (command.status !== 'accepted') {
    notes.push('Input command was not accepted.');
  }

  await waitForEvent(
    apiUrl,
    runSessionId,
    (event) => event.event_type === 'user_input' && event.payload.command_id === commandId && event.summary === 'User input submitted.',
    { after: waiting.cursor, label: 'submitted user_input event', mode, evidence },
  );
  await waitForEvent(
    apiUrl,
    runSessionId,
    (event) => event.event_type === 'user_input' && event.payload.command_id === commandId && event.summary === 'User input delivered.',
    { after: waiting.cursor, label: 'delivered user_input event', mode, evidence },
  );

  const cancelCommandId = await runControlCommand(apiUrl, runSessionId, 'cancel', 'Dogfood verifies Run Console cancel command.', mode, evidence);
  await waitForEvent(
    apiUrl,
    runSessionId,
    (event) => event.event_type === 'cancel_requested' && event.payload.command_id === cancelCommandId,
    { after: waiting.cursor, label: 'cancel_requested event', mode, evidence },
  );

  await workerRun;
  if (driver.inputs.length !== 1 || driver.inputs[0]?.message !== 'Continue with the fake dogfood path.') {
    notes.push('Fake driver did not receive the submitted input exactly once.');
  }
  if (driver.cancelRequests.length !== 1) {
    notes.push('Fake driver did not receive the cancel command exactly once.');
  }

  const reviewPacketId = await assertFinalEvidence(apiUrl, repository, runSessionId, mode, evidence);
  return { label: 'live-input-fake-driver', packageId, runSessionId, reviewPacketId, status: notes.length === 0 ? 'passed' : 'failed', notes };
};

const dogfoodRestartRun = async (
  app: INestApplication,
  apiUrl: string,
  repository: P0Repository,
  projectId: string,
  mode: DogfoodDurabilityMode,
  evidence: PublicApiAuthEvidence,
): Promise<{ app: INestApplication; apiUrl: string; result: DogfoodResult }> => {
  const notes: string[] = [];
  const planRevisionId = await createApprovedPlan(apiUrl, projectId, 'restart recovery');
  const packageId = await createReadyPackage(apiUrl, planRevisionId, 'restart recovery');
  const runSessionId = await runPackage(apiUrl, packageId, mode, evidence);
  const queued = await waitForEvent(apiUrl, runSessionId, (event) => event.event_type === 'run_queued', {
    label: 'restart run_queued',
    mode,
    evidence,
  });

  const command = await requestBuiltJson(
    apiUrl,
    buildRunInputRequest(runSessionId, { mode, actorId: actorOwner, message: 'Already-applied input should not be replayed.' }),
  );
  if (mode === 'durable') {
    evidence.durablePublicApiHeaderAuth = true;
  } else {
    evidence.volatileActorFallback = true;
  }
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
  const restarted = await createApiApp(repository, { durabilityMode: mode });
  const afterRestartEvents = await listRunEvents(restarted.apiUrl, runSessionId, queued.cursor, mode, evidence);
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
  const restartBackfill = await listRunEvents(restarted.apiUrl, runSessionId, queued.cursor, mode, evidence);
  if (!restartBackfill.some((event) => event.event_type === 'driver_started')) {
    notes.push('Restarted API did not backfill worker events after recovery.');
  }

  const reviewPacketId = await assertFinalEvidence(restarted.apiUrl, repository, runSessionId, mode, evidence);
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

const durableRecordsFor = (prefix: string): {
  project: Project;
  projectRepo: ProjectRepo;
  workItem: WorkItem;
  spec: Spec;
  specRevision: SpecRevision;
  plan: Plan;
  planRevision: PlanRevision;
  executionPackage: ExecutionPackage;
  runSession: RunSession;
  command: RunCommand;
} => {
  const now = '2026-05-08T03:00:00.000Z';
  const runSessionId = `${prefix}-run-session`;
  const project: Project = {
    id: `${prefix}-project`,
    name: `Forgeloop P0 durable dogfood ${prefix}`,
    repo_ids: [`${prefix}-repo`],
    owner_actor_id: actorOwner,
    created_at: now,
    updated_at: now,
  };
  const projectRepo: ProjectRepo = {
    id: `${prefix}-project-repo`,
    repo_id: `${prefix}-repo`,
    project_id: project.id,
    name: repoId,
    status: 'active',
    local_path: repoPath,
    default_branch: 'main',
    base_commit_sha: 'dogfood-durable-base',
    created_at: now,
    updated_at: now,
  };
  const workItem: WorkItem = {
    id: `${prefix}-work-item`,
    project_id: project.id,
    kind: 'test_refactor',
    title: 'Durable dogfood restart recovery',
    goal: 'Verify run state survives fresh repository and API instances.',
    success_criteria: ['Events backfill after restart.', 'Worker lease takeover completes without duplicate input.'],
    priority: 'P0',
    risk: 'medium',
    owner_actor_id: actorOwner,
    phase: 'execution',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    current_spec_id: `${prefix}-spec`,
    current_plan_id: `${prefix}-plan`,
    created_at: now,
    updated_at: now,
  };
  const spec: Spec = {
    id: `${prefix}-spec`,
    work_item_id: workItem.id,
    entity_type: 'spec',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: `${prefix}-spec-revision`,
    created_at: now,
    updated_at: now,
  };
  const specRevision: SpecRevision = {
    id: `${prefix}-spec-revision`,
    spec_id: spec.id,
    work_item_id: workItem.id,
    revision_number: 1,
    summary: 'Durable dogfood spec',
    content: 'Durable dogfood spec body',
    background: 'Durable restart recovery must be explicit.',
    goals: ['Backfill events from Postgres'],
    scope_in: ['Run events', 'Run commands', 'Worker leases'],
    scope_out: ['Browser visual rendering'],
    acceptance_criteria: ['Fresh repository instances can recover the run'],
    risk_notes: [],
    test_strategy_summary: 'Dogfood fake-driver restart check',
    artifact_refs: [],
    created_at: now,
  };
  const plan: Plan = {
    id: `${prefix}-plan`,
    work_item_id: workItem.id,
    entity_type: 'plan',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: `${prefix}-plan-revision`,
    created_at: now,
    updated_at: now,
  };
  const planRevision: PlanRevision = {
    id: `${prefix}-plan-revision`,
    plan_id: plan.id,
    work_item_id: workItem.id,
    revision_number: 1,
    summary: 'Durable dogfood plan',
    content: 'Seed a recoverable run, rebuild repository/app instances, then let a worker reclaim it.',
    implementation_summary: 'Use Drizzle/Postgres repository instances over the same database.',
    split_strategy: 'Single durable recovery check.',
    dependency_order: [`${prefix}-execution-package`],
    test_matrix: ['pnpm dogfood:p0'],
    risk_mitigations: [],
    rollback_notes: 'Remove dogfood records by prefix if needed.',
    artifact_refs: [],
    created_at: now,
  };
  const generatedPackage = transitionExecutionPackage(undefined, {
    type: 'generate_package',
    id: `${prefix}-execution-package`,
    work_item_id: workItem.id,
    spec_id: spec.id,
    spec_revision_id: specRevision.id,
    plan_id: plan.id,
    plan_revision_id: planRevision.id,
    project_id: project.id,
    repo_id: projectRepo.repo_id,
    objective: 'Durable dogfood recovery package.',
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
    at: now,
  });
  const readyPackage = transitionExecutionPackage(generatedPackage, { type: 'mark_ready', at: now });
  const executionPackage = {
    ...transitionExecutionPackage(readyPackage, { type: 'run', run_session_id: runSessionId, at: now }),
    phase: 'execution',
    activity_state: 'ai_running',
    updated_at: now,
  } satisfies ExecutionPackage;
  const runSpec = {
    run_session_id: runSessionId,
    execution_package_id: executionPackage.id,
    work_item_id: workItem.id,
    spec_revision_id: specRevision.id,
    plan_revision_id: planRevision.id,
    executor_type: 'mock' as const,
    repo: {
      repo_id: projectRepo.repo_id,
      local_path: repoPath,
      base_branch: projectRepo.default_branch,
      base_commit_sha: projectRepo.base_commit_sha,
    },
    objective: executionPackage.objective,
    context: {
      spec_revision_summary: specRevision.summary,
      plan_revision_summary: planRevision.summary,
      package_instructions: executionPackage.objective,
      required_checks: executionPackage.required_checks,
    },
    review_context: { latest_decision: 'none' as const, requested_changes: [] },
    workflow_only: true,
    allowed_paths: executionPackage.allowed_paths,
    forbidden_paths: executionPackage.forbidden_paths,
    required_checks: executionPackage.required_checks,
    artifact_policy: { requested_artifacts: ['diff' as const, 'changed_files' as const, 'check_output' as const, 'execution_summary' as const] },
    timeout_seconds: 3600,
    idempotency_key: runSessionId,
  };
  const runSession: RunSession = {
    ...transitionRunSession(undefined, {
      type: 'create',
      id: runSessionId,
      execution_package_id: executionPackage.id,
      requested_by_actor_id: actorOwner,
      executor_type: 'mock',
      at: now,
    }),
    status: 'waiting_for_input',
    run_spec: runSpec,
    runtime_metadata: {
      durability_mode: 'durable',
      driver_kind: 'fake',
      driver_status: 'waiting_for_input',
      codex_thread_id: `${prefix}-thread`,
      active_turn_id: `${prefix}-turn`,
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
    },
    started_at: now,
    updated_at: now,
  };
  const command: RunCommand = {
    id: `${prefix}-run-command-applied-input`,
    run_session_id: runSessionId,
    command_type: 'input',
    status: 'applied',
    actor_id: actorOwner,
    payload: { message: 'This input was applied before durable restart.' },
    target_turn_id: `${prefix}-turn`,
    claimed_by_worker_id: `${prefix}-old-worker`,
    claimed_at: '2026-05-08T03:00:01.000Z',
    applied_at: '2026-05-08T03:00:02.000Z',
    driver_ack: { continuity: { thread_id: `${prefix}-thread`, turn_id: `${prefix}-turn-after-input` } },
    created_at: now,
    updated_at: '2026-05-08T03:00:02.000Z',
  };

  return { project, projectRepo, workItem, spec, specRevision, plan, planRevision, executionPackage, runSession, command };
};

const seedDurableRecoverableRun = async (repository: P0Repository, prefix: string): Promise<{ runSessionId: string; queuedCursor: string }> => {
  const records = durableRecordsFor(prefix);
  await repository.saveProject(records.project);
  await repository.saveProjectRepo(records.projectRepo);
  await repository.saveWorkItem(records.workItem);
  await repository.saveSpec(records.spec);
  await repository.saveSpecRevision(records.specRevision);
  await repository.savePlan(records.plan);
  await repository.savePlanRevision(records.planRevision);
  await repository.saveExecutionPackage(records.executionPackage);
  await repository.saveRunSession(records.runSession);
  await repository.saveRunCommand(records.command);
  const queued = await repository.appendRunEvent({
    id: `${prefix}-run-event-queued`,
    run_session_id: records.runSession.id,
    event_type: 'run_queued',
    source: 'api',
    visibility: 'public',
    summary: 'Durable run queued.',
    payload: { execution_package_id: records.executionPackage.id, mode: 'run', workflow_only: true, executor_type: 'mock' },
    created_at: '2026-05-08T03:00:00.000Z',
  });
  await repository.appendRunEvent({
    id: `${prefix}-run-event-input-submitted`,
    run_session_id: records.runSession.id,
    event_type: 'user_input',
    source: 'user',
    visibility: 'public',
    summary: 'User input submitted before restart.',
    payload: { command_id: records.command.id, actor_id: actorOwner, message: records.command.payload.message },
    created_at: '2026-05-08T03:00:01.000Z',
  });
  await repository.claimRunWorkerLease({
    run_session_id: records.runSession.id,
    worker_id: `${prefix}-old-worker`,
    lease_token: `${prefix}-old-lease`,
    now: '2026-05-08T03:00:00.000Z',
    expires_at: '2026-05-08T03:00:05.000Z',
  });

  return { runSessionId: records.runSession.id, queuedCursor: queued.cursor };
};

const createDurableRepository = (connectionString: string): { client: DbClient; repository: P0Repository } => {
  const client = createDbClient({ connectionString });
  return { client, repository: createDrizzleP0Repository(client.db) };
};

const runDbPushCheck = async (): Promise<VerificationCheck> => {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    return {
      label: 'DB schema push',
      status: 'skipped',
      details: ['FORGELOOP_DATABASE_URL is not set; durable DB push was not run.'],
    };
  }

  try {
    await runCommand('pnpm', ['db:push'], { env: { FORGELOOP_DATABASE_URL: databaseUrl }, timeoutMs: 60_000 });
    return {
      label: 'DB schema push',
      status: 'passed',
      details: ['FORGELOOP_DATABASE_URL is set and `pnpm db:push` completed.'],
    };
  } catch (error) {
    return {
      label: 'DB schema push',
      status: 'failed',
      details: [`FORGELOOP_DATABASE_URL is set but schema push failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
};

const runDurableRepositoryCheck = async (dbPush: VerificationCheck): Promise<VerificationCheck> => {
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    return {
      label: 'Durable repository restart recovery',
      status: 'skipped',
      details: ['FORGELOOP_DATABASE_URL is not set; durable repository restart recovery was not run.'],
    };
  }
  if (dbPush.status !== 'passed') {
    return {
      label: 'Durable repository restart recovery',
      status: 'skipped',
      details: ['Schema push did not pass, so durable restart recovery was not attempted.'],
    };
  }

  const prefix = `dogfood-${Date.now()}`;
  let client1: DbClient | undefined;
  let client2: DbClient | undefined;

  try {
    const first = createDurableRepository(databaseUrl);
    client1 = first.client;
    const seeded = await seedDurableRecoverableRun(first.repository, prefix);
    await client1.pool.end();
    client1 = undefined;

    const second = createDurableRepository(databaseUrl);
    client2 = second.client;
    const backfilled = await second.repository.listRunEvents(seeded.runSessionId, { after: seeded.queuedCursor });
    if (!backfilled.some((event) => event.event_type === 'user_input')) {
      throw new Error('Fresh durable repository instance did not backfill the pre-restart user_input event.');
    }

    const driver = new FakeCodexSessionDriver({
      script: [driverStarted('Durable restart worker reclaimed run.'), terminalSucceeded('Durable restart worker completed.')],
      inputAcks: [{ continuity: { thread_id: `${prefix}-thread`, turn_id: `${prefix}-duplicate-input` } }],
    });
    const worker = createWorker(second.repository, driver, `${prefix}-new-worker`, makeClock('2026-05-08T03:01:00.000Z'));
    await worker.drainOnce();
    if (driver.inputs.length !== 0) {
      throw new Error('Fresh worker duplicated already-applied durable input.');
    }
    const lease = await second.repository.getRunWorkerLease(seeded.runSessionId);
    if (lease?.worker_id !== `${prefix}-new-worker` || lease.status !== 'released') {
      throw new Error('Fresh worker did not reclaim and release the durable run lease.');
    }
    await assertRepositoryFinalEvidence(second.repository, seeded.runSessionId);

    return {
      label: 'Durable repository restart recovery',
      status: 'passed',
      details: [
        'Used fresh Drizzle repository instances over the same Postgres database, with the pool closed and reopened across the restart boundary.',
        `RunSession ${seeded.runSessionId} backfilled events by cursor, reclaimed an expired lease, and completed without duplicate input delivery.`,
        'Verified terminal changed files, checks, artifacts, and Review Packet readiness through repository reads.',
      ],
    };
  } catch (error) {
    return {
      label: 'Durable repository restart recovery',
      status: 'failed',
      details: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    await client1?.pool.end();
    await client2?.pool.end();
  }
};

const probeWebApp = async (): Promise<VerificationCheck[]> => {
  for (const webUrl of webUrlCandidates) {
    try {
      const response = await fetch(webUrl, { signal: AbortSignal.timeout(1_500) });
      const text = await response.text();
      if (response.ok && text.includes('<div id="root"')) {
        return [
          {
            label: 'Web app probe',
            status: 'passed',
            details: [`Web app responded at ${webUrl}.`],
          },
          {
            label: 'Browser visual/text-overflow verification',
            status: 'skipped',
            details: [
              'No in-app browser automation was available to this script; visual Run Console layout and narrow viewport text overflow remain manual checks.',
            ],
          },
        ];
      }
    } catch {
      // Try the next likely Vite URL.
    }
  }

  return [
    {
      label: 'Web app probe',
      status: 'skipped',
      details: [`No web app responded at ${webUrlCandidates.join(', ')}.`],
    },
    {
      label: 'Browser visual/text-overflow verification',
      status: 'skipped',
      details: [
        'Run Console visual layout and narrow viewport text overflow remain unverified because no web app/browser target was available to this script.',
      ],
    },
  ];
};

export const renderReport = (data: {
  status: 'PASS' | 'FAIL';
  apiUrl?: string;
  results: DogfoodResult[];
  checks: VerificationCheck[];
  error?: string;
}): string => {
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
  const checkLines =
    data.checks.length === 0
      ? ['- No additional verification checks recorded.']
      : data.checks.map((check) => [`- ${check.label}: ${check.status.toUpperCase()}`, ...check.details.map((detail) => `  - ${detail}`)].join('\n'));

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
    '- `pnpm dogfood:p0`: exits 0 only when fake-driver live events, SSE append, input/cancel/resume commands, event backfill, lease takeover, final evidence, and Review Packet approval pass. Durable public API auth and repository checks run when `FORGELOOP_DATABASE_URL` is set.',
    '',
    '## Dogfood Preconditions',
    '',
    `- API URL: ${data.apiUrl ?? 'not started'}`,
    `- Repo path: ${repoPath}`,
    `- Repo id: ${repoId}`,
    '- Volatile dogfood uses an in-process volatile_demo API and deterministic fake drivers for repeatable long-running run verification.',
    '- Durable dogfood uses X-Forgeloop-Actor-Id for public run APIs and stream_token for SSE when `FORGELOOP_DATABASE_URL` is set.',
    '- Durable repository dogfood uses fresh Drizzle repository instances over the same Postgres database only when `FORGELOOP_DATABASE_URL` is set.',
    '- Real local_codex acceptance is separate from this deterministic fake-driver dogfood pass and requires a local Codex runtime.',
    '',
    '## Dogfood Results',
    '',
    ...resultLines,
    '',
    '## DB And Manual/Web Verification',
    '',
    ...checkLines,
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
  const mode = durableModeFromEnv();
  const publicApiAuthEvidence: PublicApiAuthEvidence = {
    durablePublicApiHeaderAuth: false,
    durableSseStreamTokenAuth: false,
    volatileActorFallback: false,
  };
  let durableClient: DbClient | undefined;
  const durableRepository = mode === 'durable' && databaseUrl !== undefined ? createDurableRepository(databaseUrl) : undefined;
  if (durableRepository !== undefined) {
    durableClient = durableRepository.client;
  }
  const repository = durableRepository?.repository ?? new InMemoryP0Repository();
  let app: INestApplication | undefined;
  let apiUrl: string | undefined;
  const results: DogfoodResult[] = [];
  const checks: VerificationCheck[] = [];

  try {
    const dbPush = await runDbPushCheck();
    checks.push(dbPush);
    if (mode === 'durable' && dbPush.status !== 'passed') {
      throw new Error('FORGELOOP_DATABASE_URL is set but DB schema push did not pass.');
    }

    const started = await createApiApp(repository, { durabilityMode: mode });
    app = started.app;
    apiUrl = started.apiUrl;
    const projectId = await createProjectAndRepo(apiUrl);

    results.push(await dogfoodLiveInputRun(apiUrl, repository, projectId, mode, publicApiAuthEvidence));
    const restarted = await dogfoodRestartRun(app, apiUrl, repository, projectId, mode, publicApiAuthEvidence);
    app = restarted.app;
    apiUrl = restarted.apiUrl;
    results.push(restarted.result);

    checks.push({
      label: 'Run Console HTTP/SSE command semantics',
      status: 'passed',
      details: ['Verified event backfill, SSE append, input submission/delivery, resume command, and cancel command through public run APIs.'],
    });
    checks.push(...publicApiAuthChecks(mode, publicApiAuthEvidence));
    checks.push(await runDurableRepositoryCheck(dbPush));
    checks.push(...(await probeWebApp()));

    const failed = results.filter((result) => result.status === 'failed');
    const failedChecks = checks.filter((check) => check.status === 'failed');
    const status = failed.length === 0 && failedChecks.length === 0 ? 'PASS' : 'FAIL';
    await writeReport(renderReport({ status, apiUrl, results, checks }));
    return status === 'PASS' ? 0 : 1;
  } catch (error) {
    await writeReport(
      renderReport({
        status: 'FAIL',
        apiUrl,
        results,
        checks,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return 1;
  } finally {
    await app?.close();
    await durableClient?.pool.end();
  }
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
