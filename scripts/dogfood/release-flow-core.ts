import { randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { ReleaseController } from '../../apps/control-plane-api/src/modules/release/release.controller';
import { ReleaseService } from '../../apps/control-plane-api/src/modules/release/release.service';
import {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  RUN_DURABILITY_MODE,
  RUN_WORKER,
} from '../../apps/control-plane-api/src/p0/p0.service';
import { RunWorkerLifecycleService } from '../../apps/control-plane-api/src/p0/run-worker-lifecycle.service';
import { actorHeaderName } from '../../apps/control-plane-api/src/p0/actor-context';
import { createDbClient, createDrizzleP0Repository, InMemoryP0Repository } from '../../packages/db/src';
import type { DbClient, P0Repository } from '../../packages/db/src';
import {
  artifactIdForRunSessionArtifact,
  reviewPacketIdForRunSession,
  stableWorkflowUuidFor,
} from '../../packages/workflow/src';
import {
  createDatabase,
  discoverDockerPostgresCandidate,
  dropDatabase,
  planDurableDogfoodDatabase,
  prepareSafeDatabaseTarget,
  pushSchema,
  resetDatabase,
  startDisposablePostgres,
} from './durable-postgres.js';
import type { CommandRunner, DockerPostgresCandidate, DurableDogfoodPlan, Env } from './durable-postgres.js';
import {
  evaluateLocalCodexDogfoodEnablement,
  extractPersistedTerminalEvidence,
  isPublicCodexLiveProgressEvent,
  preflightLocalCodexDogfood,
  releaseStrictDirtyAllowlist,
  resolveReviewPacketReference,
  runSessionRuntimeMetadataReport,
  sanitizeStrictPreflightBlockerDetails,
  validateLocalCodexRuntimeMetadata,
  type ObservedRunEvent,
  type PreflightResult,
} from './strict-local-codex.js';
import type {
  Actor,
  Artifact,
  CheckResult,
  ExecutionPackage,
  Organization,
  Project,
  ReviewPacket,
  RunSession,
  WorkItem,
} from '../../packages/domain/src';

export type MarkerStatus = 'PASSED' | 'BLOCKED with reason' | 'FAILED';
export type VerificationMarker = {
  marker: (typeof requiredReleaseFlowReportMarkers)[number];
  status: MarkerStatus;
  details: string[];
};
type JsonRecord = Record<string, unknown>;

const actorOwner = process.env.FORGELOOP_ACTOR_OWNER ?? 'actor-owner';
const actorReviewer = process.env.FORGELOOP_ACTOR_REVIEWER ?? 'actor-reviewer';
const actorQa = process.env.FORGELOOP_ACTOR_QA ?? 'actor-qa';

const now = '2026-05-11T00:00:00.000Z';
const later = '2026-05-11T00:01:00.000Z';
const requiredCheck = {
  check_id: 'release-flow-dogfood',
  display_name: 'Release flow dogfood',
  command: 'pnpm dogfood:release-flow',
  timeout_seconds: 120,
  blocks_review: true,
};
const unsafeSerializedStrings = [
  '/Users/',
  '/workspace/',
  '.worktrees',
  'raw_metadata',
  'runtime_metadata',
  'allowed_paths',
  'forbidden_paths',
  'client_secret',
  'access_token',
  'api_key',
  'authorization',
  'database_url',
  'rawMetadata',
  'runtimeMetadata',
  'allowedPaths',
  'forbiddenPaths',
  'workspace_path',
  'workspacePath',
  'worktree_path',
  'worktreePath',
  'password',
  'secret',
  'token',
  'local_ref',
  'localRef',
  'artifact_path',
  'artifactPath',
  '/tmp/forgeloop-executor-artifacts',
  '/var/folders/',
  'postgresql://',
  'postgres://',
] as const;

const unsafeSerializedPatterns = [
  /\/tmp\//i,
  /\/private\/var\/folders\//i,
  /\/var\/folders\//i,
  /\/home\//i,
  /\/opt\//i,
  /\b[A-Za-z]:(?:[\\/](?![\\/])|\\\\)/i,
  /forgeloop-executor-artifacts/i,
  /local[_-]?ref/i,
  /artifact[_-]?path/i,
  /allowed[_-]?paths/i,
  /forbidden[_-]?paths/i,
  /workspace[_-]?path/i,
  /worktree[_-]?path/i,
  /raw[_-]?metadata/i,
  /runtime[_-]?metadata/i,
  /database[_-]?url/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /api[_-]?key/i,
  /client[_-]?secret/i,
  /session[_-]?secret/i,
  /authorization/i,
  /secret/i,
  /password/i,
] as const;

export const requiredReleaseFlowReportMarkers = [
  'P0 delivery path',
  'Release create/link/submit',
  'Release approval or override approval',
  'Release observing/close',
  'Release cockpit query',
  'Release replay redaction',
  'Release observation backlink projection',
  'Durable local reset',
  'Strict local_codex run',
] as const;

export const strictReleaseClosureMarkers = ['Durable local reset', 'Strict local_codex run'] as const;

export const buildDurableReleaseDogfoodIdentity = (createdAt: string): {
  organization: Organization;
  actors: { owner: Actor; reviewer: Actor; qa: Actor };
  project: Project;
} => {
  const organization: Organization = {
    id: randomUUID(),
    name: 'Release Strict Dogfood',
    created_at: createdAt,
    updated_at: createdAt,
  };
  const actor = (displayName: string): Actor => ({
    id: randomUUID(),
    org_id: organization.id,
    actor_type: 'human',
    display_name: displayName,
    created_at: createdAt,
    updated_at: createdAt,
  });
  const owner = actor('Release Owner Dogfood');
  const reviewer = actor('Release Reviewer Dogfood');
  const qa = actor('Release QA Dogfood');

  return {
    organization,
    actors: { owner, reviewer, qa },
    project: {
      id: randomUUID(),
      org_id: organization.id,
      key: 'release-strict-dogfood',
      name: 'Release Strict Dogfood',
      repo_ids: [],
      owner_actor_id: owner.id,
      created_at: createdAt,
      updated_at: createdAt,
    },
  };
};

export const buildReleaseStrictObservationLinks = (input: {
  releaseId: string;
  executionPackageId: string;
  runSessionId: string;
}) => [
  { object_type: 'release' as const, object_id: input.releaseId, relationship: 'observed' as const },
  { object_type: 'execution_package' as const, object_id: input.executionPackageId, relationship: 'supports' as const },
  { object_type: 'run_session' as const, object_id: input.runSessionId, relationship: 'generated_by' as const },
];

export const publicStrictLocalCodexEvidenceSummary = (input: {
  runSessionId: string;
  changedFileCount: number;
  checkCount: number;
  artifactKinds: string[];
  reviewPacketAvailable: boolean;
}) => ({
  run_session_id: input.runSessionId,
  changed_file_count: input.changedFileCount,
  check_count: input.checkCount,
  artifact_kinds: input.artifactKinds,
  review_packet_available: input.reviewPacketAvailable,
});

export const shouldAttemptReleaseStrictLocalCodex = (env: Record<string, string | undefined>): boolean =>
  evaluateLocalCodexDogfoodEnablement(env).enabled;

export const buildReleaseLocalCodexPackageInput = (input: {
  repoPath: string;
  baseCommitSha: string;
  actorOwner: string;
  actorReviewer: string;
  actorQa: string;
}) => ({
  repo_id: 'forgeloop-source',
  objective: 'Append a short Release strict dogfood marker line to README.md only. Do not edit files outside README.md.',
  owner_actor_id: input.actorOwner,
  reviewer_actor_id: input.actorReviewer,
  qa_owner_actor_id: input.actorQa,
  required_checks: [
    {
      check_id: 'release-strict-local-codex',
      display_name: 'Release strict local Codex required check',
      command: 'node -e "process.exit(0)"',
      timeout_seconds: 30,
      blocks_review: true,
    },
  ],
  required_artifact_kinds: ['execution_summary', 'diff', 'changed_files', 'check_output', 'review_packet'],
  allowed_paths: ['README.md'],
  forbidden_paths: ['.git', '.env', 'node_modules'],
});

const terminalRunStatuses = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

export const pollStrictLocalCodexRunToTerminal = async (input: {
  getRunSession: () => Promise<{ status: string; id: string }>;
  getPublicRunEvents: () => Promise<Array<{ event_type: string; visibility?: string; runStatusAtObservation?: string }>>;
  timeoutMs: number;
  intervalMs: number;
}): Promise<{ terminal: { status: string; id: string }; observedPublicNonTerminalEvent: boolean }> => {
  const deadline = Date.now() + input.timeoutMs;
  let observedPublicNonTerminalEvent = false;
  while (Date.now() <= deadline) {
    const events = await input.getPublicRunEvents();
    observedPublicNonTerminalEvent =
      observedPublicNonTerminalEvent ||
      events.some((event) => isPublicCodexLiveProgressEvent(event));
    const terminal = await input.getRunSession();
    if (terminalRunStatuses.has(terminal.status)) {
      return { terminal, observedPublicNonTerminalEvent };
    }
    await new Promise((resolve) => setTimeout(resolve, input.intervalMs));
  }
  throw new Error('local_codex_run_terminal_timeout');
};

export const statusCodeForStrictReleaseMarkers = (
  markers: readonly VerificationMarker[],
  options: { allowBlocked: boolean },
): 0 | 1 => {
  if (markers.some((marker) => marker.status === 'FAILED')) {
    return 1;
  }
  if (markers.every((marker) => marker.status === 'PASSED')) {
    return 0;
  }
  const blockedMarkers = markers.filter((marker) => marker.status === 'BLOCKED with reason');
  const onlyStrictClosureMarkersAreBlocked = blockedMarkers.every((marker) =>
    strictReleaseClosureMarkers.includes(marker.marker as (typeof strictReleaseClosureMarkers)[number]),
  );
  return options.allowBlocked && onlyStrictClosureMarkersAreBlocked ? 0 : 1;
};

const noopRunWorker = {
  kick: () => undefined,
  drainOnce: async () => undefined,
};

const execFile = promisify(execFileCallback);

const runCommand: CommandRunner = async (command, args, options = {}) => {
  const { stdout, stderr } = await execFile(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    timeout: options.timeoutMs ?? 30_000,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
};

const serializeForUnsafeReleaseDogfoodScan = (value: unknown): string => {
  if (value === undefined) {
    return '[undefined]';
  }

  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(value, (_key, candidate: unknown) => {
      if (typeof candidate === 'bigint') {
        return `[bigint:${candidate.toString()}]`;
      }
      if (typeof candidate === 'function') {
        return `[function:${candidate.name}]`;
      }
      if (typeof candidate === 'symbol') {
        return `[symbol:${candidate.description ?? ''}]`;
      }
      if (candidate !== null && typeof candidate === 'object') {
        if (seen.has(candidate)) {
          return '[circular]';
        }
        seen.add(candidate);
      }
      return candidate;
    });

    return serialized ?? '[unserializable]';
  } catch {
    return '[unserializable]';
  }
};

export const assertNoUnsafeReleaseDogfoodStrings = (label: string, value: unknown): void => {
  const serialized = serializeForUnsafeReleaseDogfoodScan(value);
  for (const unsafe of unsafeSerializedStrings) {
    if (serialized.toLowerCase().includes(unsafe.toLowerCase())) {
      throw new Error(`${label} exposed unsafe serialized string: ${unsafe}`);
    }
  }
  for (const pattern of unsafeSerializedPatterns) {
    if (pattern.test(serialized)) {
      throw new Error(`${label} exposed unsafe serialized pattern: ${pattern.source}`);
    }
  }
};

const createDogfoodApp = async (): Promise<{ app: INestApplication; repository: InMemoryP0Repository }> => {
  const repository = new InMemoryP0Repository();
  (Reflect as typeof Reflect & { defineMetadata?: (key: string, value: unknown, target: object) => void }).defineMetadata?.(
    'design:paramtypes',
    [ReleaseService],
    ReleaseController,
  );
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
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return { app, repository };
};

const createDurableReleaseDogfoodApp = async (
  repository: P0Repository,
  options: { useRealWorker: boolean } = { useRealWorker: false },
): Promise<{ app: INestApplication; runWorker?: StrictRunWorker }> => {
  (Reflect as typeof Reflect & { defineMetadata?: (key: string, value: unknown, target: object) => void }).defineMetadata?.(
    'design:paramtypes',
    [ReleaseService],
    ReleaseController,
  );
  let moduleBuilder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(P0_REPOSITORY)
    .useValue(repository)
    .overrideProvider(RUN_DURABILITY_MODE)
    .useValue('durable')
    .overrideProvider(P0_DEMO_ACTOR_ID_FALLBACK)
    .useValue(false);
  if (options.useRealWorker) {
    moduleBuilder = moduleBuilder.overrideProvider(RunWorkerLifecycleService).useValue({
      onModuleInit: () => undefined,
      onModuleDestroy: () => undefined,
    });
  } else {
    moduleBuilder = moduleBuilder.overrideProvider(RUN_WORKER).useValue(noopRunWorker);
  }
  const moduleRef = await moduleBuilder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.useLogger(false);
  await app.init();
  return options.useRealWorker ? { app, runWorker: moduleRef.get<StrictRunWorker>(RUN_WORKER) } : { app };
};

const checkResults = (): CheckResult[] => [
  {
    check_id: requiredCheck.check_id,
    command: requiredCheck.command,
    status: 'succeeded',
    exit_code: 0,
    duration_seconds: 1,
    blocks_review: true,
  },
];

const seedCompletedReleaseReadyRuntime = async (
  repository: InMemoryP0Repository,
  executionPackage: ExecutionPackage,
): Promise<{ workItem: WorkItem; executionPackage: ExecutionPackage; runSession: RunSession; reviewPacket: ReviewPacket }> => {
  const workItem = await repository.getWorkItem(executionPackage.work_item_id);
  if (workItem === undefined) {
    throw new Error(`WorkItem ${executionPackage.work_item_id} was not created`);
  }

  const runSession: RunSession = {
    id: 'release-flow-dogfood-run-session',
    execution_package_id: executionPackage.id,
    requested_by_actor_id: actorOwner,
    status: 'succeeded',
    executor_type: 'mock',
    changed_files: [{ repo_id: executionPackage.repo_id, path: 'apps/control-plane-api/src/modules/release/release.service.ts', change_kind: 'modified' }],
    check_results: checkResults(),
    artifacts: [
      {
        kind: 'execution_summary',
        name: 'Release flow dogfood summary',
        content_type: 'text/markdown',
        local_ref: 'release-flow-dogfood-summary.md',
      },
    ],
    log_refs: [],
    summary: 'Release flow dogfood package completed.',
    runtime_metadata: {
      durability_mode: 'volatile_demo',
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
      raw_metadata: { client_secret: 'unsafe-value' },
    } as RunSession['runtime_metadata'],
    created_at: now,
    updated_at: later,
    started_at: now,
    finished_at: later,
  };
  const releaseReadyPackage: ExecutionPackage = {
    ...executionPackage,
    phase: 'release',
    activity_state: 'idle',
    gate_state: 'release_ready',
    resolution: 'completed',
    required_checks: [requiredCheck],
    required_artifact_kinds: ['execution_summary'],
    last_run_session_id: runSession.id,
    current_run_session_id: runSession.id,
    updated_at: later,
  };
  const completedWorkItem: WorkItem = {
    ...workItem,
    phase: 'done',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'completed',
    updated_at: later,
  };
  const reviewPacket: ReviewPacket = {
    id: 'release-flow-dogfood-review-packet',
    run_session_id: runSession.id,
    execution_package_id: releaseReadyPackage.id,
    reviewer_actor_id: actorReviewer,
    spec_revision_id: releaseReadyPackage.spec_revision_id,
    plan_revision_id: releaseReadyPackage.plan_revision_id,
    status: 'completed',
    decision: 'approved',
    summary: 'Approved for release flow dogfood.',
    changed_files: runSession.changed_files,
    check_result_summary: 'Release flow dogfood check passed.',
    self_review: {
      status: 'succeeded',
      summary: 'The package satisfies the dogfood objective.',
      spec_plan_alignment: 'The package follows the approved spec and plan revisions.',
      test_assessment: 'The dogfood check passed.',
      risk_notes: [],
      follow_up_questions: [],
    },
    risk_notes: [],
    reviewed_by_actor_id: actorReviewer,
    reviewed_at: later,
    requested_changes: [],
    created_at: later,
    updated_at: later,
    completed_at: later,
  };

  await repository.saveWorkItem(completedWorkItem);
  await repository.saveExecutionPackage(releaseReadyPackage);
  await repository.saveRunSession(runSession);
  await repository.saveReviewPacket(reviewPacket);

  return { workItem: completedWorkItem, executionPackage: releaseReadyPackage, runSession, reviewPacket };
};

export const seedDurableReleaseReadyPackageEvidence = async (
  repository: P0Repository,
  executionPackage: ExecutionPackage,
  input: { ownerActorId: string; reviewerActorId: string; at: string },
): Promise<{ workItem: WorkItem; executionPackage: ExecutionPackage; runSession: RunSession; reviewPacket: ReviewPacket }> => {
  const workItem = await repository.getWorkItem(executionPackage.work_item_id);
  if (workItem === undefined) {
    throw new Error('strict_seed_missing_work_item');
  }

  const runSessionId = stableWorkflowUuidFor(`strict-release-run:${executionPackage.id}`);
  const artifactRef = {
    kind: 'execution_summary' as const,
    name: 'Release strict dogfood summary',
    content_type: 'text/markdown',
    storage_uri: 'https://example.test/forgeloop/release-strict-dogfood-summary.md',
  };
  const runSession: RunSession = {
    id: runSessionId,
    execution_package_id: executionPackage.id,
    requested_by_actor_id: input.ownerActorId,
    status: 'succeeded',
    executor_type: 'mock',
    changed_files: [],
    check_results: executionPackage.required_checks.map((check) => ({
      check_id: check.check_id,
      command: check.command,
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 1,
      blocks_review: check.blocks_review,
    })),
    artifacts: [artifactRef],
    log_refs: [],
    summary: 'Strict durable release package evidence seeded.',
    created_at: input.at,
    updated_at: input.at,
    started_at: input.at,
    finished_at: input.at,
  };
  const reviewPacket: ReviewPacket = {
    id: reviewPacketIdForRunSession(runSession.id),
    run_session_id: runSession.id,
    execution_package_id: executionPackage.id,
    reviewer_actor_id: input.reviewerActorId,
    spec_revision_id: executionPackage.spec_revision_id,
    plan_revision_id: executionPackage.plan_revision_id,
    status: 'completed',
    decision: 'approved',
    summary: 'Approved for strict durable release dogfood.',
    changed_files: [],
    check_result_summary: 'Required checks passed.',
    self_review: {
      status: 'succeeded',
      summary: 'Seeded evidence satisfies the release-ready gate.',
      spec_plan_alignment: 'Seeded evidence references the approved package revisions.',
      test_assessment: 'Required checks passed.',
      risk_notes: [],
      follow_up_questions: [],
    },
    risk_notes: [],
    reviewed_by_actor_id: input.reviewerActorId,
    reviewed_at: input.at,
    requested_changes: [],
    created_at: input.at,
    updated_at: input.at,
    completed_at: input.at,
  };
  const releaseReadyPackage: ExecutionPackage = {
    ...executionPackage,
    phase: 'release',
    activity_state: 'idle',
    gate_state: 'release_ready',
    resolution: 'completed',
    last_run_session_id: runSession.id,
    current_run_session_id: runSession.id,
    current_review_packet_id: reviewPacket.id,
    updated_at: input.at,
  };
  const completedWorkItem: WorkItem = {
    ...workItem,
    phase: 'done',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'completed',
    updated_at: input.at,
  };
  const artifact: Artifact = {
    id: artifactIdForRunSessionArtifact({
      runSessionId: runSession.id,
      index: 0,
      kind: artifactRef.kind,
      name: artifactRef.name,
    }),
    object_type: 'run_session',
    object_id: runSession.id,
    trace_subject_type: 'execution_package',
    trace_subject_id: executionPackage.id,
    ref: artifactRef,
    created_at: input.at,
  };

  await repository.saveWorkItem(completedWorkItem);
  await repository.saveRunSession(runSession);
  await repository.saveReviewPacket(reviewPacket);
  await repository.saveArtifact(artifact);
  await repository.saveExecutionPackage(releaseReadyPackage);

  return { workItem: completedWorkItem, executionPackage: releaseReadyPackage, runSession, reviewPacket };
};

const createP0DeliveryPath = async (
  app: INestApplication,
  repository: InMemoryP0Repository,
): Promise<{ projectId: string; workItem: WorkItem; executionPackage: ExecutionPackage }> => {
  const server = app.getHttpServer();
  const project = (
    await request(server)
      .post('/projects')
      .send({ name: 'Release Flow Dogfood', owner_actor_id: actorOwner })
      .expect(201)
  ).body as { id: string };

  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: 'repo-1',
      name: 'forgeloop',
      local_path: '/workspace/forgeloop',
      default_branch: 'main',
      base_commit_sha: 'dogfood-base',
    })
    .expect(201);

  const createdWorkItem = (
    await request(server)
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'requirement',
        title: 'Ship Release Risk Radar',
        goal: 'Validate Release owner controls through the public API.',
        success_criteria: ['Release owner can submit, approve, observe, close, and inspect replay safely.'],
        priority: 'P1',
        risk: 'medium',
        owner_actor_id: actorOwner,
      })
      .expect(201)
  ).body as { id: string };

  const spec = (await request(server).post(`/work-items/${createdWorkItem.id}/specs`).send({}).expect(201)).body as { id: string };
  await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201);
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/specs/${spec.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  const plan = (await request(server).post(`/work-items/${createdWorkItem.id}/plans`).send({}).expect(201)).body as { id: string };
  const planRevision = (await request(server).post(`/plans/${plan.id}/generate-draft`).send({}).expect(201)).body as { id: string };
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201);
  await request(server).post(`/plans/${plan.id}/approve`).send({ actor_id: actorReviewer }).expect(201);

  const executionPackage = (
    await request(server)
      .post(`/plan-revisions/${planRevision.id}/execution-packages`)
      .send({
        repo_id: 'repo-1',
        objective: 'Implement and verify Release Risk Radar.',
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorQa,
        required_checks: [requiredCheck],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['apps/control-plane-api/**', 'packages/db/**', 'tests/api/**'],
        forbidden_paths: ['secrets/**'],
      })
      .expect(201)
  ).body as ExecutionPackage;
  await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).send({ actor_id: actorOwner }).expect(201);

  const seeded = await seedCompletedReleaseReadyRuntime(repository, executionPackage);
  return { projectId: project.id, workItem: seeded.workItem, executionPackage: seeded.executionPackage };
};

