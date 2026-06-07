import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExecutorResult, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { AutomationCommandService } from '../../apps/control-plane-api/src/modules/automation/automation-command.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { ExecutionPackageService } from '../../apps/control-plane-api/src/modules/execution-packages/execution-package.service';
import { ProjectService } from '../../apps/control-plane-api/src/modules/projects/project.service';
import { ReviewEvidenceService } from '../../apps/control-plane-api/src/modules/review-evidence/review-evidence.service';
import { RunControlService } from '../../apps/control-plane-api/src/modules/run-control/run-control.service';
import { RunWorkerLifecycleService } from '../../apps/control-plane-api/src/modules/run-control/run-worker-lifecycle.service';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { SpecPlanService } from '../../apps/control-plane-api/src/modules/spec-plan/spec-plan.service';
import { WorkItemService } from '../../apps/control-plane-api/src/modules/work-items/work-item.service';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  transitionExecutionPackage,
  transitionReviewPacket,
  transitionRunSession,
  type CodexRuntimeProfileRevision,
} from '../../packages/domain/src';
import { InMemoryDeliveryRepository } from '../../packages/db/src/index';
import type { ExecutionPackage, ReviewPacket, RunSession } from '../../packages/domain/src/index';
import { FakeCodexSessionDriver, RunWorker } from '../../packages/run-worker/src';
import { seedItemScopedSpecPlan } from '../helpers/item-scoped-artifact-fixtures';
import { succeededSelfReview } from '../helpers/delivery-runtime-fixtures';
import { createWorkflowPolicyRepoRoot } from '../helpers/runtime-policy-repo';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const ownerHeaders = {
  'x-forgeloop-actor-id': actorOwner,
  'x-forgeloop-actor-class': 'human_admin',
};
const reviewerHeaders = {
  'x-forgeloop-actor-id': actorReviewer,
  'x-forgeloop-actor-class': 'human',
};
const requirementIntakeContext = {
  type: 'requirement',
  stakeholder_problem: 'Delivery operators need a complete command surface.',
  desired_outcome: 'Spec, plan, package, run, and review commands are available over REST.',
  acceptance_criteria: ['Spec, plan, package, run, and review commands are available.'],
  in_scope: ['Control plane API delivery flow'],
} as const;

const requiredChecks = [
  {
    check_id: 'unit',
    display_name: 'Unit tests',
    command: 'pnpm test tests/api',
    timeout_seconds: 120,
    blocks_review: true,
  },
];

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : 'artifact';
};

const evidenceChangedFilePath = (allowedPaths: string[]): string => {
  const firstAllowedPath = allowedPaths[0] ?? 'forgeloop-generated.txt';
  return firstAllowedPath.replace(/\/\*\*$/, '/forgeloop-generated.txt').replace(/\*+$/, 'forgeloop-generated.txt');
};

const mockSelfReview = (input: SelfReviewInput): SelfReviewResult => ({
  status: 'succeeded',
  summary: `Mock self-review completed for run ${input.run_session_id}.`,
  spec_plan_alignment: 'The mock run uses the approved spec and plan revision ids.',
  test_assessment: `${input.check_results.length} required checks were reported.`,
  risk_notes: [],
  follow_up_questions: [],
});

const mockEvidence = (input: Parameters<ConstructorParameters<typeof RunWorker>[0]['evidenceCollector']>[0]): ExecutorResult => ({
  run_session_id: input.runSpec.run_session_id,
  executor_type: input.runSpec.executor_type,
  executor_version: 'delivery-flow-test-driver',
  status: 'succeeded',
  started_at: input.startedAt,
  finished_at: input.startedAt,
  summary: input.summary,
  changed_files: [
    {
      repo_id: input.runSpec.repo.repo_id,
      path: evidenceChangedFilePath(input.runSpec.allowed_paths),
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
    local_ref: `/tmp/forgeloop-delivery-flow/${safePathSegment(input.runSpec.run_session_id)}/${kind}.txt`,
  })),
  raw_metadata: { workflow_only: input.runSpec.workflow_only },
});

class ManualDrainRunWorker extends RunWorker {
  override kick(): void {
    return undefined;
  }
}

const createTestRunWorker = (repository: InMemoryDeliveryRepository): RunWorker =>
  new ManualDrainRunWorker({
    repository,
    workerId: 'delivery-flow-test-worker',
    driverFactory: () =>
      new FakeCodexSessionDriver({
        kind: 'fake',
        script: [{ kind: 'terminal', status: 'succeeded', summary: 'Test fake driver completed.' }],
      }),
    evidenceCollector: (input) => Promise.resolve(mockEvidence(input)),
    selfReview: (input) => Promise.resolve(mockSelfReview(input)),
    heartbeatIntervalMs: 1,
    commandPollIntervalMs: 1,
    leaseDurationMs: 1_000,
    idleThresholdMs: 1_000,
    artifactRoot: '/tmp/forgeloop-delivery-flow',
  });

