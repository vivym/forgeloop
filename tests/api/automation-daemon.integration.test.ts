import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AutomationDaemon, type AutomationDaemonClient } from '../../apps/automation-daemon/src/automation-daemon';
import { loadDaemonWorkflowPolicyDigest } from '../../apps/automation-daemon/src/workflow-policy-loader';
import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import {
  createCodexGenerationRuntime,
  type CodexGenerationRuntime,
} from '../../packages/codex-runtime/src/index';
import {
  AutomationHttpClient,
  type AutomationActionResponse,
  type AutomationFetch,
  type AutomationGenerationPlanningConfig,
  type ClaimNextActionInput,
  type NextAction,
} from '../../packages/automation/src/index';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';
import type { AutomationActionRun } from '../../packages/domain/src/automation';
import type { Plan, PlanRevision, Project, Spec, WorkItem } from '../../packages/domain/src/index';
import { testRuntimePolicyMarkdown } from '../helpers/runtime-policy-repo';

const automationSecret = 'test-secret';
const automationActorId = 'daemon-actor';
const automationDaemonIdentity = 'daemon-1';
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const now = '2026-05-16T00:00:00.000Z';
const expectedCompletedActionTypes = [
  'ensure_plan_draft',
  'project_runtime_snapshot',
] as const;
const expectedInitialPendingActionTypes = ['ensure_plan_draft', 'project_runtime_snapshot'] as const;

const humanAdminHeaders = {
  'x-forgeloop-actor-id': actorOwner,
  'x-forgeloop-actor-class': 'human_admin',
};
const reviewerHeaders = {
  'x-forgeloop-actor-id': actorReviewer,
  'x-forgeloop-actor-class': 'human',
};

const apps: INestApplication[] = [];
let tempRoot: string;
let repoRoot: string;
let previousAutomationSecret: string | undefined;
let previousAutomationTestNow: string | undefined;

const bootAutomationApp = async (): Promise<{ app: INestApplication; repository: DeliveryRepository }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(new InMemoryDeliveryRepository())
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useLogger(false);
  await app.init();
  apps.push(app);
  return { app, repository: app.get(DELIVERY_REPOSITORY) as DeliveryRepository };
};

const automationFetchFor = (app: INestApplication): AutomationFetch => async (url, init) => {
  const parsed = new URL(url);
  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  const server = app.getHttpServer();
  const method = init.method.toUpperCase();
  const testRequest =
    method === 'GET'
      ? request(server).get(pathAndQuery)
      : method === 'POST'
        ? request(server).post(pathAndQuery)
        : undefined;
  if (testRequest === undefined) {
    throw new Error(`Unsupported test automation fetch method: ${init.method}`);
  }
  testRequest.set(init.headers);
  if (init.body !== undefined) {
    testRequest.send(init.body);
  }
  const response = await testRequest;
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.res.statusMessage,
    json: async () => (Object.keys(response.body).length > 0 ? response.body : JSON.parse(response.text)),
    text: async () => response.text,
  };
};

const createAutomationClient = (app: INestApplication): AutomationHttpClient =>
  new AutomationHttpClient({
    baseUrl: 'http://forgeloop.test',
    actorId: automationActorId,
    daemonIdentity: automationDaemonIdentity,
    secret: automationSecret,
    fetch: automationFetchFor(app),
    now: () => new Date().toISOString(),
  });