const approveOrOverride = async (
  app: INestApplication,
  releaseId: string,
  submitted: JsonRecord,
): Promise<{ response: JsonRecord; mode: 'approve' | 'override_approve' }> => {
  const server = app.getHttpServer();
  const approved = await request(server)
    .post(`/releases/${releaseId}/approve`)
    .send({ actor_id: actorReviewer, rationale: 'Release flow dogfood risks are acceptable.' });
  if (approved.status === 201) {
    throw new Error('Release dogfood expected an overrideable blocker but plain approval succeeded');
  }
  if (approved.status !== 422) {
    throw new Error(`Release approval failed with unexpected status ${approved.status}: ${approved.text}`);
  }

  const blockerSnapshot = submitted.blocker_snapshot;
  if (blockerSnapshot === undefined) {
    throw new Error('Release approval requires override but submit response did not include a blocker snapshot');
  }
  const overrideApproved = await request(server)
    .post(`/releases/${releaseId}/override-approve`)
    .send({
      actor_id: actorReviewer,
      rationale: 'Dogfood override accepted with the submitted blocker snapshot.',
      blocker_snapshot: blockerSnapshot,
    })
    .expect(201);
  return { response: overrideApproved.body as JsonRecord, mode: 'override_approve' };
};

const assertObservationBacklinkProjected = (cockpit: JsonRecord, releaseId: string): void => {
  const observations = cockpit.observations;
  if (!Array.isArray(observations)) {
    throw new Error('Release cockpit response did not include observations');
  }
  const hasReleaseBacklink = observations.some((observation) => {
    const links = (observation as { extra?: { observation?: { links?: unknown[] } } }).extra?.observation?.links;
    return Array.isArray(links) && links.some((link) => {
      const candidate = link as { object_type?: unknown; object_id?: unknown; relationship?: unknown };
      return candidate.object_type === 'release' && candidate.object_id === releaseId && candidate.relationship === 'observed';
    });
  });
  if (!hasReleaseBacklink) {
    throw new Error('Release observation backlink was not projected through the cockpit response');
  }
};

