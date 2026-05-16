import 'reflect-metadata';

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AutomationDaemon } from '../apps/automation-daemon/src/automation-daemon';
import { loadDaemonWorkflowPolicyDigest } from '../apps/automation-daemon/src/workflow-policy-loader';
import {
  AutomationHttpClient,
  type AutomationActionResponse,
  type ClaimNextActionInput,
  type NextAction,
} from '../packages/automation/src/index';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../packages/db/src/index';
import type { Plan, PlanRevision, Project, Spec, WorkItem } from '../packages/domain/src/index';
import {
  automationDogfoodExitCode,
  renderAutomationDogfoodSummary,
  type AutomationDogfoodSummaryInput,
} from './automation-dogfood-summary';

interface AutomationDogfoodResult extends AutomationDogfoodSummaryInput {
  exitCode: number;
}

const automationSecret = process.env.FORGELOOP_AUTOMATION_DOGFOOD_SECRET ?? 'automation-dogfood-secret';
const automationActorId = process.env.FORGELOOP_AUTOMATION_ACTOR_ID ?? 'automation-dogfood-actor';
const automationDaemonIdentity = process.env.FORGELOOP_AUTOMATION_DAEMON_IDENTITY ?? 'automation-dogfood-daemon';
const actorOwner = process.env.FORGELOOP_ACTOR_OWNER ?? 'actor-owner';
const actorReviewer = process.env.FORGELOOP_ACTOR_REVIEWER ?? 'actor-reviewer';
const repoId = process.env.FORGELOOP_REPO_ID ?? 'forgeloop';
const repoPath = resolve(process.env.FORGELOOP_REPO_PATH ?? process.cwd());
const expectedPendingBeforeRestartActionTypes = ['ensure_plan_draft', 'project_runtime_snapshot'] as const;

const humanAdminHeaders = {
  'x-forgeloop-actor-id': actorOwner,
  'x-forgeloop-actor-class': 'human_admin',
};
const reviewerHeaders = {
  'x-forgeloop-actor-id': actorReviewer,
  'x-forgeloop-actor-class': 'human',
};