const fakeGenerationPlanning = (
  overrides: Partial<AutomationGenerationPlanningConfig['tasks']> = {},
): AutomationGenerationPlanningConfig => ({
  mode: 'fake',
  tasks: {
    spec_draft: { enabled: true, promptVersion: 'spec-draft.fake.v1', outputSchemaVersion: 'spec_draft.v1' },
    plan_draft: { enabled: true, promptVersion: 'plan-draft.fake.v1', outputSchemaVersion: 'plan_draft.v1' },
    package_drafts: { enabled: false, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
    ...overrides,
  },
});

const createDaemon = (
  app: INestApplication,
  client: AutomationDaemonClient = createAutomationClient(app),
  options: Partial<
    Pick<
      ConstructorParameters<typeof AutomationDaemon>[0],
      'generationPlanning' | 'generationRuntime' | 'specDraftGenerationMode'
    >
  > = {},
): AutomationDaemon =>
  new AutomationDaemon({
    client,
    actorId: automationActorId,
    daemonIdentity: automationDaemonIdentity,
    allowedRepoRoots: [tempRoot],
    policyParserVersion: 'workflow-md-parser:v1',
    policyLoader: loadDaemonWorkflowPolicyDigest,
    loopIntervalMs: 1,
    noClaimBackoffMs: 1,
    generationPlanning: fakeGenerationPlanning(),
    generationRuntime: createCodexGenerationRuntime({ mode: 'fake' }),
    ...options,
  });

const seedDraftOnlyApprovedSpec = async (
  app: INestApplication,
): Promise<{ project: Project; workItem: WorkItem; spec: Spec; specRevisionId: string }> => {
  const server = app.getHttpServer();
  const project = (await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorOwner }).expect(201))
    .body as Project;
  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: 'repo-1',
      name: 'forgeloop',
      local_path: repoRoot,
      default_branch: 'main',
      base_commit_sha: 'abc123',
    })
    .expect(201);
  await request(server)
    .post(`/automation/projects/${project.id}/capabilities`)
    .set(humanAdminHeaders)
    .send({
      repo_id: 'repo-1',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable HTTP automation daemon dogfood',
      evidence_refs: [],
      actor_context: { actor_id: actorOwner, actor_class: 'human_admin' },
    })
    .expect(201);
  const workItem = (await request(server)
    .post('/work-items')
    .send({
      project_id: project.id,
      kind: 'requirement',
      title: 'Ship HTTP automation daemon',
      goal: 'Generate plan and package drafts through the daemon.',
      success_criteria: ['Daemon creates draft artifacts without run enqueue.'],
      priority: 'P0',
      risk: 'medium',
      driver_actor_id: actorOwner,
    })
    .expect(201)).body as WorkItem;
  const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body as Spec;
  const revision = (await request(server).post(`/specs/${spec.id}/generate-draft`).send({}).expect(201)).body as {
    id: string;
  };
  await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(humanAdminHeaders).send({ actor_id: actorOwner }).expect(201);
  const approvedSpec = (await request(server)
    .post(`/specs/${spec.id}/approve`)
    .set(reviewerHeaders)
    .send({ actor_id: actorReviewer })
    .expect(201)).body as Spec;
  return { project, workItem, spec: approvedSpec, specRevisionId: revision.id };
};

const seedDraftOnlyWorkItemWithoutSpec = async (app: INestApplication): Promise<{ project: Project; workItem: WorkItem }> => {
  const server = app.getHttpServer();
  const project = (await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorOwner }).expect(201))
    .body as Project;
  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: 'repo-1',
      name: 'forgeloop',
      local_path: repoRoot,
      default_branch: 'main',
      base_commit_sha: 'abc123',
    })
    .expect(201);
  await request(server)
    .post(`/automation/projects/${project.id}/capabilities`)
    .set(humanAdminHeaders)
    .send({
      repo_id: 'repo-1',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable fake Spec draft automation',
      evidence_refs: [],
      actor_context: { actor_id: actorOwner, actor_class: 'human_admin' },
    })
    .expect(201);
  const workItem = (await request(server)
    .post('/work-items')
    .send({
      project_id: project.id,
      kind: 'requirement',
      title: 'Ship fake Spec draft automation',
      goal: 'Generate a Spec draft through the automation daemon.',
      success_criteria: ['Daemon creates a draft Spec revision.'],
      priority: 'P0',
      risk: 'medium',
      driver_actor_id: actorOwner,
    })
    .expect(201)).body as WorkItem;

  return { project, workItem };
};

const approveCurrentPlan = async (
  app: INestApplication,
  repository: DeliveryRepository,
  workItemId: string,
): Promise<{ plan: Plan; revision: PlanRevision }> => {
  const workItem = await repository.getWorkItem(workItemId);
  expect(workItem?.current_plan_id).toEqual(expect.any(String));
  const plan = (await repository.getPlan(workItem!.current_plan_id!))!;
  const revision = (await repository.listPlanRevisions(plan.id)).find((item) => item.id === plan.current_revision_id);
  expect(revision).toBeDefined();

  const server = app.getHttpServer();
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).set(humanAdminHeaders).send({ actor_id: actorOwner }).expect(201);
  const approvedPlan = (await request(server)
    .post(`/plans/${plan.id}/approve`)
    .set(reviewerHeaders)
    .send({ actor_id: actorReviewer })
    .expect(201)).body as Plan;
  return { plan: approvedPlan, revision: revision! };
};

const runUntil = async (daemon: AutomationDaemon, predicate: () => Promise<boolean>, label: string): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    if (await predicate()) {
      return;
    }
    await daemon.runOnce();
  }
  if (await predicate()) {
    return;
  }
  throw new Error(`automation_daemon_condition_not_met:${label}`);
};