const publicPayloadHasObservationLink = (
  value: unknown,
  expected: { object_type: string; object_id: string; relationship: string },
): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => publicPayloadHasObservationLink(item, expected));
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.object_type === expected.object_type &&
    record.object_id === expected.object_id &&
    record.relationship === expected.relationship
  ) {
    return true;
  }
  return Object.values(record).some((item) => publicPayloadHasObservationLink(item, expected));
};

const assertStrictLocalCodexPublicProjection = (
  cockpit: unknown,
  replay: unknown,
  strictLocalCodex: NonNullable<StrictLifecycleResult['strictLocalCodex']>,
): void => {
  const packageLink = {
    object_type: 'execution_package',
    object_id: strictLocalCodex.executionPackageId,
    relationship: 'supports',
  };
  const runLink = {
    object_type: 'run_session',
    object_id: strictLocalCodex.runSessionId,
    relationship: 'generated_by',
  };
  if (!publicPayloadHasObservationLink(cockpit, packageLink) || !publicPayloadHasObservationLink(cockpit, runLink)) {
    throw new Error('strict local Codex public cockpit projection missing supports/generated_by links');
  }
  if (!publicPayloadHasObservationLink(replay, packageLink) || !publicPayloadHasObservationLink(replay, runLink)) {
    throw new Error('strict local Codex public replay projection missing supports/generated_by links');
  }
};

const assertOverrideBlockerFactsProjected = (cockpit: JsonRecord, replay: unknown): void => {
  const overriddenBlockers = cockpit.overridden_blockers;
  if (
    !Array.isArray(overriddenBlockers) ||
    !overriddenBlockers.some((blocker) => (blocker as { code?: unknown }).code === 'missing_rollout_strategy')
  ) {
    throw new Error('Release cockpit did not preserve overridden missing_rollout_strategy blocker facts');
  }

  if (!Array.isArray(replay)) {
    throw new Error('Release replay response was not an array');
  }
  const hasOverrideSnapshot = replay.some((entry) => {
    const payload = (entry as { payload?: { decision_type?: unknown; blocker_snapshot?: { blockers?: unknown[] } } }).payload;
    return (
      payload?.decision_type === 'manual_override' &&
      Array.isArray(payload.blocker_snapshot?.blockers) &&
      payload.blocker_snapshot.blockers.some((blocker) => (blocker as { code?: unknown }).code === 'missing_rollout_strategy')
    );
  });
  if (!hasOverrideSnapshot) {
    throw new Error('Release replay did not preserve override blocker snapshot facts');
  }
};

type StrictDbClient = { db: unknown; pool: { end: () => Promise<void> } };
type StrictLifecycleResult = {
  releaseId: string;
  projectId?: string;
  workItemId?: string;
  executionPackageId?: string;
  runSessionId?: string;
  reviewPacketId?: string;
  strictLocalCodex?: {
    executionPackageId: string;
    runSessionId: string;
    reviewPacketId: string;
    summary: ReturnType<typeof publicStrictLocalCodexEvidenceSummary>;
  };
  markers: VerificationMarker[];
};
type StrictFailureCode =
  | 'database_mutation_failed'
  | 'schema_push_failed'
  | 'reset_failed'
  | 'lifecycle_failed'
  | 'reopen_failed'
  | 'cleanup_failed'
  | 'strict_flow_failed';