const bootControlPlane = async (): Promise<{ app: INestApplication; repository: DeliveryRepository; baseUrl: string }> => {
  const [{ AppModule }, { DELIVERY_REPOSITORY }, { RUN_WORKER }] = await Promise.all([
    import('../apps/control-plane-api/src/app.module'),
    import('../apps/control-plane-api/src/modules/core/control-plane-tokens'),
    import('../apps/control-plane-api/src/p0/p0.service'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(new InMemoryDeliveryRepository())
    .overrideProvider(RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  return { app, repository: app.get(DELIVERY_REPOSITORY) as DeliveryRepository, baseUrl: `http://127.0.0.1:${address.port}` };
};

const createAutomationClient = (baseUrl: string): AutomationHttpClient =>
  new AutomationHttpClient({
    baseUrl,
    actorId: automationActorId,
    daemonIdentity: automationDaemonIdentity,
    secret: automationSecret,
  });

const createDaemon = (baseUrl: string, client = createAutomationClient(baseUrl)): AutomationDaemon =>
  new AutomationDaemon({
    client,
    actorId: automationActorId,
    daemonIdentity: automationDaemonIdentity,
    allowedRepoRoots: [repoPath],
    policyParserVersion: 'workflow-md-parser:v1',
    policyLoader: loadDaemonWorkflowPolicyDigest,
    loopIntervalMs: 1,
    noClaimBackoffMs: 1,
  });

const seedDraftOnlyApprovedSpec = async (
  app: INestApplication,
): Promise<{ project: Project; workItem: WorkItem; spec: Spec; specRevisionId: string }> => {
  const server = app.getHttpServer();
  const project = (await request(server).post('/projects').send({ name: 'Automation dogfood', owner_actor_id: actorOwner }).expect(201))
    .body as Project;
  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: repoId,
      name: repoId,
      local_path: repoPath,
      default_branch: 'main',
      base_commit_sha: 'automation-dogfood-base',
    })
    .expect(201);
  await request(server)
    .post(`/p0/projects/${project.id}/automation/capabilities`)
    .set(humanAdminHeaders)
    .send({
      repo_id: repoId,
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable deterministic automation daemon dogfood',
      evidence_refs: [],
      actor_context: { actor_id: actorOwner, actor_class: 'human_admin' },
    })
    .expect(201);
  const workItem = (await request(server)
    .post('/work-items')
    .send({
      project_id: project.id,
      kind: 'requirement',
      title: 'Dogfood HTTP automation daemon',
      goal: 'Create draft artifacts through the HTTP automation daemon.',
      success_criteria: ['Plan and package drafts are created without enqueueing a run.'],
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
  repository: DeliveryRepository,
  workItemId: string,
): Promise<{ plan: Plan; revision: PlanRevision }> => {
  const workItem = await repository.getWorkItem(workItemId);
  if (workItem?.current_plan_id === undefined) {
    throw new Error('automation_dogfood_missing_plan_draft');
  }
  const plan = await repository.getPlan(workItem.current_plan_id);
  if (plan === undefined || plan.current_revision_id === undefined) {
    throw new Error('automation_dogfood_missing_plan_revision');
  }
  const revision = await repository.getPlanRevision(plan.current_revision_id);
  if (revision === undefined) {
    throw new Error('automation_dogfood_missing_plan_revision');
  }

  const server = app.getHttpServer();
  await request(server).post(`/plans/${plan.id}/submit-for-approval`).set(humanAdminHeaders).send({ actor_id: actorOwner }).expect(201);
  const approvedPlan = (await request(server)
    .post(`/plans/${plan.id}/approve`)
    .set(reviewerHeaders)
    .send({ actor_id: actorReviewer })
    .expect(201)).body as Plan;
  return { plan: approvedPlan, revision };
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
  throw new Error(`automation_dogfood_condition_not_met:${label}`);
};

const drainDaemon = async (daemon: AutomationDaemon, label: string): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    const result = await daemon.runOnce();
    if (result.plannedActionCount === 0 && result.executed.reasonCode === 'no_claimable_action') {
      return;
    }
  }
  throw new Error(`automation_dogfood_condition_not_met:${label}`);
};

class RestartBeforeClaimClient extends AutomationHttpClient {
  readonly createOrReplayActions: NextAction[] = [];

  override async createOrReplayAction(action: NextAction): Promise<AutomationActionResponse> {
    this.createOrReplayActions.push(action);
    return super.createOrReplayAction(action);
  }

  override async claimNextAction(_input: ClaimNextActionInput): Promise<AutomationActionResponse> {
    throw new Error('automation_dogfood_simulated_restart_before_claim');
  }
}

const sortedActionTypes = (runs: { action_type: string }[]): string[] => runs.map((actionRun) => actionRun.action_type).sort();

const runDogfood = async (): Promise<AutomationDogfoodResult> => {
  const previousSecret = process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
  process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = automationSecret;
  let app: INestApplication | undefined;
  try {
    const booted = await bootControlPlane();
    app = booted.app;
    const { repository, baseUrl } = booted;
    const seeded = await seedDraftOnlyApprovedSpec(app);
    const interruptedClient = new RestartBeforeClaimClient({
      baseUrl,
      actorId: automationActorId,
      daemonIdentity: automationDaemonIdentity,
      secret: automationSecret,
    });

    try {
      await createDaemon(baseUrl, interruptedClient).runOnce();
      throw new Error('automation_dogfood_expected_restart_before_claim');
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'automation_dogfood_simulated_restart_before_claim') {
        throw error;
      }
    }

    const pendingBeforeRestart = (await repository.getRuntimeSnapshotData()).recent_action_runs.filter(
      (actionRun) => actionRun.status === 'pending',
    );
    const pendingBeforeRestartIds = new Set(pendingBeforeRestart.map((actionRun) => actionRun.id));
    const pendingBeforeRestartKeys = new Set(pendingBeforeRestart.map((actionRun) => actionRun.idempotency_key));
    const pendingBeforeRestartActionTypes = sortedActionTypes(pendingBeforeRestart);
    const daemon = createDaemon(baseUrl);

    await runUntil(
      daemon,
      async () => (await repository.getWorkItem(seeded.workItem.id))?.current_plan_id !== undefined,
      'plan_draft_created',
    );
    await approveCurrentPlan(app, repository, seeded.workItem.id);
    await runUntil(
      daemon,
      async () => (await repository.listExecutionPackagesForWorkItem(seeded.workItem.id)).length > 0,
      'package_drafts_created',
    );
    await drainDaemon(daemon, 'daemon_drained');

    const packages = await repository.listExecutionPackagesForWorkItem(seeded.workItem.id);
    const runSessions = (await Promise.all(packages.map((item) => repository.listRunSessionsForPackage(item.id)))).flat();
    const actionRuns = (await repository.getRuntimeSnapshotData()).recent_action_runs;
    const completedActionTypes = actionRuns
      .filter((actionRun) => actionRun.status === 'succeeded')
      .map((actionRun) => actionRun.action_type);
    const recoveredPendingRuns = actionRuns.filter((actionRun) => pendingBeforeRestartIds.has(actionRun.id));
    const pendingKeyOccurrences = actionRuns.filter((actionRun) => pendingBeforeRestartKeys.has(actionRun.idempotency_key));
    const summary: AutomationDogfoodSummaryInput = {
      planDraftCreated: (await repository.getWorkItem(seeded.workItem.id))?.current_plan_id !== undefined,
      packageDraftCount: packages.length,
      completedActionTypes,
      actionRunCount: actionRuns.length,
      nonSucceededActionRunCount: actionRuns.filter((actionRun) => actionRun.status !== 'succeeded').length,
      runSessionCount: runSessions.length,
      restartRecoveredFromActionRuns:
        pendingBeforeRestart.length > 0 &&
        pendingBeforeRestart.length === expectedPendingBeforeRestartActionTypes.length &&
        pendingBeforeRestartActionTypes.every((actionType, index) => actionType === expectedPendingBeforeRestartActionTypes[index]) &&
        interruptedClient.createOrReplayActions.length === pendingBeforeRestart.length &&
        pendingBeforeRestartIds.size === pendingBeforeRestart.length &&
        pendingBeforeRestartKeys.size === pendingBeforeRestart.length &&
        recoveredPendingRuns.length === pendingBeforeRestart.length &&
        recoveredPendingRuns.every((actionRun) => actionRun.status === 'succeeded') &&
        pendingKeyOccurrences.length === pendingBeforeRestart.length,
    };
    return { ...summary, exitCode: automationDogfoodExitCode(summary) };
  } finally {
    if (app !== undefined) {
      await app.close();
    }
    if (previousSecret === undefined) {
      delete process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
    } else {
      process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = previousSecret;
    }
  }
};

export const main = async (): Promise<number> => {
  const result = await runDogfood();
  console.log(renderAutomationDogfoodSummary(result));
  return result.exitCode;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