const drainDaemon = async (daemon: AutomationDaemon, label: string): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    const result = await daemon.runOnce();
    if (result.plannedActionCount === 0 && result.executed.reasonCode === 'no_claimable_action') {
      return;
    }
  }
  throw new Error(`automation_daemon_condition_not_met:${label}`);
};

class RestartBeforeClaimClient extends AutomationHttpClient {
  readonly createOrReplayActions: NextAction[] = [];

  override async createOrReplayAction(action: NextAction): Promise<AutomationActionResponse> {
    this.createOrReplayActions.push(action);
    return super.createOrReplayAction(action);
  }

  override async claimNextAction(_input: ClaimNextActionInput): Promise<AutomationActionResponse> {
    throw new Error('simulated_restart_before_claim');
  }
}

const actionRuns = async (repository: DeliveryRepository): Promise<AutomationActionRun[]> =>
  (await repository.getRuntimeSnapshotData()).recent_action_runs;

const sortedActionTypes = (runs: AutomationActionRun[]): string[] => runs.map((actionRun) => actionRun.action_type).sort();

const expectSucceededActionLifecycle = (runs: AutomationActionRun[], actionType: string): AutomationActionRun => {
  const matching = runs.filter((actionRun) => actionRun.action_type === actionType);
  expect(matching).toHaveLength(1);
  expect(matching[0]).toMatchObject({
    action_type: actionType,
    status: 'succeeded',
    attempt: 1,
    created_at: expect.any(String),
    claimed_at: expect.any(String),
    started_at: expect.any(String),
    finished_at: expect.any(String),
  });
  expect(matching[0]!.claim_token).toBeUndefined();
  expect(matching[0]!.locked_until).toBeUndefined();
  return matching[0]!;
};

beforeEach(async () => {
  previousAutomationSecret = process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
  previousAutomationTestNow = process.env.FORGELOOP_AUTOMATION_TEST_NOW;
  process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = automationSecret;
  process.env.FORGELOOP_AUTOMATION_TEST_NOW = now;
  tempRoot = await mkdtemp(path.join(tmpdir(), 'forgeloop-automation-daemon-e2e-'));
  repoRoot = path.join(tempRoot, 'repo');
  await mkdir(repoRoot, { recursive: true });
  await writeFile(path.join(repoRoot, 'WORKFLOW.md'), testRuntimePolicyMarkdown(), 'utf8');
});

afterEach(async () => {
  if (previousAutomationSecret === undefined) {
    delete process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
  } else {
    process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = previousAutomationSecret;
  }
  if (previousAutomationTestNow === undefined) {
    delete process.env.FORGELOOP_AUTOMATION_TEST_NOW;
  } else {
    process.env.FORGELOOP_AUTOMATION_TEST_NOW = previousAutomationTestNow;
  }
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await rm(tempRoot, { recursive: true, force: true });
});

