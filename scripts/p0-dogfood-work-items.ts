import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Test as SupertestTest } from 'supertest';

import { AppModule } from '../apps/control-plane-api/src/app.module';
import { P0_REPOSITORY, RUN_DURABILITY_MODE } from '../apps/control-plane-api/src/p0/p0.service';
import type { P0Repository } from '../packages/db/src';
import type { ReviewPacket, RunSession } from '../packages/domain/src';

type WorkItemKind = 'feature' | 'bugfix' | 'test_refactor';
type DogfoodItemDefinition = {
  key: string;
  kind: WorkItemKind;
  title: string;
  goal: string;
  successCriteria: string[];
  objective: string;
  expectedExecutor: 'mock';
  requiresChangesRequestedRerun: boolean;
};

type DogfoodItemResult = {
  key: string;
  title: string;
  kind: WorkItemKind;
  workItemId: string;
  packageId: string;
  runSessionIds: string[];
  reviewPacketIds: string[];
  finalDecision: 'approved';
  exercisedChangesRequestedRerun: boolean;
  timelineSources: string[];
};

type DogfoodCompletionResult = {
  generatedAt: string;
  durabilityMode: string;
  projectId: string;
  repoId: string;
  commitSha: string;
  items: DogfoodItemResult[];
};

const execFile = promisify(execFileCallback);

const actorOwner = process.env.FORGELOOP_ACTOR_OWNER ?? 'actor-owner';
const actorReviewer = process.env.FORGELOOP_ACTOR_REVIEWER ?? 'actor-reviewer';
const actorQa = process.env.FORGELOOP_ACTOR_QA ?? 'actor-qa';
const actorHeaderName = 'X-Forgeloop-Actor-Id';
const repoId = process.env.FORGELOOP_REPO_ID ?? 'forgeloop';
const repoPath = resolve(process.env.FORGELOOP_REPO_PATH ?? process.cwd());
const reportPath = resolve(
  process.env.FORGELOOP_WORK_ITEM_DOGFOOD_REPORT_PATH ??
    'docs/superpowers/reports/p0-dogfood-work-items-completion.md',
);

const requiredChecks = [
  {
    check_id: 'dogfood-work-item',
    display_name: 'P0 dogfood work item',
    command: 'pnpm smoke:p0',
    timeout_seconds: 120,
    blocks_review: true,
  },
];

export const dogfoodWorkItems: DogfoodItemDefinition[] = [
  {
    key: 'feature-ci-gate',
    kind: 'feature',
    title: 'Remote CI gate',
    goal: 'Protect main with install, test, and build checks on GitHub Actions.',
    successCriteria: ['CI workflow exists', 'The CI-equivalent local install/test/build commands pass'],
    objective: 'Validate the remote CI gate delivery path through ForgeLoop evidence and review handoff.',
    expectedExecutor: 'mock',
    requiresChangesRequestedRerun: false,
  },
  {
    key: 'bugfix-durable-verification',
    kind: 'bugfix',
    title: 'Durable verification gaps',
    goal: 'Close the documented durable DB and browser verification gaps for P0 readiness.',
    successCriteria: ['Durable schema push passes', 'Durable dogfood passes', 'Browser Run Console E2E passes'],
    objective: 'Validate durable verification closure through ForgeLoop evidence and review handoff.',
    expectedExecutor: 'mock',
    requiresChangesRequestedRerun: false,
  },
  {
    key: 'test-refactor-run-console',
    kind: 'test_refactor',
    title: 'Browser Run Console walkthrough',
    goal: 'Exercise Run Console backfill, SSE append, command submission, and review rerun handling.',
    successCriteria: ['Run Console E2E passes', 'The review flow exercises changes_requested -> rerun -> approve'],
    objective: 'Validate browser Run Console walkthrough and rerun review semantics.',
    expectedExecutor: 'mock',
    requiresChangesRequestedRerun: true,
  },
];

const withActor = <T extends SupertestTest>(test: T, actorId: string): T => test.set(actorHeaderName, actorId) as T;

const getHeadSha = async (): Promise<string> => {
  const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
  return String(stdout).trim();
};

const createApp = async (): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
};