type DockerPsRow = {
  ID?: string;
  Id?: string;
  Image?: string;
  Names?: string;
  Ports?: string;
};
type DockerInspectRow = {
  Id?: string;
  Config?: {
    Env?: string[];
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
};
type StrictRunWorker = { kick?: () => void; drainOnce: () => Promise<void> };
type StrictDurableDogfoodApp = {
  app: Pick<INestApplication, 'close' | 'getHttpServer'>;
  runWorker?: StrictRunWorker;
};
type StrictLocalCodexPackageResult = {
  marker: VerificationMarker;
  packageId?: string;
  runSessionId?: string;
  reviewPacketId?: string;
  summary?: ReturnType<typeof publicStrictLocalCodexEvidenceSummary>;
};
type StrictLocalCodexLifecycleDeps = {
  runCommand?: CommandRunner;
  preflightStrictLocalCodex?: (input: {
    env: Env;
    repoPath: string;
    runCommand: CommandRunner;
  }) => Promise<PreflightResult<'RELEASE_STRICT_DIRTY_ALLOWLIST'>>;
  runStrictLocalCodexPackage?: (input: {
    server: Parameters<typeof request>[0];
    repository: P0Repository;
    planRevisionId: string;
    releaseId: string;
    projectId: string;
    repoPath: string;
    baseCommitSha: string;
    actorOwner: string;
    actorReviewer: string;
    actorQa: string;
    runWorkerDrain?: () => Promise<void>;
  }) => Promise<StrictLocalCodexPackageResult>;
  runWorkerDrain?: () => Promise<void>;
};

export type StrictReleaseFlowDogfoodDeps = {
  nowMs?: () => number;
  planDatabase?: (input: { env: Env; timestamp: number }) => DurableDogfoodPlan;
  prepareSafeDatabaseTarget?: (plan: DurableDogfoodPlan) => void;
  createDatabase?: (plan: DurableDogfoodPlan) => Promise<void>;
  pushSchema?: (input: { databaseUrl: string; runCommand: CommandRunner }) => Promise<void>;
  resetDatabase?: (databaseUrl: string) => Promise<void>;
  runCommand?: CommandRunner;
  inspectDockerPostgres?: (runner: CommandRunner) => Promise<DockerPostgresCandidate | undefined>;
  startDisposablePostgres?: (runner: CommandRunner, timestamp: number) => Promise<{ containerId: string; candidate: DockerPostgresCandidate }>;
  createDbClient?: (input: { connectionString: string }) => StrictDbClient;
  createRepository?: (db: unknown) => P0Repository;
  createDurableApp?: (repository: P0Repository, options?: { useRealWorker: boolean }) => Promise<StrictDurableDogfoodApp>;
  runDurableReleaseLifecycle?: (input: {
    app: Pick<INestApplication, 'getHttpServer'>;
    repository: P0Repository;
    identity: ReturnType<typeof buildDurableReleaseDogfoodIdentity>;
    env: Env;
    deps?: StrictLocalCodexLifecycleDeps;
  }) => Promise<StrictLifecycleResult>;
  reopenDbClient?: (input: { connectionString: string }) => StrictDbClient;
  createFreshRepository?: (db: unknown) => P0Repository;
  createFreshDurableApp?: (repository: P0Repository, options?: { useRealWorker: boolean }) => Promise<StrictDurableDogfoodApp>;
  verifyDurableReleaseAfterReopen?: (input: {
    app: Pick<INestApplication, 'getHttpServer'>;
    repository: P0Repository;
    releaseId: string;
    lifecycle: StrictLifecycleResult;
  }) => Promise<void>;
  dropDatabase?: (plan: DurableDogfoodPlan) => Promise<void>;
  preflightStrictLocalCodex?: StrictLocalCodexLifecycleDeps['preflightStrictLocalCodex'];
  runStrictLocalCodexPackage?: StrictLocalCodexLifecycleDeps['runStrictLocalCodexPackage'];
  runWorkerDrain?: () => Promise<void>;
};

export type StrictReleaseFlowDogfoodInput = {
  env: Env;
  deps?: StrictReleaseFlowDogfoodDeps;
};

const parseJsonLines = <T>(text: string): T[] =>
  text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);

const inspectDockerPostgres = async (runner: CommandRunner): Promise<DockerPostgresCandidate | undefined> => {
  let psRows: DockerPsRow[];
  try {
    const ps = await runner('docker', ['ps', '--no-trunc', '--format', '{{json .}}']);
    psRows = parseJsonLines<DockerPsRow>(ps.stdout);
  } catch {
    return undefined;
  }
  const ids = psRows.map((row) => row.ID ?? row.Id).filter((id): id is string => id !== undefined && id.length > 0);
  if (ids.length === 0) {
    return undefined;
  }
  try {
    const inspect = await runner('docker', ['inspect', ...ids]);
    return discoverDockerPostgresCandidate(psRows, JSON.parse(inspect.stdout) as DockerInspectRow[]);
  } catch {
    return undefined;
  }
};

export const planStrictReleaseDogfoodDatabase = async (input: {
  env: Env;
  timestamp: number;
  runCommand: CommandRunner;
  inspectDockerPostgres?: (runner: CommandRunner) => Promise<DockerPostgresCandidate | undefined>;
  startDisposablePostgres?: (runner: CommandRunner, timestamp: number) => Promise<{ containerId: string; candidate: DockerPostgresCandidate }>;
}): Promise<DurableDogfoodPlan> => {
  if (input.env.FORGELOOP_DATABASE_URL?.trim()) {
    return planDurableDogfoodDatabase({ env: input.env, timestamp: input.timestamp });
  }

  let candidate = await (input.inspectDockerPostgres ?? inspectDockerPostgres)(input.runCommand);
  let startedContainerId: string | undefined;
  if (candidate === undefined && input.env.FORGELOOP_DOGFOOD_START_POSTGRES === '1') {
    const started = await (input.startDisposablePostgres ?? startDisposablePostgres)(input.runCommand, input.timestamp);
    candidate = started.candidate;
    startedContainerId = started.containerId;
  }

  const plan = planDurableDogfoodDatabase({ env: input.env, dockerCandidate: candidate, timestamp: input.timestamp });
  return startedContainerId === undefined
    ? plan
    : { ...plan, kind: 'started_container', cleanup: { ...plan.cleanup, removeContainer: true }, containerId: startedContainerId };
};

const removeStartedPostgresContainer = async (plan: DurableDogfoodPlan, runner: CommandRunner): Promise<void> => {
  if (plan.cleanup.removeContainer !== true || plan.containerId === undefined) {
    return;
  }
  await runner('docker', ['rm', '-f', plan.containerId], { timeoutMs: 30_000 });
};

const strictFailureDetails: Record<StrictFailureCode, string> = {
  database_mutation_failed: 'Strict durable database mutation failed before closure could be verified.',
  schema_push_failed: 'Strict durable schema push failed before closure could be verified.',
  reset_failed: 'Strict durable database reset failed before closure could be verified.',
  lifecycle_failed: 'Strict durable release lifecycle failed before closure could be verified.',
  reopen_failed: 'Strict durable release reopen verification failed before closure could be verified.',
  cleanup_failed: 'Strict durable release cleanup failed after verification work ran.',
  strict_flow_failed: 'Strict durable release flow failed before closure could be verified.',
};

const markersWithClosureBlocked = (code: string, detail: string): VerificationMarker[] =>
  requiredReleaseFlowReportMarkers.map((marker) => ({
    marker,
    status: strictReleaseClosureMarkers.includes(marker as (typeof strictReleaseClosureMarkers)[number]) ? 'BLOCKED with reason' : 'PASSED',
    details:
      marker === 'Durable local reset'
        ? [code, detail]
        : marker === 'Strict local_codex run'
          ? ['strict_flow_not_started', 'Strict local Codex evidence was not attempted because strict durable prerequisites were blocked.']
          : ['Deterministic release flow coverage remains available; strict durable lifecycle did not start.'],
  }));

export const failedReleaseFlowMarkersFromError = (
  error: unknown,
  options: {
    code?: StrictFailureCode;
    passedMarkers?: readonly VerificationMarker[];
    failedStrictLocalCodex?: { code: string; message: string };
  } = {},
): VerificationMarker[] => {
  const code = options.code ?? 'strict_flow_failed';
  const safeErrorDetail = (() => {
    if (error === undefined) {
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    const detail = message
      .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')
      .replace(/\/(?:Users|tmp|var|private|home|repo|workspace|opt)\/\S+/gi, '[redacted]');
    try {
      assertNoUnsafeReleaseDogfoodStrings('Strict release failure diagnostic', detail);
      return detail;
    } catch {
      return 'Strict failure diagnostics were redacted.';
    }
  })();
  const passedByMarker = new Map(
    (options.passedMarkers ?? [])
      .filter((marker) => marker.status === 'PASSED')
      .map((marker) => [marker.marker, marker] as const),
  );
  return requiredReleaseFlowReportMarkers.map((marker) => {
    if (marker === 'Strict local_codex run' && options.failedStrictLocalCodex !== undefined) {
      return failedStrictLocalCodexMarker(options.failedStrictLocalCodex.code, options.failedStrictLocalCodex.message);
    }
    const passed = passedByMarker.get(marker);
    if (passed !== undefined && marker !== 'Durable local reset') {
      return passed;
    }
    return {
      marker,
      status: marker === 'Durable local reset' ? 'FAILED' : marker === 'Strict local_codex run' ? 'BLOCKED with reason' : 'BLOCKED with reason',
      details:
        marker === 'Durable local reset'
          ? [code, strictFailureDetails[code], ...(safeErrorDetail === undefined ? [] : [safeErrorDetail])]
        : marker === 'Strict local_codex run'
            ? ['strict_flow_not_started', 'Strict local Codex evidence was not attempted before this strict flow failure.']
            : [code, 'Strict durable release flow stopped before this marker completed.'],
    };
  });
};

const strictRequest = (server: Parameters<typeof request>[0], actorId: string) => ({
  post: (path: string) => request(server).post(path).set(actorHeaderName, actorId),
});

const safeStrictFailureDetails = (code: string, message: string): string[] => {
  const sanitizedMessage = message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')
    .replace(/\/(?:Users|tmp|var|private|home|repo|workspace|opt)\/\S+/gi, '[redacted]')
    .replace(/runtime_metadata|raw_metadata|workspace_path|worktree_path|artifact_path|local_ref|allowed_paths|forbidden_paths/gi, '[redacted]');
  const details = [code, sanitizedMessage];
  try {
    assertNoUnsafeReleaseDogfoodStrings('Strict local Codex failure details', details);
    return details;
  } catch {
    return [code, 'Strict local Codex run failed; unsafe diagnostic details were redacted.'];
  }
};

const blockedStrictLocalCodexMarker = (details: string[]): VerificationMarker => ({
  marker: 'Strict local_codex run',
  status: 'BLOCKED with reason',
  details,
});

const failedStrictLocalCodexMarker = (code: string, message: string): VerificationMarker => ({
  marker: 'Strict local_codex run',
  status: 'FAILED',
  details: safeStrictFailureDetails(code, message),
});

const isStrictLocalCodexProjectionFailure = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('unsafe serialized') ||
    message.includes('public projection') ||
    message.includes('supports/generated_by') ||
    message.includes('strict_reopen_missing_strict_local_codex_links')
  );
};

const strictLocalCodexFailureCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('local_codex_run_terminal_timeout')) {
    return 'local_codex_run_terminal_timeout';
  }
  if (message.includes('local_codex_terminal_failed')) {
    return 'local_codex_terminal_failed';
  }
  if (message.includes('missing_terminal_evidence')) {
    return 'missing_terminal_evidence';
  }
  if (message.includes('missing_public_non_terminal_live_event')) {
    return 'missing_public_non_terminal_live_event';
  }
  if (message.includes('package_not_release_ready')) {
    return 'package_not_release_ready';
  }
  if (message.includes('Review Packet') || message.includes('review')) {
    return 'review_approval_failed';
  }
  if (isStrictLocalCodexProjectionFailure(error)) {
    return 'public_projection_leak';
  }
  return 'strict_local_codex_failed';
};

const requestJsonBody = <T>(response: { body: unknown }): T => response.body as T;

const runReleaseStrictLocalCodexPackage = async (input: {
  server: Parameters<typeof request>[0];
  repository: P0Repository;
  planRevisionId: string;
  releaseId: string;
  projectId: string;
  repoPath: string;
  baseCommitSha: string;
  actorOwner: string;
  actorReviewer: string;
  actorQa: string;
  runWorkerDrain?: () => Promise<void>;
}): Promise<StrictLocalCodexPackageResult> => {
  const packageInput = buildReleaseLocalCodexPackageInput({
    repoPath: input.repoPath,
    baseCommitSha: input.baseCommitSha,
    actorOwner: input.actorOwner,
    actorReviewer: input.actorReviewer,
    actorQa: input.actorQa,
  });
  const executionPackage = requestJsonBody<ExecutionPackage>(
    await strictRequest(input.server, input.actorOwner)
      .post(`/plan-revisions/${input.planRevisionId}/execution-packages`)
      .send(packageInput)
      .expect(201),
  );
  await strictRequest(input.server, input.actorOwner)
    .post(`/execution-packages/${executionPackage.id}/mark-ready`)
    .send({ actor_id: input.actorOwner })
    .expect(201);
  const run = requestJsonBody<{ run_session_id: string }>(
    await strictRequest(input.server, input.actorOwner)
      .post(`/execution-packages/${executionPackage.id}/run`)
      .send({ requested_by_actor_id: input.actorOwner, executor_type: 'local_codex', workflow_only: false })
      .expect(201),
  );
  await input.runWorkerDrain?.();

  let after: string | undefined;
  const observedEvents: ObservedRunEvent[] = [];
  const poll = await pollStrictLocalCodexRunToTerminal({
    getRunSession: async () => {
      const body = requestJsonBody<{ id: string; status: string }>(
        await request(input.server).get(`/run-sessions/${run.run_session_id}`).expect(200),
      );
      return { id: body.id, status: body.status };
    },
    getPublicRunEvents: async () => {
      const body = requestJsonBody<{ events: ObservedRunEvent[] }>(
        await request(input.server)
          .get(
            `/run-sessions/${run.run_session_id}/events?actor_id=${encodeURIComponent(input.actorOwner)}${
              after === undefined ? '' : `&after=${encodeURIComponent(after)}`
            }`,
          )
          .expect(200),
      );
      const events = body.events;
      for (const event of events) {
        observedEvents.push(event);
        if (typeof event.cursor === 'string') {
          after = event.cursor;
        }
      }
      return events.map((event) => ({
        event_type: String(event.event_type ?? ''),
        visibility: event.visibility,
        runStatusAtObservation: event.runStatusAtObservation,
      }));
    },
    timeoutMs: Number(process.env.FORGELOOP_RELEASE_STRICT_LOCAL_CODEX_TIMEOUT_MS ?? 300_000),
    intervalMs: Number(process.env.FORGELOOP_RELEASE_STRICT_LOCAL_CODEX_POLL_MS ?? 1_000),
  });
  if (!poll.observedPublicNonTerminalEvent) {
    throw new Error('missing_public_non_terminal_live_event');
  }
  if (poll.terminal.status !== 'succeeded') {
    throw new Error(`local_codex_terminal_failed: ${poll.terminal.status}`);
  }

  const persistedRun = await input.repository.getRunSession(run.run_session_id);
  if (persistedRun === undefined) {
    throw new Error('missing_terminal_evidence');
  }
  validateLocalCodexRuntimeMetadata(runSessionRuntimeMetadataReport(persistedRun), { expectedRunSessionId: run.run_session_id });
  const reviewPacket = (await input.repository.listReviewPacketsForPackage(executionPackage.id)).find(
    (packet) => packet.run_session_id === run.run_session_id,
  );
  const reviewPacketReference = resolveReviewPacketReference({
    apiUrl: 'http://127.0.0.1',
    runSession: persistedRun as unknown as Record<string, unknown>,
    cockpit: reviewPacket === undefined ? undefined : { review_packets: [{ id: reviewPacket.id }] },
  });
  const terminalEvidence = extractPersistedTerminalEvidence({
    runSession: persistedRun as unknown as Record<string, unknown>,
    reviewPacket: reviewPacketReference,
  });
  if (reviewPacket?.id === undefined) {
    throw new Error('missing_terminal_evidence');
  }
  await strictRequest(input.server, input.actorReviewer)
    .post(`/review-packets/${reviewPacket.id}/approve`)
    .send({
      summary: 'Strict local Codex dogfood evidence approved.',
      reviewed_by_actor_id: input.actorReviewer,
      reviewed_at: new Date().toISOString(),
    })
    .expect(201);
  const strictPackage = requestJsonBody<ExecutionPackage>(
    await request(input.server).get(`/execution-packages/${executionPackage.id}`).expect(200),
  );
  if (
    strictPackage.phase !== 'release' ||
    strictPackage.gate_state !== 'release_ready' ||
    strictPackage.resolution !== 'completed'
  ) {
    throw new Error('package_not_release_ready');
  }

  const summary = publicStrictLocalCodexEvidenceSummary({
    runSessionId: run.run_session_id,
    changedFileCount: terminalEvidence.changed_files?.length ?? 0,
    checkCount: terminalEvidence.check_results?.length ?? 0,
    artifactKinds: (terminalEvidence.artifacts ?? []).map((artifact) => String(artifact.kind ?? 'unknown')),
    reviewPacketAvailable: true,
  });
  assertNoUnsafeReleaseDogfoodStrings('Strict local Codex public summary', summary);
  assertNoUnsafeReleaseDogfoodStrings('Strict local Codex public events', observedEvents);

  return {
    marker: {
      marker: 'Strict local_codex run',
      status: 'PASSED',
      details: ['Created, ran, approved, and linked public-safe strict local Codex evidence.'],
    },
    packageId: executionPackage.id,
    runSessionId: run.run_session_id,
    reviewPacketId: reviewPacket.id,
    summary,
  };
};