describe('HTTP automation daemon integration', () => {
  it('creates a fake Spec draft through the shared generation runtime without generating downstream drafts', async () => {
    const { app, repository } = await bootAutomationApp();
    const seeded = await seedDraftOnlyWorkItemWithoutSpec(app);
    const generationRuntime: CodexGenerationRuntime = {
      ...createCodexGenerationRuntime({ mode: 'fake' }),
      async generateSpecDraft(input) {
        return {
          taskKind: 'spec_draft',
          promptVersion: input.promptVersion,
          outputSchemaVersion: input.outputSchemaVersion,
          generated: {
            schema_version: 'spec_draft.v1',
            summary: 'Runtime-generated Spec draft',
            content: 'Runtime-generated Spec content.',
            background: 'Runtime context was used.',
            goals: ['Use the shared generation runtime'],
            scope_in: ['Spec generation runtime integration'],
            scope_out: ['Separate automation-owned Spec generator'],
            acceptance_criteria: ['Daemon creates a draft Spec revision.'],
            risk_notes: ['Keep human approval gates intact.'],
            test_strategy_summary: 'Verify the daemon uses generationRuntime.generateSpecDraft.',
          },
          generationArtifacts: [],
          publicSummary: 'Spec generated.',
        };
      },
    };
    const daemon = createDaemon(app, createAutomationClient(app), { generationRuntime });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 2, executed: { status: 'succeeded' } });
    const workItem = await repository.getWorkItem(seeded.workItem.id);
    expect(workItem).toMatchObject({
      id: seeded.workItem.id,
      current_spec_id: expect.any(String),
      current_spec_revision_id: expect.any(String),
    });
    expect(workItem?.current_plan_id).toBeUndefined();
    const spec = (await repository.getSpec(workItem!.current_spec_id!))!;
    expect(spec).toMatchObject({
      work_item_id: seeded.workItem.id,
      status: 'draft',
      current_revision_id: workItem!.current_spec_revision_id,
    });
    const revisions = await repository.listSpecRevisions(spec.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      id: spec.current_revision_id,
      summary: 'Runtime-generated Spec draft',
      content: 'Runtime-generated Spec content.',
      acceptance_criteria: ['Daemon creates a draft Spec revision.'],
    });
    await expect(repository.listExecutionPackagesForWorkItem(seeded.workItem.id)).resolves.toEqual([]);

    const runs = await actionRuns(repository);
    expect(runs.map((actionRun) => actionRun.action_type)).toContain('ensure_spec_draft');
    expect(runs.map((actionRun) => actionRun.action_type)).toContain('project_runtime_snapshot');
    expect(runs.map((actionRun) => actionRun.action_type)).not.toContain('ensure_plan_draft');
    expect(runs.map((actionRun) => actionRun.action_type)).not.toContain('ensure_package_drafts');
    expect(runs.map((actionRun) => actionRun.action_type)).not.toContain('enqueue_package_run');
    expectSucceededActionLifecycle(runs, 'ensure_spec_draft');
  });

  it('2A generates a Plan draft from an approved Spec and suppresses Package generation after human Plan approval', async () => {
    const { app, repository } = await bootAutomationApp();
    const seeded = await seedDraftOnlyApprovedSpec(app);
    const daemon = createDaemon(app);

    await runUntil(
      daemon,
      async () => (await repository.getWorkItem(seeded.workItem.id))?.current_plan_id !== undefined,
      'plan_draft_created',
    );
    const planContext = await approveCurrentPlan(app, repository, seeded.workItem.id);
    await drainDaemon(daemon, 'daemon_drained');

    const workItem = await repository.getWorkItem(seeded.workItem.id);
    expect(workItem?.current_plan_id).toEqual(expect.any(String));
    expect(workItem?.current_plan_revision_id).toBe(planContext.revision.id);
    const plan = (await repository.getPlan(workItem!.current_plan_id!))!;
    expect(plan).toMatchObject({
      id: workItem!.current_plan_id,
      status: 'approved',
      approved_revision_id: planContext.revision.id,
    });
    const packages = await repository.listExecutionPackagesForWorkItem(seeded.workItem.id);
    expect(packages).toHaveLength(0);

    const completedActionRuns = await actionRuns(repository);
    expect(completedActionRuns).toHaveLength(expectedCompletedActionTypes.length);
    expect(completedActionRuns.filter((actionRun) => actionRun.status !== 'succeeded')).toHaveLength(0);
    expect(sortedActionTypes(completedActionRuns)).toEqual([...expectedCompletedActionTypes]);
    const planAction = expectSucceededActionLifecycle(completedActionRuns, 'ensure_plan_draft');
    expectSucceededActionLifecycle(completedActionRuns, 'project_runtime_snapshot');
    expect(new Set(completedActionRuns.map((actionRun) => actionRun.idempotency_key)).size).toBe(completedActionRuns.length);
    expect(planAction.action_input_json).toMatchObject({ work_item_id: seeded.workItem.id, spec_revision_id: seeded.specRevisionId });
    expect(completedActionRuns.map((actionRun) => actionRun.action_type)).not.toContain('ensure_package_drafts');
    const actionRunCount = completedActionRuns.length;

    const restarted = createDaemon(app);
    const restartResult = await restarted.runOnce();
    const packagesAfterRestart = await repository.listExecutionPackagesForWorkItem(seeded.workItem.id);
    const actionRunsAfterRestart = await actionRuns(repository);

    expect(restartResult).toMatchObject({
      plannedActionCount: 0,
      executed: { status: 'skipped', reasonCode: 'no_claimable_action' },
    });
    expect(packagesAfterRestart).toHaveLength(0);
    expect(actionRunsAfterRestart).toHaveLength(actionRunCount);
  });

  it('2B generates Package drafts from a human-approved generated Plan when explicitly enabled without enqueueing run sessions', async () => {
    const { app, repository } = await bootAutomationApp();
    const seeded = await seedDraftOnlyApprovedSpec(app);
    const generationPlanning = fakeGenerationPlanning({
      package_drafts: { enabled: true, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
    });
    const daemon = createDaemon(app, createAutomationClient(app), { generationPlanning });

    await runUntil(
      daemon,
      async () => (await repository.getWorkItem(seeded.workItem.id))?.current_plan_id !== undefined,
      '2b_plan_draft_created',
    );
    const planContext = await approveCurrentPlan(app, repository, seeded.workItem.id);
    await runUntil(
      daemon,
      async () => (await repository.listExecutionPackagesForWorkItem(seeded.workItem.id)).length === 2,
      '2b_package_drafts_created',
    );
    await drainDaemon(daemon, '2b_daemon_drained');

    const packages = await repository.listExecutionPackagesForWorkItem(seeded.workItem.id);
    expect(packages.map((item) => item.package_key)).toEqual(['api', 'tests']);
    expect(packages.map((item) => item.sequence)).toEqual([0, 1]);
    expect(packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          work_item_id: seeded.workItem.id,
          plan_revision_id: planContext.revision.id,
          generation_key: `default:${planContext.revision.id}`,
          package_key: 'api',
          phase: 'draft',
        }),
        expect.objectContaining({
          work_item_id: seeded.workItem.id,
          plan_revision_id: planContext.revision.id,
          generation_key: `default:${planContext.revision.id}`,
          package_key: 'tests',
          phase: 'draft',
        }),
      ]),
    );
    await expect(repository.listRunSessions(seeded.project.id)).resolves.toEqual([]);
    for (const executionPackage of packages) {
      await expect(repository.listRunSessionsForPackage(executionPackage.id)).resolves.toEqual([]);
    }

    const completedActionRuns = await actionRuns(repository);
    expect(completedActionRuns.filter((actionRun) => actionRun.status !== 'succeeded')).toHaveLength(0);
    expect(sortedActionTypes(completedActionRuns)).toEqual([
      'ensure_package_drafts',
      'ensure_plan_draft',
      'project_runtime_snapshot',
    ]);
    expectSucceededActionLifecycle(completedActionRuns, 'ensure_plan_draft');
    expectSucceededActionLifecycle(completedActionRuns, 'ensure_package_drafts');
    expectSucceededActionLifecycle(completedActionRuns, 'project_runtime_snapshot');
    expect(completedActionRuns.map((actionRun) => actionRun.action_type)).not.toContain('enqueue_package_run');
  });

  it('daemon never submits or approves Spec or Plan during generation', async () => {
    const { app, repository } = await bootAutomationApp();
    const specSeed = await seedDraftOnlyWorkItemWithoutSpec(app);
    await createDaemon(app).runOnce();

    const workItemWithSpec = await repository.getWorkItem(specSeed.workItem.id);
    const generatedSpec = (await repository.getSpec(workItemWithSpec!.current_spec_id!))!;
    expect(generatedSpec.status).toBe('draft');
    expect(generatedSpec.approved_revision_id).toBeUndefined();
    expect(generatedSpec.submitted_at).toBeUndefined();

    const planSeed = await seedDraftOnlyApprovedSpec(app);
    await runUntil(
      createDaemon(app),
      async () => (await repository.getWorkItem(planSeed.workItem.id))?.current_plan_id !== undefined,
      'plan_draft_created_without_human_gate_mutation',
    );
    const workItemWithPlan = await repository.getWorkItem(planSeed.workItem.id);
    const generatedPlan = (await repository.getPlan(workItemWithPlan!.current_plan_id!))!;
    expect(generatedPlan.status).toBe('draft');
    expect(generatedPlan.approved_revision_id).toBeUndefined();
    expect(generatedPlan.submitted_at).toBeUndefined();
  });

  it('continues from pending automation_action_runs after daemon restart without duplicating actions', async () => {
    const { app, repository } = await bootAutomationApp();
    const seeded = await seedDraftOnlyApprovedSpec(app);
    const interruptedClient = new RestartBeforeClaimClient({
      baseUrl: 'http://forgeloop.test',
      actorId: automationActorId,
      daemonIdentity: automationDaemonIdentity,
      secret: automationSecret,
      fetch: automationFetchFor(app),
      now: () => new Date().toISOString(),
    });

    await expect(createDaemon(app, interruptedClient).runOnce()).rejects.toThrow('simulated_restart_before_claim');

    const pendingActionRuns = await actionRuns(repository);
    expect(pendingActionRuns).toHaveLength(expectedInitialPendingActionTypes.length);
    expect(sortedActionTypes(pendingActionRuns)).toEqual([...expectedInitialPendingActionTypes]);
    expect(pendingActionRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action_type: 'ensure_plan_draft', status: 'pending', attempt: 0 }),
        expect.objectContaining({ action_type: 'project_runtime_snapshot', status: 'pending', attempt: 0 }),
      ]),
    );
    const pendingIds = new Set(pendingActionRuns.map((actionRun) => actionRun.id));
    const pendingIdempotencyKeys = new Set(pendingActionRuns.map((actionRun) => actionRun.idempotency_key));
    expect(pendingIds.size).toBe(pendingActionRuns.length);
    expect(pendingIdempotencyKeys.size).toBe(pendingActionRuns.length);

    const replayedAction = interruptedClient.createOrReplayActions[0]!;
    const existingReplayRow = pendingActionRuns.find((actionRun) => actionRun.idempotency_key === replayedAction.idempotencyKey);
    expect(existingReplayRow).toBeDefined();
    const replayed = await createAutomationClient(app).createOrReplayAction(replayedAction);
    expect(replayed.action).toMatchObject({
      id: existingReplayRow!.id,
      status: 'pending',
      attempt: 0,
      idempotencyKey: replayedAction.idempotencyKey,
    });
    expect(await actionRuns(repository)).toHaveLength(pendingActionRuns.length);

    const restarted = createDaemon(app);
    await runUntil(
      restarted,
      async () => {
        const runs = await actionRuns(repository);
        return runs.length === pendingActionRuns.length && runs.every((actionRun) => actionRun.status === 'succeeded');
      },
      'pending_action_runs_completed_after_restart',
    );

    const recoveredActionRuns = await actionRuns(repository);
    expect(new Set(recoveredActionRuns.map((actionRun) => actionRun.id))).toEqual(pendingIds);
    expect(new Set(recoveredActionRuns.map((actionRun) => actionRun.idempotency_key))).toEqual(pendingIdempotencyKeys);
    expectSucceededActionLifecycle(recoveredActionRuns, 'ensure_plan_draft');
    expectSucceededActionLifecycle(recoveredActionRuns, 'project_runtime_snapshot');
    expect((await repository.getWorkItem(seeded.workItem.id))?.current_plan_id).toEqual(expect.any(String));
  });

  it('requests manual path instead of drafting when a project target matches multiple draft-enabled repos', async () => {
    const { app, repository } = await bootAutomationApp();
    const seeded = await seedDraftOnlyApprovedSpec(app);
    const server = app.getHttpServer();
    const repoTwoRoot = path.join(tempRoot, 'repo-2');
    await mkdir(repoTwoRoot, { recursive: true });
    await writeFile(path.join(repoTwoRoot, 'WORKFLOW.md'), testRuntimePolicyMarkdown(), 'utf8');

    await request(server)
      .post(`/projects/${seeded.project.id}/repos`)
      .send({
        repo_id: 'repo-2',
        name: 'forgeloop-secondary',
        local_path: repoTwoRoot,
        default_branch: 'main',
        base_commit_sha: 'def456',
      })
      .expect(201);
    await request(server)
      .post(`/automation/projects/${seeded.project.id}/capabilities`)
      .set(humanAdminHeaders)
      .send({
        repo_id: 'repo-2',
        preset: 'draft_only',
        expected_version: 0,
        reason: 'enable ambiguity regression coverage',
        evidence_refs: [],
        actor_context: { actor_id: actorOwner, actor_class: 'human_admin' },
      })
      .expect(201);

    await runUntil(
      createDaemon(app),
      async () => {
        const holds = await repository.listActiveManualPathHolds({
          object_type: 'work_item',
          object_id: seeded.workItem.id,
        });
        return holds.some((hold) => hold.reason_code === 'multi_repo_ambiguity');
      },
      'multi_repo_manual_path_created',
    );

    const workItem = await repository.getWorkItem(seeded.workItem.id);
    const holds = await repository.listActiveManualPathHolds({
      object_type: 'work_item',
      object_id: seeded.workItem.id,
    });
    expect(workItem?.current_plan_id).toBeUndefined();
    expect(holds).toContainEqual(
      expect.objectContaining({
        object_type: 'work_item',
        object_id: seeded.workItem.id,
        scope_key: `work_item:${seeded.workItem.id}`,
        reason_code: 'multi_repo_ambiguity',
      }),
    );
    expect((await actionRuns(repository)).map((actionRun) => actionRun.action_type)).toContain('request_manual_path');
  });
});