const createProjectRepoWorkItem = async (app: INestApplication) => {
  const server = app.getHttpServer();
  const project = (
    await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorOwner }).expect(201)
  ).body;
  const repo = (
    await request(server)
      .post(`/projects/${project.id}/repos`)
      .send({
        repo_id: 'repo-1',
        name: 'forgeloop',
        local_path: await createWorkflowPolicyRepoRoot(),
        default_branch: 'main',
        base_commit_sha: 'abc123',
      })
      .expect(201)
  ).body;
  const workItem = (
    await request(server)
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'requirement',
        title: 'Ship delivery control plane API',
        goal: 'Expose the delivery loop commands over REST.',
        success_criteria: ['Spec, plan, package, run, and review commands are available.'],
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: actorOwner,
        intake_context: requirementIntakeContext,
      })
      .expect(201)
  ).body;

  return { project, repo, workItem };
};

const approveSpec = async (app: INestApplication, workItemId: string) => {
  const { spec, specRevision } = await seedItemScopedSpecPlan(app, workItemId, {
    repository: repositoryFor(app),
    actorId: actorOwner,
    reviewerActorId: actorReviewer,
  });
  expect(spec).toMatchObject({
    work_item_id: workItemId,
    development_plan_item_id: expect.any(String),
    status: 'approved',
    approved_revision_id: specRevision.id,
  });
  expect(specRevision).toMatchObject({
    id: specRevision.id,
    spec_id: spec.id,
    work_item_id: workItemId,
    development_plan_item_id: spec.development_plan_item_id,
  });

  return { specId: spec.id, specRevisionId: specRevision.id };
};

const approvePlan = async (app: INestApplication, workItemId: string) => {
  const repository = repositoryFor(app);
  const workItem = await repository.getWorkItem(workItemId);
  if (workItem === undefined || workItem.current_plan_id === undefined || workItem.current_plan_revision_id === undefined) {
    throw new Error(`WorkItem ${workItemId} has no approved current plan`);
  }
  const plan = await repository.getPlan(workItem.current_plan_id);
  const planRevision = await repository.getPlanRevision(workItem.current_plan_revision_id);
  if (plan === undefined || planRevision === undefined) {
    throw new Error(`WorkItem ${workItemId} current plan graph is incomplete`);
  }
  expect(plan).toMatchObject({
    work_item_id: workItemId,
    development_plan_item_id: expect.any(String),
    status: 'approved',
    approved_revision_id: planRevision.id,
  });
  expect(planRevision).toMatchObject({
    id: planRevision.id,
    plan_id: plan.id,
    work_item_id: workItemId,
  });

  return { planId: plan.id, planRevisionId: planRevision.id };
};

const createManualPackage = async (
  app: INestApplication,
  planRevisionId: string,
  overrides: Record<string, unknown> = {},
) => {
  const body = {
    repo_id: 'repo-1',
    objective: 'Implement the delivery API package.',
    owner_actor_id: actorOwner,
    reviewer_actor_id: actorReviewer,
    qa_owner_actor_id: actorQa,
    required_checks: requiredChecks,
    required_artifact_kinds: ['execution_summary'],
    allowed_paths: ['apps/control-plane-api/**', 'tests/api/**'],
    forbidden_paths: ['packages/db/**'],
    ...overrides,
  };

  return (await request(app.getHttpServer()).post(`/plan-revisions/${planRevisionId}/execution-packages`).send(body).expect(201))
    .body;
};

