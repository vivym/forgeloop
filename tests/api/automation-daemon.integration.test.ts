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
import type { Project, Spec, WorkItem } from '../../packages/domain/src/index';
import { seedItemScopedSpecPlan } from '../helpers/item-scoped-artifact-fixtures';
import { testRuntimePolicyMarkdown } from '../helpers/runtime-policy-repo';

const automationSecret = 'test-secret';
const automationActorId = 'daemon-actor';
const automationDaemonIdentity = 'daemon-1';
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const now = '2026-05-16T00:00:00.000Z';
const expectedCompletedActionTypes = [
  'ensure_package_drafts',
  'project_runtime_snapshot',
] as const;
const expectedInitialPendingActionTypes = ['ensure_package_drafts', 'project_runtime_snapshot'] as const;

const humanAdminHeaders = {
  'x-forgeloop-actor-id': actorOwner,
  'x-forgeloop-actor-class': 'human_admin',
};
const requirementIntakeContext = {
  type: 'requirement',
  stakeholder_problem: 'Automation daemon fixtures need typed intake context.',
  desired_outcome: 'Daemon integration tests create valid requirement Work Items.',
  acceptance_criteria: ['Daemon creates draft artifacts through valid Work Items.'],
  in_scope: ['Automation daemon integration tests'],
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
      'generationPlanning' | 'generationRuntime'
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
      intake_context: requirementIntakeContext,
    })
    .expect(201)).body as WorkItem;
  const { spec, specRevision } = await seedItemScopedSpecPlan(app, workItem.id, {
    actorId: actorOwner,
    reviewerActorId: actorReviewer,
    includePlan: false,
  });
  return { project, workItem, spec, specRevisionId: specRevision.id };
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
      intake_context: requirementIntakeContext,
    })
    .expect(201)).body as WorkItem;

  return { project, workItem };
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
  it('generates Package drafts for an approved PlanRevision without retired WorkItem draft actions', async () => {
    const { app, repository } = await bootAutomationApp();
    const seeded = await seedDraftOnlyApprovedSpec(app);
    const seededPlan = await seedItemScopedSpecPlan(app, seeded.workItem.id, {
      actorId: actorOwner,
      reviewerActorId: actorReviewer,
      includePlan: true,
      specStatus: 'approved',
      planStatus: 'approved',
    });
    const generationPlanning = fakeGenerationPlanning({
      package_drafts: { enabled: true, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
    });
    const daemon = createDaemon(app, createAutomationClient(app), { generationPlanning });

    await runUntil(
      daemon,
      async () => (await repository.listExecutionPackagesForWorkItem(seeded.workItem.id)).length > 0,
      'package_drafts_created',
    );
    await drainDaemon(daemon, 'package_daemon_drained');

    const packages = await repository.listExecutionPackagesForWorkItem(seeded.workItem.id);
    expect(packages.map((item) => item.plan_revision_id)).toEqual([seededPlan.planRevision!.id]);
    expect(packages.map((item) => item.phase)).toEqual(['draft']);
    const runs = await actionRuns(repository);
    expect(sortedActionTypes(runs)).toEqual(['ensure_package_drafts', 'project_runtime_snapshot']);
    expectSucceededActionLifecycle(runs, 'ensure_package_drafts');
    expectSucceededActionLifecycle(runs, 'project_runtime_snapshot');
  });

});
