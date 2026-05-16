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
import { P0_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { RUN_WORKER } from '../../apps/control-plane-api/src/p0/p0.service';
import {
  AutomationHttpClient,
  type AutomationActionResponse,
  type AutomationFetch,
  type ClaimNextActionInput,
} from '../../packages/automation/src/index';
import { InMemoryP0Repository, type P0Repository } from '../../packages/db/src/index';
import type { AutomationActionRun } from '../../packages/domain/src/automation';
import type { Plan, PlanRevision, Project, Spec, WorkItem } from '../../packages/domain/src/index';

const automationSecret = 'test-secret';
const automationActorId = 'daemon-actor';
const automationDaemonIdentity = 'daemon-1';
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const now = '2026-05-16T00:00:00.000Z';

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

const bootAutomationApp = async (): Promise<{ app: INestApplication; repository: P0Repository }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(P0_REPOSITORY)
    .useValue(new InMemoryP0Repository())
    .overrideProvider(RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useLogger(false);
  await app.init();
  apps.push(app);
  return { app, repository: app.get(P0_REPOSITORY) as P0Repository };
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

const createDaemon = (app: INestApplication, client: AutomationDaemonClient = createAutomationClient(app)): AutomationDaemon =>
  new AutomationDaemon({
    client,
    actorId: automationActorId,
    daemonIdentity: automationDaemonIdentity,
    allowedRepoRoots: [tempRoot],
    policyParserVersion: 'workflow-md-parser:v1',
    policyLoader: loadDaemonWorkflowPolicyDigest,
    loopIntervalMs: 1,
    noClaimBackoffMs: 1,
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
    .post(`/p0/projects/${project.id}/automation/capabilities`)
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
      owner_actor_id: actorOwner,
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

const approveCurrentPlan = async (
  app: INestApplication,
  repository: P0Repository,
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
    await daemon.runOnce();
    if (await predicate()) {
      return;
    }
  }
  throw new Error(`automation_daemon_condition_not_met:${label}`);
};

class RestartBeforeClaimClient extends AutomationHttpClient {
  override async claimNextAction(_input: ClaimNextActionInput): Promise<AutomationActionResponse> {
    throw new Error('simulated_restart_before_claim');
  }
}

const actionRuns = async (repository: P0Repository): Promise<AutomationActionRun[]> =>
  (await repository.getRuntimeSnapshotData()).recent_action_runs;

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
  await writeFile(path.join(repoRoot, 'WORKFLOW.md'), '# Runtime policy\n\nRead-only daemon observability.\n', 'utf8');
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
  it('creates plan and package drafts through signed HTTP actions and recovers from action runs after restart', async () => {
    const { app, repository } = await bootAutomationApp();
    const seeded = await seedDraftOnlyApprovedSpec(app);
    const daemon = createDaemon(app);

    await runUntil(
      daemon,
      async () => (await repository.getWorkItem(seeded.workItem.id))?.current_plan_id !== undefined,
      'plan_draft_created',
    );
    const planContext = await approveCurrentPlan(app, repository, seeded.workItem.id);

    await runUntil(
      daemon,
      async () => (await repository.listExecutionPackagesForWorkItem(seeded.workItem.id)).length > 0,
      'package_drafts_created',
    );
    await runUntil(
      daemon,
      async () => {
        const result = await daemon.runOnce();
        return result.plannedActionCount === 0 && result.executed.reasonCode === 'no_claimable_action';
      },
      'daemon_drained',
    );

    const packages = await repository.listExecutionPackagesForWorkItem(seeded.workItem.id);
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      work_item_id: seeded.workItem.id,
      plan_revision_id: planContext.revision.id,
      generation_key: `default:${planContext.revision.id}`,
      repo_id: 'repo-1',
    });
    await expect(repository.listRunSessionsForPackage(packages[0]!.id)).resolves.toEqual([]);

    const completedActionRuns = await actionRuns(repository);
    const planAction = expectSucceededActionLifecycle(completedActionRuns, 'ensure_plan_draft');
    const packageAction = expectSucceededActionLifecycle(completedActionRuns, 'ensure_package_drafts');
    expectSucceededActionLifecycle(completedActionRuns, 'project_runtime_snapshot');
    expect(new Set(completedActionRuns.map((actionRun) => actionRun.idempotency_key)).size).toBe(completedActionRuns.length);
    expect(planAction.action_input_json).toMatchObject({ work_item_id: seeded.workItem.id, spec_revision_id: seeded.specRevisionId });
    expect(packageAction.action_input_json).toMatchObject({
      plan_revision_id: planContext.revision.id,
      generation_key: `default:${planContext.revision.id}`,
    });
    const actionRunCount = completedActionRuns.length;

    const restarted = createDaemon(app);
    const restartResult = await restarted.runOnce();
    const packagesAfterRestart = await repository.listExecutionPackagesForWorkItem(seeded.workItem.id);
    const actionRunsAfterRestart = await actionRuns(repository);

    expect(restartResult).toMatchObject({
      plannedActionCount: 0,
      executed: { status: 'skipped', reasonCode: 'no_claimable_action' },
    });
    expect(packagesAfterRestart).toHaveLength(1);
    expect(actionRunsAfterRestart).toHaveLength(actionRunCount);
    await expect(repository.listRunSessionsForPackage(packagesAfterRestart[0]!.id)).resolves.toEqual([]);
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
});