const startWorkflowForItem = async (
  app: INestApplication,
  seed: Awaited<ReturnType<typeof seedItemScopedSpecPlan>>,
): Promise<void> => {
  const repository = repositoryFor(app);
  const now = '2026-05-05T00:00:00.000Z';
  const networkPolicy = { mode: 'disabled' as const };
  const dockerImageDigest = codexCanonicalDigest({ label: 'delivery-flow-workflow-runtime-image', projectId: seed.developmentPlan.project_id });
  const profileId = `workflow-runtime-profile:${seed.developmentPlan.project_id}`;
  const profileRevisionId = `workflow-runtime-profile-revision:${seed.developmentPlan.project_id}`;
  const credentialBindingId = `workflow-credential-binding:${seed.developmentPlan.project_id}`;
  const credentialBindingVersionId = `workflow-credential-binding-version:${seed.developmentPlan.project_id}`;
  const revisionWithoutDigest = {
    id: profileRevisionId,
    profile_id: profileId,
    revision_number: 1,
    status: 'active' as const,
    environment: 'test' as const,
    docker_image: 'ghcr.io/forgeloop/codex-worker:test',
    docker_image_digest: dockerImageDigest,
    target_kind: 'generation' as const,
    source_access_mode: 'artifact_only' as const,
    codex_config_toml: 'approval_policy = "never"\n',
    codex_config_digest: codexCanonicalDigest('approval_policy = "never"\n'),
    expected_effective_config_digest: codexCanonicalDigest({ label: 'delivery-flow-workflow-effective-config' }),
    effective_config_assertions: {
      target_kind: 'generation' as const,
      approval_policy: 'never' as const,
      source_write_policy: 'artifact_only' as const,
      forbidden_writable_roots: ['workspace'] as const,
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server' as const,
    network_policy: networkPolicy,
    resource_limits: {
      cpu_ms: 300_000,
      memory_mb: 1024,
      pids: 256,
      fds: 1024,
      workspace_bytes: 1,
      artifact_bytes: 1_048_576,
      timeout_ms: 300_000,
      output_limit_bytes: 1_048_576,
      run_output_limit_bytes: 1_048_576,
    },
    docker_policy: {
      network_disabled: true,
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: seed.developmentPlan.project_id }],
    profile_digest: 'placeholder',
    created_by_actor_id: actorReviewer,
    created_at: now,
  } satisfies CodexRuntimeProfileRevision;
  await repository.createCodexRuntimeProfileWithRevision({
    profile: {
      id: profileId,
      name: 'Delivery flow workflow test profile',
      environment: 'test',
      target_kind: 'generation',
      active_revision_id: profileRevisionId,
      created_by_actor_id: actorReviewer,
      created_at: now,
      updated_at: now,
    },
    revision: {
      ...revisionWithoutDigest,
      profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest),
    },
  });
  const secretPayload = { auth: { api_key: 'test-api-key' } };
  await repository.createCodexCredentialBindingWithVersion({
    binding: {
      id: credentialBindingId,
      profile_id: profileId,
      project_id: seed.developmentPlan.project_id,
      provider: 'unsafe_db',
      purpose: 'model_provider',
      active_version_id: credentialBindingVersionId,
      created_by_actor_id: actorReviewer,
      created_at: now,
      updated_at: now,
    },
    version: {
      id: credentialBindingVersionId,
      binding_id: credentialBindingId,
      version_number: 1,
      status: 'active',
      payload_digest: codexCredentialPayloadDigest(secretPayload),
      created_by_actor_id: actorReviewer,
      created_at: now,
    },
    secret_payload_json: secretPayload,
  });

	  await request(app.getHttpServer())
	    .post(`/development-plans/${seed.developmentPlan.id}/items/${seed.item.id}/workflow/start-brainstorming`)
	    .send({
	      actor_id: actorReviewer,
	      reason: 'Start workflow to verify legacy item-scoped document fences.',
	    })
	    .expect(201);
};

const repositoryFor = (app: INestApplication): InMemoryDeliveryRepository =>
  (app.get(ExecutionPackageService) as unknown as { repository: InMemoryDeliveryRepository }).repository;

const replaceRuntimeRepository = (app: INestApplication, repository: InMemoryDeliveryRepository): void => {
  (app.get(ExecutionPackageService) as unknown as { repository: InMemoryDeliveryRepository }).repository = repository;
  (app.get(AutomationCommandService) as unknown as { repository: InMemoryDeliveryRepository }).repository = repository;
  (app.get(ProjectService) as unknown as { repository: InMemoryDeliveryRepository }).repository = repository;
  (app.get(SpecPlanService) as unknown as { repository: InMemoryDeliveryRepository }).repository = repository;
  (app.get(WorkItemService) as unknown as { repository: InMemoryDeliveryRepository }).repository = repository;
  (app.get(ReviewEvidenceService) as unknown as { repository: InMemoryDeliveryRepository }).repository = repository;
  (app.get(RunControlService) as unknown as { repository: InMemoryDeliveryRepository }).repository = repository;
  (app.get(DELIVERY_RUN_WORKER) as unknown as { repository: InMemoryDeliveryRepository }).repository = repository;
};

const waitForReviewPacket = async (app: INestApplication, runSessionId: string): Promise<ReviewPacket> => {
  const repository = repositoryFor(app);
  const worker = app.get(DELIVERY_RUN_WORKER) as RunWorker;
  await worker.drainOnce();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runSession = await repository.getRunSession(runSessionId);
    if (runSession !== undefined) {
      const packet = (await repository.listReviewPacketsForPackage(runSession.execution_package_id)).find(
        (item) => item.run_session_id === runSessionId,
      );
      if (packet !== undefined) {
        return packet;
      }
    }
    await delay(10);
  }

  const runSession = await repository.getRunSession(runSessionId);
  const runEvents = await repository.listRunEvents(runSessionId);
  const eventSummaries = runEvents
    .map((event) => `${event.event_type}:${event.summary}:${JSON.stringify(event.payload)}`)
    .join(' | ');
  const runtimeMetadata = JSON.stringify(runSession?.runtime_metadata ?? {});
  throw new Error(
    `Timed out waiting for ReviewPacket for ${runSessionId}; status=${
      runSession?.status ?? 'missing'
    }; runtimeMetadata=${runtimeMetadata}; events=${eventSummaries}`,
  );
};