export const runDurableReleaseLifecycle = async (input: {
  app: Pick<INestApplication, 'getHttpServer'>;
  repository: P0Repository;
  identity: ReturnType<typeof buildDurableReleaseDogfoodIdentity>;
  env?: Env;
  deps?: StrictLocalCodexLifecycleDeps;
}): Promise<StrictLifecycleResult> => {
  const { app, repository, identity } = input;
  const { owner, reviewer, qa } = identity.actors;
  const server = app.getHttpServer();
  const env = input.env ?? {};
  const deps = input.deps ?? {};
  const effectiveRunCommand = deps.runCommand ?? runCommand;
  const strictLocalCodexEnabled = shouldAttemptReleaseStrictLocalCodex(env);
  const repoPath = strictLocalCodexEnabled ? resolve(env.FORGELOOP_REPO_PATH ?? process.cwd()) : '/workspace/forgeloop';
  const baseCommitSha = strictLocalCodexEnabled
    ? (
        await effectiveRunCommand('git', ['rev-parse', env.FORGELOOP_BASE_COMMIT_SHA ?? 'HEAD'], {
          cwd: repoPath,
          timeoutMs: 15_000,
        })
      ).stdout.trim()
    : 'strict-dogfood-base';

  await repository.saveOrganization(identity.organization);
  await repository.saveActor(owner);
  await repository.saveActor(reviewer);
  await repository.saveActor(qa);
  await repository.saveProject(identity.project);

  await strictRequest(server, owner.id)
    .post(`/projects/${identity.project.id}/repos`)
    .send({
      repo_id: 'forgeloop-source',
      name: 'forgeloop',
      local_path: strictLocalCodexEnabled ? repoPath : '/workspace/forgeloop',
      default_branch: 'main',
      base_commit_sha: strictLocalCodexEnabled ? baseCommitSha : 'strict-dogfood-base',
    })
    .expect(201);
  const workItem = (
    await strictRequest(server, owner.id)
      .post('/work-items')
      .send({
        project_id: identity.project.id,
        kind: 'requirement',
        title: 'Strict durable release flow',
        goal: 'Validate Release flow through durable public APIs.',
        success_criteria: ['Release can be approved, observed, closed, and replayed after reopen.'],
        priority: 'P1',
        risk: 'medium',
        owner_actor_id: owner.id,
      })
      .expect(201)
  ).body as WorkItem;
  const spec = (await strictRequest(server, owner.id).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body as { id: string };
  await strictRequest(server, owner.id)
    .post(`/specs/${spec.id}/revisions`)
    .send({
      summary: 'Strict durable release spec',
      content: 'Validate durable release ownership and evidence.',
      background: 'Strict dogfood needs durable UUID actors.',
      goals: ['Approve and close release after durable writes'],
      scope_in: ['Release public APIs'],
      scope_out: ['Real local_codex execution'],
      acceptance_criteria: ['Fresh app can query cockpit and replay'],
      test_strategy_summary: 'Run strict dogfood against durable storage.',
      author_actor_id: owner.id,
    })
    .expect(201);
  await strictRequest(server, owner.id).post(`/specs/${spec.id}/submit-for-approval`).send({ actor_id: owner.id }).expect(201);
  await strictRequest(server, reviewer.id).post(`/specs/${spec.id}/approve`).send({ actor_id: reviewer.id }).expect(201);

  const plan = (await strictRequest(server, owner.id).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body as { id: string };
  const planRevision = (
    await strictRequest(server, owner.id)
      .post(`/plans/${plan.id}/revisions`)
      .send({
        summary: 'Strict durable release plan',
        content: 'Create one package and seed release-ready evidence.',
        implementation_summary: 'Use public APIs and seeded UUID actors.',
        split_strategy: 'One package',
        dependency_order: [],
        test_matrix: ['pnpm dogfood:release-flow:strict'],
        rollback_notes: 'Drop the disposable dogfood database.',
        author_actor_id: owner.id,
      })
      .expect(201)
  ).body as { id: string };
  await strictRequest(server, owner.id).post(`/plans/${plan.id}/submit-for-approval`).send({ actor_id: owner.id }).expect(201);
  await strictRequest(server, reviewer.id).post(`/plans/${plan.id}/approve`).send({ actor_id: reviewer.id }).expect(201);
  const executionPackage = (
    await strictRequest(server, owner.id)
      .post(`/plan-revisions/${planRevision.id}/execution-packages`)
      .send({
        repo_id: 'forgeloop-source',
        objective: 'Strict durable release package.',
        owner_actor_id: owner.id,
        reviewer_actor_id: reviewer.id,
        qa_owner_actor_id: qa.id,
        required_checks: [requiredCheck],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['README.md'],
        forbidden_paths: ['.git'],
      })
      .expect(201)
  ).body as ExecutionPackage;
  await strictRequest(server, owner.id)
    .post(`/execution-packages/${executionPackage.id}/mark-ready`)
    .send({ actor_id: owner.id })
    .expect(201);

  const seeded = await seedDurableReleaseReadyPackageEvidence(repository, executionPackage, {
    ownerActorId: owner.id,
    reviewerActorId: reviewer.id,
    at: new Date().toISOString(),
  });

  const release = (
    await strictRequest(server, owner.id)
      .post('/releases')
      .send({
        actor_id: owner.id,
        project_id: identity.project.id,
        title: 'Strict durable release dogfood',
        scope_summary: 'Strict durable release flow verification.',
        rollout_strategy: 'Internal dogfood only.',
        rollback_plan: 'Drop dogfood database.',
        observation_plan: 'Verify cockpit and replay after reopen.',
      })
      .expect(201)
  ).body as { release: { id: string } };
  const releaseId = release.release.id;
  await strictRequest(server, owner.id).post(`/releases/${releaseId}/work-items/${seeded.workItem.id}`).send({ actor_id: owner.id }).expect(201);
  const seededPackageLink = await strictRequest(server, owner.id)
    .post(`/releases/${releaseId}/execution-packages/${seeded.executionPackage.id}`)
    .send({ actor_id: owner.id });
  if (seededPackageLink.status !== 201) {
    throw new Error(`link_seeded_execution_package_failed_${seededPackageLink.status}: ${seededPackageLink.text}`);
  }
  let strictLocalCodex: StrictLifecycleResult['strictLocalCodex'];
  let strictLocalCodexMarker: VerificationMarker;
  const enablement = evaluateLocalCodexDogfoodEnablement(env);
  if (!enablement.enabled) {
    strictLocalCodexMarker = blockedStrictLocalCodexMarker([enablement.message]);
  } else {
    const preflight = await (deps.preflightStrictLocalCodex ?? ((args) =>
      preflightLocalCodexDogfood({
        env: args.env,
        repoPath: args.repoPath,
        runCommand: args.runCommand,
        dirtyAllowlist: releaseStrictDirtyAllowlist,
        dirtyAllowlistSource: 'RELEASE_STRICT_DIRTY_ALLOWLIST',
      })))({
      env,
      repoPath,
      runCommand: effectiveRunCommand,
    });
    if (!preflight.ok) {
      strictLocalCodexMarker = blockedStrictLocalCodexMarker(sanitizeStrictPreflightBlockerDetails(preflight));
    } else {
      try {
        const strictResult = await (deps.runStrictLocalCodexPackage ?? runReleaseStrictLocalCodexPackage)({
          server,
          repository,
          planRevisionId: planRevision.id,
          releaseId,
          projectId: identity.project.id,
          repoPath,
          baseCommitSha,
          actorOwner: owner.id,
          actorReviewer: reviewer.id,
          actorQa: qa.id,
          runWorkerDrain: deps.runWorkerDrain,
        });
        if (strictResult.marker.status === 'PASSED') {
          if (
            strictResult.packageId === undefined ||
            strictResult.runSessionId === undefined ||
            strictResult.reviewPacketId === undefined ||
            strictResult.summary === undefined
          ) {
            throw new Error('missing_terminal_evidence');
          }
          await strictRequest(server, owner.id)
            .post(`/releases/${releaseId}/execution-packages/${strictResult.packageId}`)
            .send({ actor_id: owner.id })
            .expect(201);
          strictLocalCodex = {
            executionPackageId: strictResult.packageId,
            runSessionId: strictResult.runSessionId,
            reviewPacketId: strictResult.reviewPacketId,
            summary: strictResult.summary,
          };
        }
        strictLocalCodexMarker = strictResult.marker;
      } catch (error) {
        strictLocalCodexMarker = failedStrictLocalCodexMarker(
          strictLocalCodexFailureCode(error),
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
  await strictRequest(server, owner.id).post(`/releases/${releaseId}/submit-for-approval`).send({ actor_id: owner.id }).expect(201);
  await strictRequest(server, reviewer.id)
    .post(`/releases/${releaseId}/approve`)
    .send({ actor_id: reviewer.id, rationale: 'Strict durable release evidence is complete.' })
    .expect(201);
  await strictRequest(server, owner.id).post(`/releases/${releaseId}/start-observing`).send({ actor_id: owner.id }).expect(201);
  await strictRequest(server, owner.id)
    .post(`/releases/${releaseId}/evidences`)
    .send({
      actor_id: owner.id,
      evidence_type: 'observation_note',
      summary: 'Strict durable release observation is healthy.',
      extra: {
        observation: {
          source: 'script',
          severity: 'info',
          observed_at: new Date().toISOString(),
          summary: 'Fresh app and repository reopen verification is ready.',
          links: [
            { object_type: 'release', object_id: releaseId, relationship: 'observed' },
            { object_type: 'execution_package', object_id: seeded.executionPackage.id, relationship: 'supports' },
            { object_type: 'run_session', object_id: seeded.runSession.id, relationship: 'generated_by' },
          ],
        },
      },
    })
    .expect(201);
  if (strictLocalCodex !== undefined) {
    await strictRequest(server, owner.id)
      .post(`/releases/${releaseId}/evidences`)
      .send({
        actor_id: owner.id,
        evidence_type: 'observation_note',
        summary: 'Strict local Codex release evidence is public-safe and approved.',
        extra: {
          observation: {
            source: 'script',
            severity: 'info',
            observed_at: new Date().toISOString(),
            summary: `Strict local Codex run ${strictLocalCodex.runSessionId} completed with approved public evidence.`,
            metrics: {
              changed_file_count: strictLocalCodex.summary.changed_file_count,
              check_count: strictLocalCodex.summary.check_count,
              review_packet_available: strictLocalCodex.summary.review_packet_available,
            },
            notes: `artifact_kinds=${strictLocalCodex.summary.artifact_kinds.join(',')}`,
            links: buildReleaseStrictObservationLinks({
              releaseId,
              executionPackageId: strictLocalCodex.executionPackageId,
              runSessionId: strictLocalCodex.runSessionId,
            }),
          },
        },
      })
      .expect(201);
  }
  await strictRequest(server, owner.id)
    .post(`/releases/${releaseId}/close`)
    .send({ actor_id: owner.id, resolution: 'completed', summary: 'Strict durable release dogfood closed.' })
    .expect(201);

  return {
    releaseId,
    projectId: identity.project.id,
    workItemId: seeded.workItem.id,
    executionPackageId: seeded.executionPackage.id,
    runSessionId: seeded.runSession.id,
    reviewPacketId: seeded.reviewPacket.id,
    ...(strictLocalCodex === undefined ? {} : { strictLocalCodex }),
    markers: [
      {
        marker: 'P0 delivery path',
        status: 'PASSED',
        details: ['Created strict durable WorkItem, Spec, Plan, and ExecutionPackage through public P0 APIs.'],
      },
      {
        marker: 'Release create/link/submit',
        status: 'PASSED',
        details: ['Created, linked, and submitted a strict durable Release through public APIs.'],
      },
      {
        marker: 'Release approval or override approval',
        status: 'PASSED',
        details: ['Approved strict durable Release with seeded UUID actors.'],
      },
      {
        marker: 'Release observing/close',
        status: 'PASSED',
        details: ['Observed and closed strict durable Release through public APIs.'],
      },
      strictLocalCodexMarker,
    ],
  };
};

export const verifyDurableReleaseAfterReopen = async (input: {
  app: Pick<INestApplication, 'getHttpServer'>;
  repository: P0Repository;
  releaseId: string;
  lifecycle: StrictLifecycleResult;
}): Promise<void> => {
  const release = await input.repository.getRelease(input.releaseId);
  if (
    release === undefined ||
    release.phase !== 'completed' ||
    release.resolution !== 'completed' ||
    typeof release.closed_at !== 'string'
  ) {
    throw new Error('strict_reopen_missing_release');
  }
  if (
    input.lifecycle.workItemId !== undefined &&
    !(await input.repository.listReleaseWorkItems(input.releaseId)).some((link) => link.work_item_id === input.lifecycle.workItemId)
  ) {
    throw new Error('strict_reopen_missing_work_item_link');
  }
  if (
    input.lifecycle.executionPackageId !== undefined &&
    !(await input.repository.listReleaseExecutionPackages(input.releaseId)).some(
      (link) => link.execution_package_id === input.lifecycle.executionPackageId,
    )
  ) {
    throw new Error('strict_reopen_missing_package_link');
  }
  const decisions = await input.repository.listDecisionsForObject('release', input.releaseId);
  if (!decisions.some((decision) => decision.decision_type === 'release_approval')) {
    throw new Error('strict_reopen_missing_release_approval_decision');
  }
  if (!decisions.some((decision) => decision.decision_type === 'release_close')) {
    throw new Error('strict_reopen_missing_release_close_decision');
  }
  const evidence = await input.repository.listReleaseEvidences(input.releaseId);
  if (
    !evidence.some(
      (item) =>
        item.evidence_type === 'observation_note' &&
        typeof (item.extra as { observation?: { summary?: unknown } } | undefined)?.observation?.summary === 'string',
    )
  ) {
    throw new Error('strict_reopen_missing_observation_evidence');
  }
  const executionPackage =
    input.lifecycle.executionPackageId === undefined
      ? undefined
      : await input.repository.getExecutionPackage(input.lifecycle.executionPackageId);
  if (executionPackage === undefined) {
    throw new Error('strict_reopen_missing_package');
  }
  if (
    executionPackage.phase !== 'release' ||
    executionPackage.gate_state !== 'release_ready' ||
    executionPackage.resolution !== 'completed'
  ) {
    throw new Error('strict_reopen_package_not_release_ready');
  }
  if (input.lifecycle.runSessionId !== undefined && (await input.repository.getRunSession(input.lifecycle.runSessionId))?.status !== 'succeeded') {
    throw new Error('strict_reopen_missing_succeeded_run');
  }
  const reviewPacket =
    input.lifecycle.reviewPacketId === undefined ? undefined : await input.repository.getReviewPacket(input.lifecycle.reviewPacketId);
  if (reviewPacket === undefined || reviewPacket.decision !== 'approved' || reviewPacket.status !== 'completed') {
    throw new Error('strict_reopen_missing_approved_review');
  }
  if (input.lifecycle.strictLocalCodex !== undefined) {
    const hasStrictLinks = evidence.some((item) => {
      const links = (item.extra as { observation?: { links?: Array<{ object_id?: string; relationship?: string }> } } | undefined)?.observation?.links;
      return (
        Array.isArray(links) &&
        links.some(
          (link) =>
            link.object_id === input.lifecycle.strictLocalCodex?.executionPackageId &&
            link.relationship === 'supports',
        ) &&
        links.some(
          (link) =>
            link.object_id === input.lifecycle.strictLocalCodex?.runSessionId &&
            link.relationship === 'generated_by',
        )
      );
    });
    if (!hasStrictLinks) {
      throw new Error('strict_reopen_missing_strict_local_codex_links');
    }
  }

  const server = input.app.getHttpServer();
  const cockpit = (await request(server).get(`/query/release-cockpit/${input.releaseId}`).expect(200)).body as JsonRecord;
  const replay = (await request(server).get(`/query/replay/release/${input.releaseId}`).expect(200)).body;
  assertNoUnsafeReleaseDogfoodStrings('Strict release cockpit query', cockpit);
  assertObservationBacklinkProjected(cockpit, input.releaseId);
  assertNoUnsafeReleaseDogfoodStrings('Strict release replay', replay);
  if (input.lifecycle.strictLocalCodex !== undefined) {
    assertStrictLocalCodexPublicProjection(cockpit, replay, input.lifecycle.strictLocalCodex);
  }
};

const cleanupStrictReleaseFlowDogfood = async (input: {
  freshApp?: Pick<INestApplication, 'close'>;
  freshClient?: StrictDbClient;
  firstApp?: Pick<INestApplication, 'close'>;
  firstClient?: StrictDbClient;
  plan: DurableDogfoodPlan;
  dropDatabase: (plan: DurableDogfoodPlan) => Promise<void>;
  runCommand: CommandRunner;
}): Promise<StrictFailureCode[]> => {
  const failures: StrictFailureCode[] = [];
  const attempt = async (cleanup: () => Promise<void>): Promise<void> => {
    try {
      await cleanup();
    } catch {
      failures.push('cleanup_failed');
    }
  };

  if (input.freshApp !== undefined) {
    await attempt(() => input.freshApp!.close());
  }
  if (input.freshClient !== undefined) {
    await attempt(() => input.freshClient!.pool.end());
  }
  if (input.firstApp !== undefined) {
    await attempt(() => input.firstApp!.close());
  }
  if (input.firstClient !== undefined) {
    await attempt(() => input.firstClient!.pool.end());
  }
  await attempt(() => input.dropDatabase(input.plan));
  await attempt(() => removeStartedPostgresContainer(input.plan, input.runCommand));

  return failures;
};

export const runStrictReleaseFlowDogfood = async (input: StrictReleaseFlowDogfoodInput): Promise<VerificationMarker[]> => {
  const deps = input.deps ?? {};
  const timestamp = deps.nowMs?.() ?? Date.now();
  const effectiveRunCommand = deps.runCommand ?? runCommand;
  let plan: DurableDogfoodPlan | undefined;
  try {
    plan =
      deps.planDatabase?.({ env: input.env, timestamp }) ??
      (await planStrictReleaseDogfoodDatabase({
        env: input.env,
        timestamp,
        runCommand: effectiveRunCommand,
        ...(deps.inspectDockerPostgres === undefined ? {} : { inspectDockerPostgres: deps.inspectDockerPostgres }),
        ...(deps.startDisposablePostgres === undefined ? {} : { startDisposablePostgres: deps.startDisposablePostgres }),
      }));
    (deps.prepareSafeDatabaseTarget ?? prepareSafeDatabaseTarget)(plan);
  } catch {
    if (plan !== undefined) {
      const cleanupFailures = await cleanupStrictReleaseFlowDogfood({
        plan,
        dropDatabase: deps.dropDatabase ?? dropDatabase,
        runCommand: effectiveRunCommand,
      });
      if (cleanupFailures.length > 0) {
        const cleanupMarkers = failedReleaseFlowMarkersFromError(undefined, { code: 'cleanup_failed' });
        assertNoUnsafeReleaseDogfoodStrings('Strict release prepare cleanup failed markers', cleanupMarkers);
        return cleanupMarkers;
      }
    }
    const markers = markersWithClosureBlocked('missing_database', 'No safe durable Postgres target was available for strict dogfood.');
    assertNoUnsafeReleaseDogfoodStrings('Strict release blocked markers', markers);
    return markers;
  }
  if (plan === undefined) {
    const markers = markersWithClosureBlocked('missing_database', 'No safe durable Postgres target was available for strict dogfood.');
    assertNoUnsafeReleaseDogfoodStrings('Strict release blocked markers', markers);
    return markers;
  }
  const strictPlan = plan;

  let firstClient: StrictDbClient | undefined;
  let firstApp: Pick<INestApplication, 'close' | 'getHttpServer'> | undefined;
  let freshClient: StrictDbClient | undefined;
  let freshApp: Pick<INestApplication, 'close' | 'getHttpServer'> | undefined;
  let markers: VerificationMarker[] | undefined;
  let failureCode: StrictFailureCode = 'strict_flow_failed';
  let lifecycleMarkers: VerificationMarker[] = [];
  let lifecycleResult: StrictLifecycleResult | undefined;

  try {
    failureCode = 'database_mutation_failed';
    await (deps.createDatabase ?? createDatabase)(strictPlan);
    failureCode = 'schema_push_failed';
    await (deps.pushSchema ?? pushSchema)({ databaseUrl: strictPlan.databaseUrl, runCommand: effectiveRunCommand });
    failureCode = 'reset_failed';
    await (deps.resetDatabase ?? resetDatabase)(strictPlan.databaseUrl);

    failureCode = 'lifecycle_failed';
    firstClient = (deps.createDbClient ?? ((args) => createDbClient({ connectionString: args.connectionString })))({
      connectionString: strictPlan.databaseUrl,
    });
    const firstRepository = (deps.createRepository ?? ((db) => createDrizzleP0Repository(db as DbClient['db'])))(firstClient.db);
    const identity = buildDurableReleaseDogfoodIdentity(new Date().toISOString());
    const first = await (deps.createDurableApp ?? createDurableReleaseDogfoodApp)(firstRepository, {
      useRealWorker: shouldAttemptReleaseStrictLocalCodex(input.env),
    });
    firstApp = first.app;
    const lifecycle = await (deps.runDurableReleaseLifecycle ?? runDurableReleaseLifecycle)({
      app: firstApp,
      repository: firstRepository,
      identity,
      env: input.env,
      deps: {
        runCommand: effectiveRunCommand,
        ...(deps.preflightStrictLocalCodex === undefined ? {} : { preflightStrictLocalCodex: deps.preflightStrictLocalCodex }),
        ...(deps.runStrictLocalCodexPackage === undefined ? {} : { runStrictLocalCodexPackage: deps.runStrictLocalCodexPackage }),
        runWorkerDrain: deps.runWorkerDrain ?? first.runWorker?.drainOnce.bind(first.runWorker),
      },
    });
    lifecycleResult = lifecycle;
    lifecycleMarkers = lifecycle.markers;
    failureCode = 'cleanup_failed';
    await firstApp.close();
    firstApp = undefined;
    await firstClient.pool.end();
    firstClient = undefined;

    failureCode = 'reopen_failed';
    freshClient = (deps.reopenDbClient ?? deps.createDbClient ?? ((args) => createDbClient({ connectionString: args.connectionString })))({
      connectionString: strictPlan.databaseUrl,
    });
    const freshRepository = (deps.createFreshRepository ?? deps.createRepository ?? ((db) => createDrizzleP0Repository(db as DbClient['db'])))(
      freshClient.db,
    );
    const fresh = await (deps.createFreshDurableApp ?? deps.createDurableApp ?? createDurableReleaseDogfoodApp)(freshRepository, {
      useRealWorker: false,
    });
    freshApp = fresh.app;
    await (deps.verifyDurableReleaseAfterReopen ?? verifyDurableReleaseAfterReopen)({
      app: freshApp,
      repository: freshRepository,
      releaseId: lifecycle.releaseId,
      lifecycle,
    });

    const strictLocalCodexMarker =
      lifecycle.markers.find((marker) => marker.marker === 'Strict local_codex run') ??
      blockedStrictLocalCodexMarker(['local_codex_missing_marker']);
    markers = [
      ...lifecycle.markers.filter((marker) => marker.marker !== 'Strict local_codex run'),
      {
        marker: 'Release cockpit query',
        status: 'PASSED',
        details: ['Fetched strict durable cockpit through a fresh app and repository after reopen.'],
      },
      {
        marker: 'Release replay redaction',
        status: 'PASSED',
        details: ['Fetched strict durable replay through a fresh app and verified public redaction.'],
      },
      {
        marker: 'Release observation backlink projection',
        status: 'PASSED',
        details: ['Verified strict durable Release evidence remains queryable after reopen.'],
      },
      {
        marker: 'Durable local reset',
        status: 'PASSED',
        details: ['Reset durable storage and verified Release closure through a fresh app/repository boundary.'],
      },
      strictLocalCodexMarker,
    ];
    assertNoUnsafeReleaseDogfoodStrings('Strict release markers', markers);
  } catch (error) {
    const shouldFailStrictLocalCodex =
      failureCode === 'reopen_failed' && lifecycleResult?.strictLocalCodex !== undefined && isStrictLocalCodexProjectionFailure(error);
    markers = failedReleaseFlowMarkersFromError(error, {
      code: failureCode,
      passedMarkers: lifecycleMarkers,
      ...(shouldFailStrictLocalCodex
        ? {
            failedStrictLocalCodex: {
              code: strictLocalCodexFailureCode(error),
              message: error instanceof Error ? error.message : String(error),
            },
          }
        : {}),
    });
    assertNoUnsafeReleaseDogfoodStrings('Strict release failed markers', markers);
  } finally {
    const cleanupFailures = await cleanupStrictReleaseFlowDogfood({
      freshApp,
      freshClient,
      firstApp,
      firstClient,
      plan: strictPlan,
      dropDatabase: deps.dropDatabase ?? dropDatabase,
      runCommand: effectiveRunCommand,
    });
    if (cleanupFailures.length > 0) {
      markers = failedReleaseFlowMarkersFromError(undefined, {
        code: 'cleanup_failed',
        passedMarkers: (markers ?? lifecycleMarkers).filter((marker) => marker.status === 'PASSED'),
      });
      assertNoUnsafeReleaseDogfoodStrings('Strict release cleanup failed markers', markers);
    }
  }
  return markers ?? failedReleaseFlowMarkersFromError(undefined);
};

export const runDeterministicReleaseFlowDogfood = async (): Promise<VerificationMarker[]> => {
  const { app, repository } = await createDogfoodApp();
  try {
    const { projectId, workItem, executionPackage } = await createP0DeliveryPath(app, repository);
    const server = app.getHttpServer();
    const markers: VerificationMarker[] = [
      {
        marker: 'P0 delivery path',
        status: 'PASSED',
        details: [`Created Project ${projectId}, WorkItem ${workItem.id}, Spec, Plan, and ExecutionPackage ${executionPackage.id}.`],
      },
    ];

    const release = (
      await request(server)
        .post('/releases')
        .send({
          actor_id: actorOwner,
          project_id: projectId,
          title: 'P1 Release Risk Radar dogfood',
          scope_summary: 'Dogfood the Release command surface, cockpit, and replay.',
          rollback_plan: 'Disable the Release Owner workbench entry point and revert the release module changes.',
          observation_plan: 'Check release cockpit observations and replay redaction after rollout.',
        })
        .expect(201)
    ).body as { release: { id: string } };
    const releaseId = release.release.id;

    await request(server).post(`/releases/${releaseId}/work-items/${workItem.id}`).send({ actor_id: actorOwner }).expect(201);
    await request(server)
      .post(`/releases/${releaseId}/execution-packages/${executionPackage.id}`)
      .send({ actor_id: actorOwner })
      .expect(201);
    const submitted = (
      await request(server).post(`/releases/${releaseId}/submit-for-approval`).send({ actor_id: actorOwner }).expect(201)
    ).body as JsonRecord;
    markers.push({
      marker: 'Release create/link/submit',
      status: 'PASSED',
      details: [`Created Release ${releaseId}, linked WorkItem and ExecutionPackage, and submitted for approval.`],
    });

    const approved = await approveOrOverride(app, releaseId, submitted);
    markers.push({
      marker: 'Release approval or override approval',
      status: 'PASSED',
      details: [`Release moved through ${approved.mode} with a matching blocker snapshot.`],
    });

    await request(server).post(`/releases/${releaseId}/start-observing`).send({ actor_id: actorOwner }).expect(201);
    await request(server)
      .post(`/releases/${releaseId}/evidences`)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Release flow dogfood observation is healthy.',
        extra: {
          observation: {
            source: 'script',
            severity: 'info',
            observed_at: later,
            summary: 'Release cockpit and replay are available after approval.',
            links: [
              { object_type: 'release', object_id: releaseId, relationship: 'observed' },
              { object_type: 'work_item', object_id: workItem.id, relationship: 'affected' },
              { object_type: 'run_session', object_id: 'release-flow-dogfood-run-session', relationship: 'generated_by' },
            ],
          },
        },
      })
      .expect(201);
    await request(server)
      .post(`/releases/${releaseId}/close`)
      .send({ actor_id: actorOwner, resolution: 'completed', summary: 'Dogfood observation completed cleanly.' })
      .expect(201);
    markers.push({
      marker: 'Release observing/close',
      status: 'PASSED',
      details: ['Started observing, added public observation evidence, and closed the Release as completed.'],
    });

    const cockpit = (await request(server).get(`/query/release-cockpit/${releaseId}`).expect(200)).body as JsonRecord;
    assertNoUnsafeReleaseDogfoodStrings('Release cockpit query', cockpit);
    markers.push({
      marker: 'Release cockpit query',
      status: 'PASSED',
      details: ['Fetched /query/release-cockpit/:releaseId and verified unsafe internals are absent.'],
    });

    const replay = (await request(server).get(`/query/replay/release/${releaseId}`).expect(200)).body;
    assertNoUnsafeReleaseDogfoodStrings('Release replay', replay);
    assertOverrideBlockerFactsProjected(cockpit, replay);
    markers.push({
      marker: 'Release replay redaction',
      status: 'PASSED',
      details: ['Fetched /query/replay/release/:releaseId and verified unsafe internals are absent.'],
    });

    assertObservationBacklinkProjected(cockpit, releaseId);
    markers.push({
      marker: 'Release observation backlink projection',
      status: 'PASSED',
      details: ['Verified extra.observation.links projects a public Release backlink in cockpit observations.'],
    });

    markers.push(
      {
        marker: 'Durable local reset',
        status: 'BLOCKED with reason',
        details: ['This deterministic script uses the in-memory repository and did not reset a local durable database.'],
      },
      {
        marker: 'Strict local_codex run',
        status: 'BLOCKED with reason',
        details: ['This deterministic script does not invoke the opt-in local_codex executor in the current environment.'],
      },
    );
    return markers;
  } finally {
    await app.close();
  }
};

export const renderReleaseFlowVerificationReport = (markers: readonly VerificationMarker[]): string => {
  const generatedAt = new Date().toISOString();
  const markerSections = requiredReleaseFlowReportMarkers.map((marker) => {
    const result = markers.find((item) => item.marker === marker);
    if (result === undefined) {
      throw new Error(`Release flow report is missing required marker: ${marker}`);
    }
    return [`## ${marker}`, '', `Status: ${result.status}`, '', ...result.details.map((detail) => `- ${detail}`)].join('\n');
  });

  const report = [
    '# P1 Release Risk Radar Verification',
    '',
    `Generated at: ${generatedAt}`,
    '',
    'This report is generated by Forgeloop release-flow dogfood scripts using public Release verification markers.',
    '',
    ...markerSections,
    '',
  ].join('\n');
  assertNoUnsafeReleaseDogfoodStrings('Release verification report', report);
  return report;
};