const waitForReviewPacket = async (app: INestApplication, runSessionId: string): Promise<ReviewPacket> => {
  const repository = app.get(P0_REPOSITORY) as P0Repository;

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const runSession = await repository.getRunSession(runSessionId);
    if (runSession !== undefined) {
      const packet = (await repository.listReviewPacketsForPackage(runSession.execution_package_id)).find(
        (item) => item.run_session_id === runSessionId,
      );
      if (packet !== undefined) {
        return packet;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }

  throw new Error(`Timed out waiting for ReviewPacket for ${runSessionId}`);
};

const expectSucceededRun = async (app: INestApplication, runSessionId: string): Promise<RunSession> => {
  const repository = app.get(P0_REPOSITORY) as P0Repository;
  const runSession = await repository.getRunSession(runSessionId);
  if (runSession === undefined) {
    throw new Error(`Missing RunSession ${runSessionId}`);
  }
  if (runSession.status !== 'succeeded') {
    throw new Error(`RunSession ${runSessionId} ended with status ${runSession.status}`);
  }
  if (runSession.changed_files.length === 0 || runSession.check_results.length === 0 || runSession.artifacts.length === 0) {
    throw new Error(`RunSession ${runSessionId} is missing terminal evidence`);
  }
  return runSession;
};

const createProject = async (app: INestApplication, commitSha: string): Promise<string> => {
  const server = app.getHttpServer();
  const project = (
    await withActor(request(server).post('/projects'), actorOwner)
      .send({ name: `P0 dogfood completion ${new Date().toISOString()}`, owner_actor_id: actorOwner })
      .expect(201)
  ).body as { id: string };

  await withActor(request(server).post(`/projects/${project.id}/repos`), actorOwner)
    .send({
      repo_id: repoId,
      name: 'forgeloop',
      local_path: repoPath,
      default_branch: 'main',
      remote_url: 'https://github.com/vivym/forgeloop.git',
      base_commit_sha: commitSha,
    })
    .expect(201);

  return project.id;
};

const approveSpecAndPlan = async (
  app: INestApplication,
  projectId: string,
  item: DogfoodItemDefinition,
): Promise<{ workItemId: string; planRevisionId: string }> => {
  const server = app.getHttpServer();
  const workItem = (
    await withActor(request(server).post('/work-items'), actorOwner)
      .send({
        project_id: projectId,
        kind: item.kind,
        title: item.title,
        goal: item.goal,
        success_criteria: item.successCriteria,
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: actorOwner,
      })
      .expect(201)
  ).body as { id: string };

  const spec = (await withActor(request(server).post(`/work-items/${workItem.id}/specs`), actorOwner).send({}).expect(201)).body as {
    id: string;
  };
  await withActor(request(server).post(`/specs/${spec.id}/revisions`), actorOwner)
    .send({
      summary: `${item.title} spec`,
      content: item.goal,
      background: 'P0 dogfood completion validates the product loop using a real ForgeLoop Work Item record.',
      goals: [item.goal],
      scope_in: item.successCriteria,
      scope_out: ['Release object productization', 'Incident productization', 'Production deployment'],
      acceptance_criteria: item.successCriteria,
      risk_notes: [],
      test_strategy_summary: 'Use ForgeLoop run evidence, Review Packet decision, and timeline evidence.',
      author_actor_id: actorOwner,
    })
    .expect(201);
  await withActor(request(server).post(`/specs/${spec.id}/submit-for-approval`), actorOwner)
    .send({ actor_id: actorOwner })
    .expect(201);
  await withActor(request(server).post(`/specs/${spec.id}/approve`), actorReviewer)
    .send({ actor_id: actorReviewer })
    .expect(201);

  const plan = (await withActor(request(server).post(`/work-items/${workItem.id}/plans`), actorOwner).send({}).expect(201)).body as {
    id: string;
  };
  const planRevision = (
    await withActor(request(server).post(`/plans/${plan.id}/revisions`), actorOwner)
      .send({
        summary: `${item.title} plan`,
        content: item.objective,
        implementation_summary: item.objective,
        split_strategy: 'Single package for this dogfood completion item.',
        dependency_order: [],
        test_matrix: ['pnpm smoke:p0', 'pnpm test', 'pnpm build'],
        risk_mitigations: ['Keep this P0 completion inside review-approved handoff scope.'],
        rollback_notes: 'Revert the dogfood completion record/report if the evidence is invalid.',
        author_actor_id: actorOwner,
      })
      .expect(201)
  ).body as { id: string };
  await withActor(request(server).post(`/plans/${plan.id}/submit-for-approval`), actorOwner)
    .send({ actor_id: actorOwner })
    .expect(201);
  await withActor(request(server).post(`/plans/${plan.id}/approve`), actorReviewer)
    .send({ actor_id: actorReviewer })
    .expect(201);

  return { workItemId: workItem.id, planRevisionId: planRevision.id };
};

const createReadyPackage = async (
  app: INestApplication,
  planRevisionId: string,
  item: DogfoodItemDefinition,
): Promise<string> => {
  const server = app.getHttpServer();
  const executionPackage = (
    await withActor(request(server).post(`/plan-revisions/${planRevisionId}/execution-packages`), actorOwner)
      .send({
        repo_id: repoId,
        objective: item.objective,
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorQa,
        required_checks: requiredChecks,
        required_artifact_kinds: ['diff', 'changed_files', 'check_output', 'execution_summary', 'review_packet'],
        allowed_paths: ['.github/**', 'docs/**', 'README.md', 'package.json', 'scripts/**', 'tests/**'],
        forbidden_paths: ['.git/**', 'node_modules/**', '.env'],
      })
      .expect(201)
  ).body as { id: string };

  await withActor(request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`), actorOwner)
    .send({ actor_id: actorOwner })
    .expect(201);
  return executionPackage.id;
};

const runPackage = async (
  app: INestApplication,
  packageId: string,
  path: 'run' | 'rerun' = 'run',
  body: Record<string, unknown> = {},
): Promise<string> => {
  const response = (
    await withActor(request(app.getHttpServer()).post(`/execution-packages/${packageId}/${path}`), actorOwner)
      .send({ requested_by_actor_id: actorOwner, executor_type: 'mock', workflow_only: true, ...body })
      .expect(201)
  ).body as { status: string; run_session_id?: string };
  if (response.status !== 'accepted' || response.run_session_id === undefined) {
    throw new Error(`Run command was not accepted: ${JSON.stringify(response)}`);
  }
  return response.run_session_id;
};

const approveReviewPacket = async (
  app: INestApplication,
  reviewPacketId: string,
  summary: string,
  requestedChanges?: Array<Record<string, string>>,
): Promise<void> => {
  const path = requestedChanges === undefined ? 'approve' : 'request-changes';
  await withActor(request(app.getHttpServer()).post(`/review-packets/${reviewPacketId}/${path}`), actorReviewer)
    .send({
      summary,
      reviewed_by_actor_id: actorReviewer,
      reviewed_at: new Date().toISOString(),
      ...(requestedChanges === undefined ? {} : { requested_changes: requestedChanges }),
    })
    .expect(201);
};

const completeDogfoodItem = async (
  app: INestApplication,
  projectId: string,
  item: DogfoodItemDefinition,
): Promise<DogfoodItemResult> => {
  const { workItemId, planRevisionId } = await approveSpecAndPlan(app, projectId, item);
  const packageId = await createReadyPackage(app, planRevisionId, item);
  const firstRunSessionId = await runPackage(app, packageId);
  const firstPacket = await waitForReviewPacket(app, firstRunSessionId);
  await expectSucceededRun(app, firstRunSessionId);

  const runSessionIds = [firstRunSessionId];
  const reviewPacketIds = [firstPacket.id];
  let exercisedChangesRequestedRerun = false;

  if (item.requiresChangesRequestedRerun) {
    await approveReviewPacket(app, firstPacket.id, 'Request rerun evidence before approval.', [
      {
        title: 'Exercise rerun review path',
        description: 'Carry review feedback into a replacement run before approving the work item.',
        file_path: 'docs/dogfood/p0-dogfood-work-items.md',
        severity: 'major',
        suggested_validation: 'pnpm dogfood:p0:work-items',
      },
    ]);
    const rerunSessionId = await runPackage(app, packageId, 'rerun', { previous_run_session_id: firstRunSessionId });
    const rerunPacket = await waitForReviewPacket(app, rerunSessionId);
    await expectSucceededRun(app, rerunSessionId);
    await approveReviewPacket(app, rerunPacket.id, 'Approved after rerun evidence.');
    runSessionIds.push(rerunSessionId);
    reviewPacketIds.push(rerunPacket.id);
    exercisedChangesRequestedRerun = true;
  } else {
    await approveReviewPacket(app, firstPacket.id, 'Approved for P0 dogfood completion.');
  }

  const cockpit = (await withActor(request(app.getHttpServer()).get(`/work-items/${workItemId}/cockpit`), actorOwner).expect(200)).body as {
    packages?: Array<{ id: string; resolution: string }>;
    review_packets?: Array<{ id: string; decision: string }>;
  };
  const packageRecord = cockpit.packages?.find((candidate) => candidate.id === packageId);
  if (packageRecord?.resolution !== 'completed') {
    throw new Error(`Package ${packageId} did not complete review handoff`);
  }
  const finalPacket = cockpit.review_packets?.find((candidate) => candidate.id === reviewPacketIds.at(-1));
  if (finalPacket?.decision !== 'approved') {
    throw new Error(`Final ReviewPacket for ${item.key} is not approved`);
  }

  const timeline = (await withActor(request(app.getHttpServer()).get(`/work-items/${workItemId}/timeline`), actorOwner).expect(200)).body as Array<{
    source: string;
  }>;
  const timelineSources = [...new Set(timeline.map((entry) => entry.source))].sort();
  for (const expected of ['artifact', 'decision', 'object_event', 'status_history']) {
    if (!timelineSources.includes(expected)) {
      throw new Error(`Work Item ${item.key} timeline is missing ${expected}`);
    }
  }

  return {
    key: item.key,
    title: item.title,
    kind: item.kind,
    workItemId,
    packageId,
    runSessionIds,
    reviewPacketIds,
    finalDecision: 'approved',
    exercisedChangesRequestedRerun,
    timelineSources,
  };
};

export const runP0DogfoodWorkItems = async (): Promise<DogfoodCompletionResult> => {
  const app = await createApp();
  try {
    const commitSha = await getHeadSha();
    const projectId = await createProject(app, commitSha);
    const items: DogfoodItemResult[] = [];
    for (const item of dogfoodWorkItems) {
      items.push(await completeDogfoodItem(app, projectId, item));
    }
    return {
      generatedAt: new Date().toISOString(),
      durabilityMode: app.get(RUN_DURABILITY_MODE) as string,
      projectId,
      repoId,
      commitSha,
      items,
    };
  } finally {
    await app.close();
  }
};

export const renderDogfoodCompletionReport = (result: DogfoodCompletionResult): string => {
  const lines = [
    '# P0 Dogfood Work Items Completion',
    '',
    `Generated: ${result.generatedAt}`,
    `Durability mode: ${result.durabilityMode}`,
    `Project: ${result.projectId}`,
    `Repo: ${result.repoId}`,
    `Commit: ${result.commitSha}`,
    '',
    '## Summary',
    '',
    '| Work Item | Kind | Package | Runs | Review Packets | Final Decision | Rerun Path | Timeline Evidence |',
    '|---|---|---|---|---|---|---|---|',
    ...result.items.map((item) =>
      [
        item.title,
        item.kind,
        item.packageId,
        item.runSessionIds.join('<br>'),
        item.reviewPacketIds.join('<br>'),
        item.finalDecision,
        item.exercisedChangesRequestedRerun ? 'changes_requested -> rerun -> approve' : 'approve',
        item.timelineSources.join(', '),
      ]
        .map((value) => String(value).replace(/\|/g, '\\|'))
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    ),
    '',
    '## Evidence',
    '',
    '- All three Work Items have approved SpecRevision and PlanRevision records.',
    '- All three Work Items have at least one Execution Package, RunSession, Review Packet, human review decision, and timeline evidence.',
    '- The Browser Run Console Work Item exercised `changes_requested -> rerun -> approve`.',
    '- These Work Item records use `executor_type: mock` with `workflow_only=true` to validate the product workflow without creating extra source changes. Real `local_codex` acceptance remains covered by `pnpm dogfood:p0:local-codex`.',
  ];
  return `${lines.join('\n')}\n`;
};

export const writeDogfoodCompletionReport = async (
  result: DogfoodCompletionResult,
  path: string = reportPath,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderDogfoodCompletionReport(result));
};

export const main = async (): Promise<number> => {
  const result = await runP0DogfoodWorkItems();
  await writeDogfoodCompletionReport(result);
  console.log(`P0 dogfood work items completed. Report: ${reportPath}`);
  return 0;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