let seededRunCounter = 0;

const seedSucceededRunWithReadyReviewPacket = async (
  app: INestApplication,
  executionPackage: ExecutionPackage,
): Promise<{ runSession: RunSession; reviewPacket: ReviewPacket; executionPackage: ExecutionPackage }> => {
  const repository = repositoryFor(app);
  const sequence = ++seededRunCounter;
  const runSessionId = `run-session-seeded-${sequence}`;
  const at = `2026-05-05T00:${String(sequence).padStart(2, '0')}:00.000Z`;
  const queuedPackage = transitionExecutionPackage(executionPackage, {
    type: 'run',
    run_session_id: runSessionId,
    at,
  });
  const executingPackage = transitionExecutionPackage(queuedPackage, {
    type: 'workflow_start',
    at,
  });
  const reviewPackage = transitionExecutionPackage(executingPackage, {
    type: 'execution_succeeded',
    at,
  });
  const createdRunSession = transitionRunSession(undefined, {
    type: 'create',
    id: runSessionId,
    execution_package_id: executionPackage.id,
    requested_by_actor_id: actorOwner,
    executor_type: 'mock',
    at,
  });
  const executorResult: ExecutorResult = {
    run_session_id: runSessionId,
    executor_type: 'mock',
    executor_version: 'delivery-flow-test-seed',
    status: 'succeeded',
    started_at: at,
    finished_at: at,
    summary: `Seeded run ${runSessionId} completed.`,
    changed_files: [
      {
        repo_id: executionPackage.repo_id,
        path: evidenceChangedFilePath(executionPackage.allowed_paths),
        change_kind: 'modified',
      },
    ],
    checks: executionPackage.required_checks.map((check) => ({
      check_id: check.check_id,
      command: check.command,
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 0,
      blocks_review: check.blocks_review,
    })),
    artifacts: executionPackage.required_artifact_kinds.map((kind) => ({
      kind,
      name: `${kind}.txt`,
      content_type: 'text/plain',
      local_ref: `/tmp/forgeloop-delivery-flow/${safePathSegment(runSessionId)}/${kind}.txt`,
    })),
    raw_metadata: { seeded: true },
  };
  const runningRunSession = transitionRunSession(createdRunSession, {
    type: 'worker_started',
    runtime_metadata: {
      durability_mode: 'volatile_demo',
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
    },
    at,
  });
  const runSession = transitionRunSession(runningRunSession, {
    type: 'executor_success',
    executor_result: executorResult,
    at,
  });
  const reviewPacket = transitionReviewPacket(undefined, {
    type: 'create',
    id: `review-packet:${runSessionId}`,
    run_session_id: runSessionId,
    execution_package_id: executionPackage.id,
    reviewer_actor_id: executionPackage.reviewer_actor_id,
    spec_revision_id: executionPackage.spec_revision_id,
    plan_revision_id: executionPackage.plan_revision_id,
    changed_files: executorResult.changed_files,
    check_result_summary: 'Required checks passed.',
    self_review: succeededSelfReview(),
    risk_notes: [],
    at,
  });

  await repository.saveExecutionPackage(reviewPackage);
  await repository.saveRunSession(runSession);
  await repository.saveReviewPacket(reviewPacket);

  return { runSession, reviewPacket, executionPackage: reviewPackage };
};

const getAvailablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'string' || address === null) {
        server.close(() => reject(new Error('Unable to allocate an API smoke test port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });

const stopProcess = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }, 1_000).unref();
  });
};

const startRuntimeApi = async (): Promise<{ child: ChildProcessWithoutNullStreams; port: number; logs: () => string }> => {
  const port = await getAvailablePort();
  const child = spawn('pnpm', ['exec', 'tsx', 'src/main.ts'], {
    cwd: 'apps/control-plane-api',
    env: { ...process.env, PORT: String(port) },
  });
  const output: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  return { child, port, logs: () => output.join('') };
};

const waitForRuntimeCreateProject = async (
  port: number,
): Promise<request.Response> => {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 8_000) {
    try {
      return await request(`http://127.0.0.1:${port}`).post('/projects').send({ name: 'Runtime smoke' });
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Timed out waiting for runtime API');
};

class SequencingRepository extends InMemoryDeliveryRepository {
  readonly operations: string[] = [];

  override async saveRunSession(runSession: RunSession): Promise<void> {
    this.operations.push(`saveRunSession:${runSession.id}`);
    await super.saveRunSession(runSession);
  }

  override async saveReviewPacket(reviewPacket: ReviewPacket): Promise<void> {
    if (reviewPacket.status === 'archived') {
      this.operations.push(`archiveReviewPacket:${reviewPacket.id}`);
    }
    await super.saveReviewPacket(reviewPacket);
  }
}

describe('delivery control plane API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RunWorkerLifecycleService)
      .useValue({ onModuleInit: () => undefined, onModuleDestroy: () => undefined })
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useFactory({
        inject: [DELIVERY_REPOSITORY],
        factory: (repository: InMemoryDeliveryRepository) => createTestRunWorker(repository),
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('runs the delivery flow through the command inventory and read APIs', async () => {
    const server = app.getHttpServer();
    const { project, workItem } = await createProjectRepoWorkItem(app);

    expect((await request(server).get(`/projects/${project.id}`).expect(200)).body.repo_ids).toEqual(['repo-1']);
    expect((await request(server).get(`/projects/${project.id}/repos`).expect(200)).body).toHaveLength(1);
    expect((await request(server).get('/work-items').query({ project_id: project.id }).expect(200)).body[0].id).toBe(
      workItem.id,
    );
    await request(server).get(`/work-items/${workItem.id}`).expect(200);

    const { specId, specRevisionId } = await approveSpec(app, workItem.id);
    const { planId, planRevisionId } = await approvePlan(app, workItem.id);
    expect(specRevisionId).toContain('spec-revision');

    const generatedPackages = (
      await request(server).post(`/plan-revisions/${planRevisionId}/generate-packages`).send({}).expect(201)
    ).body;
    expect(generatedPackages).toHaveLength(1);
    expect(generatedPackages[0].phase).toBe('draft');
    expect(generatedPackages[0]).toMatchObject({ scope_ref: { type: 'requirement', id: workItem.id } });
    expect(generatedPackages[0]).not.toHaveProperty('work_item_id');
    expect(generatedPackages[0]).not.toHaveProperty('workflow_id');
    expect(generatedPackages[0]).not.toHaveProperty('codex_session_id');
    expect(generatedPackages[0]).not.toHaveProperty('codex_session_turn_id');

    const executionPackage = await createManualPackage(app, planRevisionId);
    expect(executionPackage).toMatchObject({ scope_ref: { type: 'requirement', id: workItem.id } });
    expect(executionPackage).not.toHaveProperty('work_item_id');
    expect(executionPackage).not.toHaveProperty('workflow_id');
    expect(executionPackage).not.toHaveProperty('codex_session_id');
    expect(executionPackage).not.toHaveProperty('codex_session_turn_id');
    const packageList = (await request(server).get(`/work-items/${workItem.id}/execution-packages`).expect(200)).body;
    expect(packageList.length).toBeGreaterThanOrEqual(2);
    expect(packageList[0]).toMatchObject({ scope_ref: { type: 'requirement', id: workItem.id } });
    expect(packageList[0]).not.toHaveProperty('work_item_id');
    expect(packageList[0]).not.toHaveProperty('workflow_id');
    expect(packageList[0]).not.toHaveProperty('codex_session_id');
    expect(packageList[0]).not.toHaveProperty('codex_session_turn_id');
    const packageDetail = (await request(server).get(`/execution-packages/${executionPackage.id}`).expect(200)).body;
    expect(packageDetail).toMatchObject({ scope_ref: { type: 'requirement', id: workItem.id } });
    expect(packageDetail).not.toHaveProperty('work_item_id');
    expect(packageDetail).not.toHaveProperty('workflow_id');
    expect(packageDetail).not.toHaveProperty('codex_session_id');
    expect(packageDetail).not.toHaveProperty('codex_session_turn_id');
    const patchedPackage = (await request(server)
      .patch(`/execution-packages/${executionPackage.id}`)
      .send({ objective: 'Edited before ready.' })
      .expect(200)).body;
    expect(patchedPackage).toMatchObject({ scope_ref: { type: 'requirement', id: workItem.id } });
    expect(patchedPackage).not.toHaveProperty('work_item_id');
    expect(patchedPackage).not.toHaveProperty('workflow_id');
    expect(patchedPackage).not.toHaveProperty('codex_session_id');
    expect(patchedPackage).not.toHaveProperty('codex_session_turn_id');
    const readyPackage = (await request(server)
      .post(`/execution-packages/${executionPackage.id}/mark-ready`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner, expected_package_version: patchedPackage.version })
      .expect(201)).body;
    expect(readyPackage).toMatchObject({ scope_ref: { type: 'requirement', id: workItem.id } });
    expect(readyPackage).not.toHaveProperty('work_item_id');

    await request(server)
      .post(`/execution-packages/${executionPackage.id}/run`)
      .set(ownerHeaders)
      .send({ workflow_only: true })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
        expect(body).not.toHaveProperty('run_session_id');
        expect(body).not.toHaveProperty('workflow_result');
      });
    expect(await repositoryFor(app).listRunSessionsForPackage(executionPackage.id)).toEqual([]);

    const documentReviews = (await request(server).get('/query/reviews').query({ project_id: project.id }).expect(200)).body;
    expect(documentReviews.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object_ref: expect.objectContaining({ type: 'spec', id: specId }),
          current_revision_id: specRevisionId,
        }),
      ]),
    );
    expect((await request(server).get(`/plan-revisions/${planRevisionId}`).expect(200)).body).toMatchObject({
      id: planRevisionId,
      plan_id: planId,
    });

    const executionLane = (
      await request(server)
        .get('/query/product-lanes/execution-owner')
        .query({ project_id: project.id, execution_owner_actor_id: actorOwner })
        .expect(200)
    ).body;
    expect(executionLane.items.map((item: { object: { type: string } }) => item.object.type)).not.toContain('execution_package');
    expect((await request(server).get(`/execution-packages/${executionPackage.id}`).expect(200)).body).toMatchObject({
      id: executionPackage.id,
      phase: 'ready',
      activity_state: 'idle',
      resolution: 'none',
    });

    await request(server).get(`/query/work-item-cockpit/${workItem.id}`).expect(404);
    await request(server).get(`/query/replay/work_item/${workItem.id}`).expect(404);
  });

  it('serves POST /projects when booted through the tsx runtime entrypoint', async () => {
    const runtime = await startRuntimeApi();
    try {
      const response = await waitForRuntimeCreateProject(runtime.port);

      expect(response.status, runtime.logs()).toBe(201);
      expect(response.body).toMatchObject({ id: expect.stringContaining('project'), name: 'Runtime smoke' });
    } finally {
      await stopProcess(runtime.child);
    }
  });

  it('updates an existing project repo binding for the same repo id instead of appending a stale path', async () => {
    const server = app.getHttpServer();
    const project = (
      await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorOwner }).expect(201)
    ).body;
    const initial = (
      await request(server)
        .post(`/projects/${project.id}/repos`)
        .send({
          repo_id: 'repo-1',
          name: 'forgeloop',
          local_path: '/workspace/forgeloop',
          default_branch: 'main',
          base_commit_sha: 'abc123',
        })
        .expect(201)
    ).body;

    const updated = (
      await request(server)
        .post(`/projects/${project.id}/repos`)
        .send({
          repo_id: 'repo-1',
          name: 'forgeloop',
          local_path: await createWorkflowPolicyRepoRoot(),
          default_branch: 'main',
          base_commit_sha: 'def456',
        })
        .expect(201)
    ).body;
    const repos = (await request(server).get(`/projects/${project.id}/repos`).expect(200)).body;

    expect(updated.id).toBe(initial.id);
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({
      id: initial.id,
      repo_id: 'repo-1',
      base_commit_sha: 'def456',
    });
    expect(repos[0].local_path).not.toBe('/workspace/forgeloop');
    expect((await request(server).get(`/projects/${project.id}`).expect(200)).body.repo_ids).toEqual(['repo-1']);
  });

  it('maps invalid domain transitions and package validators to 4xx responses', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);

    const draftSpec = await seedItemScopedSpecPlan(app, workItem.id, {
      actorId: actorOwner,
      reviewerActorId: actorReviewer,
      includePlan: false,
      specStatus: 'draft',
    });
    await request(server)
      .post(`/development-plans/${draftSpec.developmentPlan.id}/items/${draftSpec.item.id}/spec/approve`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer })
      .expect(404);

    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);
    const readyPackage = (await request(server)
      .post(`/execution-packages/${executionPackage.id}/mark-ready`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner, expected_package_version: executionPackage.version })
      .expect(201)).body;
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/mark-ready`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner, expected_package_version: readyPackage.version })
      .expect(400);

    const { reviewPacket } = await seedSucceededRunWithReadyReviewPacket(app, readyPackage as ExecutionPackage);
    const reviewPacketId = reviewPacket.id;
    await request(server)
      .post(`/review-packets/${reviewPacketId}/approve`)
      .set(reviewerHeaders)
      .send({
        summary: 'Approved once.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T05:00:00.000Z',
      })
      .expect(201);
    await request(server)
      .post(`/review-packets/${reviewPacketId}/approve`)
      .set(reviewerHeaders)
      .send({
        summary: 'Approved twice.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T05:01:00.000Z',
      })
      .expect(400);

    await request(server).patch(`/execution-packages/${executionPackage.id}`).send({ owner_actor_id: '' }).expect(400);
  });

  it('rejects malformed request bodies with 400 responses and does not persist invalid objects', async () => {
    const server = app.getHttpServer();

    await request(server).post('/projects').send({ name: { text: 'Forgeloop' } }).expect(400);
    await request(server).post('/projects').send(null).expect(400);

    const { project, workItem } = await createProjectRepoWorkItem(app);
    await request(server)
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'requirement',
        title: 'Invalid success criteria',
        goal: 'This should not persist.',
        success_criteria: 'not-an-array',
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: actorOwner,
        intake_context: requirementIntakeContext,
      })
      .expect(400);
    expect((await request(server).get('/work-items').query({ project_id: project.id }).expect(200)).body).toHaveLength(1);

    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    await request(server)
      .post(`/plan-revisions/${planRevisionId}/execution-packages`)
      .send({
        repo_id: 'repo-1',
        objective: 'Invalid package.',
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorQa,
        required_checks: 'pnpm test',
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['apps/control-plane-api/**'],
        forbidden_paths: [],
      })
      .expect(400);
    expect((await request(server).get(`/work-items/${workItem.id}/execution-packages`).expect(200)).body).toHaveLength(0);

    const executionPackage = await createManualPackage(app, planRevisionId);
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/mark-ready`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner, expected_package_version: executionPackage.version })
      .expect(201);
    const readyPackage = (await request(server).get(`/execution-packages/${executionPackage.id}`).expect(200))
      .body as ExecutionPackage;
    const { reviewPacket } = await seedSucceededRunWithReadyReviewPacket(app, readyPackage);
    const reviewPacketId = reviewPacket.id;
    await request(server)
      .post(`/review-packets/${reviewPacketId}/request-changes`)
      .set(reviewerHeaders)
      .send({
        summary: 'Invalid review decision.',
        reviewed_by_actor_id: actorReviewer,
        reviewed_at: '2026-05-05T06:00:00.000Z',
        requested_changes: { title: 'Wrong shape' },
      })
      .expect(400);
    expect((await request(server).get(`/review-packets/${reviewPacketId}`).expect(200)).body).toMatchObject({
      status: 'ready',
      decision: 'none',
    });
  });

  it('blocks package edits while an open ReviewPacket exists', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);

    await request(server)
      .post(`/execution-packages/${executionPackage.id}/mark-ready`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner, expected_package_version: executionPackage.version })
      .expect(201);
    const readyPackage = (await request(server).get(`/execution-packages/${executionPackage.id}`).expect(200))
      .body as ExecutionPackage;
    const { runSession, reviewPacket } = await seedSucceededRunWithReadyReviewPacket(app, readyPackage);
    const reviewPacketId = reviewPacket.id;

    await request(server)
      .patch(`/execution-packages/${executionPackage.id}`)
      .send({ objective: 'Edited package creates a fresh run spec.' })
      .expect(422);

    const oldRun = (await request(server).get(`/run-sessions/${runSession.id}`).expect(200)).body;
    const openPacket = (await request(server).get(`/review-packets/${reviewPacketId}`).expect(200)).body;
    expect(oldRun.status).toBe('succeeded');
    expect(openPacket.status).toBe('ready');
  });

  it('blocks package edits while a ReviewPacket is in review', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);
    const repository = repositoryFor(app);

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).set(ownerHeaders).send({ actor_id: actorOwner, expected_package_version: executionPackage.version }).expect(201);
    const readyPackage = (await request(server).get(`/execution-packages/${executionPackage.id}`).expect(200))
      .body as ExecutionPackage;
    const { runSession, reviewPacket } = await seedSucceededRunWithReadyReviewPacket(app, readyPackage);
    const reviewPacketId = reviewPacket.id;
    const readyPacket = await repository.getReviewPacket(reviewPacketId);
    await repository.saveReviewPacket({ ...readyPacket!, status: 'in_review' });

    await request(server)
      .patch(`/execution-packages/${executionPackage.id}`)
      .send({ objective: 'Edit while human review has started.' })
      .expect(422);

    expect((await request(server).get(`/run-sessions/${runSession.id}`).expect(200)).body.status).toBe('succeeded');
    expect((await request(server).get(`/review-packets/${reviewPacketId}`).expect(200)).body.status).toBe('in_review');
  });

  it('validates disabled run, rerun, and force-rerun request bodies without creating execution state', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);
    const repository = repositoryFor(app);

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).set(ownerHeaders).send({ actor_id: actorOwner, expected_package_version: executionPackage.version }).expect(201);
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/run`)
      .send({ workflow_only: true })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
      });
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/run`)
      .set(ownerHeaders)
      .send({
        workflow_only: true,
        previous_run_session_id: 'run-session-not-valid-for-run',
        force: true,
        force_reason: 'Plain run must reject rerun-only fields.',
      })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
      });

    await request(server)
      .post(`/execution-packages/${executionPackage.id}/rerun`)
      .set(ownerHeaders)
      .send({ workflow_only: true })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
      });
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/rerun`)
      .set(ownerHeaders)
      .send({
        previous_run_session_id: 'run-session-seeded',
        force: true,
        force_reason: 'Rerun must reject force-only fields.',
        workflow_only: true,
      })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
      });
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/rerun`)
      .set(ownerHeaders)
      .send({ previous_run_session_id: 'run-session-seeded', workflow_only: true })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
      });

    await request(server)
      .post(`/execution-packages/${executionPackage.id}/force-rerun`)
      .set(ownerHeaders)
      .send({ previous_run_session_id: 'run-session-seeded', workflow_only: true })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
      });
    await request(server)
      .post(`/execution-packages/${executionPackage.id}/force-rerun`)
      .set(ownerHeaders)
      .send({
        previous_run_session_id: 'run-session-stale',
        force: true,
        force_reason: 'Stale run id.',
        workflow_only: true,
      })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
      });
    expect(await repository.listRunSessionsForPackage(executionPackage.id)).toEqual([]);
    expect(await repository.listTraceEventsForSubject('execution_package', executionPackage.id)).toEqual([]);
  });

  it('does not archive an open ReviewPacket when disabled force-rerun is requested', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).set(ownerHeaders).send({ actor_id: actorOwner, expected_package_version: executionPackage.version }).expect(201);
    const readyPackage = (await request(server).get(`/execution-packages/${executionPackage.id}`).expect(200))
      .body as ExecutionPackage;
    const { runSession, reviewPacket } = await seedSucceededRunWithReadyReviewPacket(app, readyPackage);

    await request(server)
      .post(`/execution-packages/${executionPackage.id}/force-rerun`)
      .set(reviewerHeaders)
      .send({
        previous_run_session_id: runSession.id,
        force: true,
        force_reason: 'Reviewer is not the owner.',
        workflow_only: true,
      })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
      });

    await request(server)
      .post(`/execution-packages/${executionPackage.id}/force-rerun`)
      .set(ownerHeaders)
      .send({
        previous_run_session_id: runSession.id,
        force: true,
        force_reason: 'Owner wants a fresh run before review.',
        workflow_only: true,
      })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
      });

    expect((await request(server).get(`/review-packets/${reviewPacket.id}`).expect(200)).body).toMatchObject({
      status: 'ready',
      decision: 'none',
    });
    expect(await repositoryFor(app).listRunSessionsForPackage(executionPackage.id)).toHaveLength(1);
  });

  it('does not mutate archive sequencing when disabled force-rerun is requested', async () => {
    const repository = new SequencingRepository();
    replaceRuntimeRepository(app, repository);
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    await approveSpec(app, workItem.id);
    const { planRevisionId } = await approvePlan(app, workItem.id);
    const executionPackage = await createManualPackage(app, planRevisionId);

    await request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`).set(ownerHeaders).send({ actor_id: actorOwner, expected_package_version: executionPackage.version }).expect(201);
    const readyPackage = (await request(server).get(`/execution-packages/${executionPackage.id}`).expect(200))
      .body as ExecutionPackage;
    const { runSession } = await seedSucceededRunWithReadyReviewPacket(app, readyPackage);
    repository.operations.length = 0;

    await request(server)
      .post(`/execution-packages/${executionPackage.id}/force-rerun`)
      .set(ownerHeaders)
      .send({
        previous_run_session_id: runSession.id,
        force: true,
        force_reason: 'Owner wants a fresh run before review.',
        workflow_only: true,
      })
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('legacy_execution_entrypoint_disabled');
      });

    expect(repository.operations).toEqual([]);
  });

  it('rejects legacy item-scoped Spec and Implementation Plan Doc request-changes command paths', async () => {
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);

    const specSeed = await seedItemScopedSpecPlan(app, workItem.id, {
      actorId: actorOwner,
      reviewerActorId: actorReviewer,
      includePlan: false,
      specStatus: 'in_review',
    });
    await startWorkflowForItem(app, specSeed);
    await request(server)
      .post(`/development-plans/${specSeed.developmentPlan.id}/items/${specSeed.item.id}/spec/request-changes`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Clarify the API acceptance criteria.' })
      .expect(404);

    const { workItem: planWorkItem } = await createProjectRepoWorkItem(app);
    const planSeed = await seedItemScopedSpecPlan(app, planWorkItem.id, {
      actorId: actorOwner,
      reviewerActorId: actorReviewer,
      includePlan: false,
    });
    await startWorkflowForItem(app, planSeed);
    const executionPlanRevision = (
      await request(server)
        .post(`/development-plans/${planSeed.developmentPlan.id}/items/${planSeed.item.id}/implementation-plan/generate-draft`)
        .send({ actor_id: actorOwner })
        .expect(404)
    ).body;
    expect(executionPlanRevision.id).toBeUndefined();
  });
});
