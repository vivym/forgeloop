import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { ArtifactKind, EvidenceChainResponse, EvidenceChainSource } from '@forgeloop/contracts';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Test as SupertestTest } from 'supertest';

import { AppModule } from '../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY, RUN_DURABILITY_MODE } from '../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { DeliveryRepository } from '../packages/db/src';
import { seedItemScopedSpecPlan } from '../tests/helpers/item-scoped-artifact-fixtures';
import {
  deriveRequiredArtifactPresence,
  deriveWorkItemCompletion,
  type ExecutionPackage,
  type ReviewPacket,
  type RunSession,
  type WorkItem,
} from '../packages/domain/src';
import {
  preflightLocalCodexDogfood,
  STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST,
  STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE,
} from './delivery-local-codex-dogfood';

type WorkItemKind = 'requirement' | 'bug' | 'tech_debt';
type DogfoodExecutorType = 'mock' | 'local_codex';
type DogfoodRunMode = {
  executorType: DogfoodExecutorType;
  workflowOnly: boolean;
};
type DogfoodItemDefinition = {
  key: string;
  kind: WorkItemKind;
  title: string;
  goal: string;
  successCriteria: string[];
  objective: string;
  strictRunMode: DogfoodRunMode;
  requiresChangesRequestedRerun: boolean;
};
const intakeContextByKind = {
  requirement: {
    type: 'requirement',
    stakeholder_problem: 'Delivery dogfood fixtures need typed intake context.',
    desired_outcome: 'Dogfood Work Items can drive the delivery loop.',
    acceptance_criteria: ['Spec, plan, package, run, review, and completion evidence are persisted.'],
    in_scope: ['Delivery dogfood Work Item script'],
  },
  bug: {
    type: 'bug',
    impact_summary: 'Delivery dogfood must exercise bug Work Items.',
    observed_behavior: 'Legacy fixtures omitted typed intake context.',
    expected_behavior: 'Bug dogfood fixtures create valid Work Items.',
    reproduction_steps: ['Create a bug dogfood Work Item', 'Run the delivery loop'],
    affected_environment: 'delivery dogfood script',
    verification_path: 'Dogfood script assertions',
  },
  tech_debt: {
    type: 'tech_debt',
    current_pain: 'Delivery dogfood must exercise technical debt Work Items.',
    desired_invariant: 'Tech debt fixtures use typed intake context.',
    affected_modules: ['delivery-dogfood-work-items.ts'],
    behavior_preservation: 'Existing dogfood assertions still pass.',
    validation_strategy: 'Dogfood smoke test',
  },
} as const;

type DogfoodItemResult = {
  key: string;
  title: string;
  kind: WorkItemKind;
  workItemId: string;
  packageId: string;
  executorType: DogfoodExecutorType;
  workflowOnly: boolean;
  runSessionIds: string[];
  reviewPacketIds: string[];
  finalDecision: 'approved';
  exercisedChangesRequestedRerun: boolean;
  timelineSources: string[];
};

type StrictDirtySourceSummary = {
  allowed_dirty_entries: string[];
  blocked_dirty_entries: string[];
  dirty_allowlist_source: typeof STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE;
};

type StrictDogfoodBlocker = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type StrictQualifyingWorkItem = {
  workItemId: string;
  executionPackageId: string;
  runSessionId: string;
  reviewPacketId: string;
  executorType: 'local_codex';
  workflowOnly: false;
};

type StrictDogfoodAcceptance =
  | {
      status: 'disabled';
      qualifyingWorkItems: [];
      blockers: [];
      dirtySource?: StrictDirtySourceSummary;
    }
  | {
      status: 'blocked';
      qualifyingWorkItems: [];
      blockers: StrictDogfoodBlocker[];
      dirtySource?: StrictDirtySourceSummary;
    }
  | {
      status: 'passed' | 'failed';
      qualifyingWorkItems: StrictQualifyingWorkItem[];
      blockers: StrictDogfoodBlocker[];
      dirtySource?: StrictDirtySourceSummary;
    };

type DogfoodCompletionResult = {
  generatedAt: string;
  durabilityMode: string;
  projectId: string;
  repoId: string;
  commitSha: string;
  sourceTreeStatus: 'clean' | 'dirty';
  strictAcceptance: StrictDogfoodAcceptance;
  items: DogfoodItemResult[];
};

type CompletedDogfoodItem = {
  result: DogfoodItemResult;
  records: {
    workItem: WorkItem;
    executionPackages: ExecutionPackage[];
    runSessions: RunSession[];
    reviewPackets: ReviewPacket[];
  };
};

type ProductEvidenceSource = Extract<EvidenceChainSource, 'artifact' | 'decision' | 'object_event' | 'status_history'>;

const execFile = promisify(execFileCallback);

const actorOwner = process.env.FORGELOOP_ACTOR_OWNER ?? 'actor-owner';
const actorReviewer = process.env.FORGELOOP_ACTOR_REVIEWER ?? 'actor-reviewer';
const actorQa = process.env.FORGELOOP_ACTOR_QA ?? 'actor-qa';
const actorHeaderName = 'X-Forgeloop-Actor-Id';
const actorClassHeaderName = 'X-Forgeloop-Actor-Class';
const repoId = process.env.FORGELOOP_REPO_ID ?? 'forgeloop';
const repoPath = resolve(process.env.FORGELOOP_REPO_PATH ?? process.cwd());
const reportPath = resolve(
  process.env.FORGELOOP_WORK_ITEM_DOGFOOD_REPORT_PATH ??
    'docs/superpowers/reports/delivery-dogfood-work-items-completion.md',
);

export const dogfoodRequiredChecks = [
  {
    check_id: 'dogfood-work-item',
    display_name: 'Delivery dogfood work item',
    command: 'pnpm smoke:delivery',
    timeout_seconds: 120,
    blocks_review: true,
  },
];
const requiredChecks = dogfoodRequiredChecks;

const requiredArtifactKinds: ArtifactKind[] = ['diff', 'changed_files', 'check_output', 'execution_summary', 'review_packet'];
const productEvidenceSources = ['artifact', 'decision', 'object_event', 'status_history'] as const satisfies readonly ProductEvidenceSource[];

export const STRICT_WORK_ITEMS_DOGFOOD_DIRTY_ALLOWLIST_SOURCE = STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST_SOURCE;
export const STRICT_WORK_ITEMS_DOGFOOD_DIRTY_ALLOWLIST = STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST;

const boundedLocalCodexObjective = (input: {
  itemKey: string;
  validationFocus: string;
}): string =>
  [
    `Make a minimal docs-only dogfood evidence update for ${input.itemKey}.`,
    'Edit `docs/dogfood/delivery-dogfood-work-items.md` and add or update one short bullet for this Work Item.',
    `Mention this validation focus: ${input.validationFocus}.`,
    'Do not run `pnpm dogfood:delivery:work-items`.',
    'Do not run `pnpm test`.',
    'Do not run `pnpm build`.',
    'Do not start servers or background processes.',
    'ForgeLoop will run the required checks after your turn.',
  ].join('\n');

const strictDogfoodBlocker = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
): StrictDogfoodBlocker => ({
  code,
  message,
  ...(details === undefined ? {} : { details }),
});

const safeStrictBlockerDetailKeys = new Set([
  'actual_qualifying_work_items',
  'allowed_dirty_entries',
  'blocked_dirty_entries',
  'dirty_allowlist_source',
  'execution_package_id',
  'executor_type',
  'incomplete_reasons',
  'missing_artifact_kinds',
  'required_artifact_kinds',
  'required_env',
  'required_qualifying_work_items',
  'run_session_id',
  'status',
  'workflow_only',
  'work_item_id',
]);

const redactedStrictBlockerDetails = (details: Record<string, unknown>): Record<string, unknown> => {
  const redacted = Object.fromEntries(
    Object.entries(details).filter(([key]) => safeStrictBlockerDetailKeys.has(key)),
  );
  return Object.keys(redacted).length === Object.keys(details).length
    ? redacted
    : { ...redacted, redacted_detail_keys: Object.keys(details).filter((key) => !safeStrictBlockerDetailKeys.has(key)).sort() };
};

const approvedReviewPacketForRun = (
  executionPackage: ExecutionPackage,
  runSession: RunSession,
  reviewPackets: readonly ReviewPacket[],
): ReviewPacket | undefined =>
  reviewPackets.find(
    (reviewPacket) =>
      reviewPacket.execution_package_id === executionPackage.id &&
      reviewPacket.run_session_id === runSession.id &&
      reviewPacket.status === 'completed' &&
      reviewPacket.decision === 'approved',
  );

export const evaluateStrictLocalCodexAcceptance = (input: {
  workItems: readonly WorkItem[];
  executionPackages: readonly ExecutionPackage[];
  runSessions: readonly RunSession[];
  reviewPackets: readonly ReviewPacket[];
}): Extract<StrictDogfoodAcceptance, { status: 'passed' | 'failed' }> => {
  const candidateBlockers: StrictDogfoodBlocker[] = [];
  const qualifyingWorkItems: StrictQualifyingWorkItem[] = [];

  for (const workItem of input.workItems) {
    const packagesForWorkItem = input.executionPackages.filter(
      (executionPackage) => executionPackage.work_item_id === workItem.id,
    );
    const completion = deriveWorkItemCompletion(workItem, packagesForWorkItem, input.runSessions, input.reviewPackets);
    const workItemBlockers: StrictDogfoodBlocker[] = [];
    let qualifyingPackage: StrictQualifyingWorkItem | undefined;

    if (!completion.done) {
      workItemBlockers.push(
        strictDogfoodBlocker('work_item_completion_incomplete', 'Work Item has incomplete Execution Package evidence', {
          work_item_id: workItem.id,
          incomplete_reasons: completion.incomplete_reasons,
        }),
      );
    }

    for (const executionPackage of packagesForWorkItem) {
      if (executionPackage.last_run_session_id === undefined) {
        workItemBlockers.push(
          strictDogfoodBlocker('package_missing_current_run', 'Execution Package has no current RunSession', {
            work_item_id: workItem.id,
            execution_package_id: executionPackage.id,
          }),
        );
        continue;
      }

      const runSession = input.runSessions.find((candidate) => candidate.id === executionPackage.last_run_session_id);
      if (runSession === undefined) {
        workItemBlockers.push(
          strictDogfoodBlocker('run_session_missing', 'Execution Package current RunSession was not found', {
            work_item_id: workItem.id,
            execution_package_id: executionPackage.id,
            run_session_id: executionPackage.last_run_session_id,
          }),
        );
        continue;
      }

      const executorType = runSession.executor_type ?? runSession.run_spec?.executor_type;
      const workflowOnly = runSession.run_spec?.workflow_only;
      const approvedPacket = approvedReviewPacketForRun(executionPackage, runSession, input.reviewPackets);
      const missingArtifactKinds = deriveRequiredArtifactPresence(executionPackage, runSession, {
        reviewPackets: input.reviewPackets,
      }).missing_artifact_kinds;
      const runBlockers: StrictDogfoodBlocker[] = [];

      if (executorType !== 'local_codex') {
        runBlockers.push(
          strictDogfoodBlocker('run_session_not_local_codex', 'Current RunSession was not executed by local_codex', {
            work_item_id: workItem.id,
            execution_package_id: executionPackage.id,
            run_session_id: runSession.id,
            executor_type: executorType ?? null,
          }),
        );
      }

      if (workflowOnly !== false) {
        runBlockers.push(
          strictDogfoodBlocker('run_session_workflow_only', 'Current RunSession is workflow_only or missing workflow metadata', {
            work_item_id: workItem.id,
            execution_package_id: executionPackage.id,
            run_session_id: runSession.id,
            workflow_only: workflowOnly ?? null,
          }),
        );
      }

      if (runSession.status !== 'succeeded') {
        runBlockers.push(
          strictDogfoodBlocker('run_session_not_succeeded', 'Current RunSession did not succeed', {
            work_item_id: workItem.id,
            execution_package_id: executionPackage.id,
            run_session_id: runSession.id,
            status: runSession.status,
          }),
        );
      }

      if (approvedPacket === undefined) {
        runBlockers.push(
          strictDogfoodBlocker(
            'review_packet_missing_or_unapproved',
            'Current RunSession has no completed approved Review Packet for the same package and run',
            {
              work_item_id: workItem.id,
              execution_package_id: executionPackage.id,
              run_session_id: runSession.id,
            },
          ),
        );
      }

      if (missingArtifactKinds.length > 0) {
        workItemBlockers.push(
          strictDogfoodBlocker('required_artifact_missing', 'Current RunSession is missing required artifacts', {
            work_item_id: workItem.id,
            execution_package_id: executionPackage.id,
            run_session_id: runSession.id,
            required_artifact_kinds: executionPackage.required_artifact_kinds,
            missing_artifact_kinds: missingArtifactKinds,
          }),
        );
      }

      workItemBlockers.push(...runBlockers);

      if (completion.done && runBlockers.length === 0 && missingArtifactKinds.length === 0 && approvedPacket !== undefined) {
        qualifyingPackage ??= {
          workItemId: workItem.id,
          executionPackageId: executionPackage.id,
          runSessionId: runSession.id,
          reviewPacketId: approvedPacket.id,
          executorType: 'local_codex',
          workflowOnly: false,
        };
      }
    }

    if (completion.done && workItemBlockers.length === 0 && qualifyingPackage !== undefined) {
      qualifyingWorkItems.push(qualifyingPackage);
    } else {
      candidateBlockers.push(...workItemBlockers);
    }
  }

  if (qualifyingWorkItems.length >= 2) {
    return { status: 'passed', qualifyingWorkItems, blockers: [] };
  }

  return {
    status: 'failed',
    qualifyingWorkItems,
    blockers: [
      ...candidateBlockers,
      strictDogfoodBlocker('strict_minimum_not_met', 'Strict local_codex acceptance requires at least two qualifying Work Items', {
        required_qualifying_work_items: 2,
        actual_qualifying_work_items: qualifyingWorkItems.length,
      }),
    ],
  };
};

const strictAcceptanceDisabled = (): StrictDogfoodAcceptance => ({
  status: 'disabled',
  qualifyingWorkItems: [],
  blockers: [],
});

const strictAcceptanceFromPreflight = (
  preflight: Awaited<ReturnType<typeof preflightLocalCodexDogfood>>,
): StrictDogfoodAcceptance => ({
  status: 'blocked',
  qualifyingWorkItems: [],
  blockers: preflight.blockers.map((blocker) => strictDogfoodBlocker(blocker.code, blocker.message, blocker.details)),
  ...(preflight.dirtySource === undefined ? {} : { dirtySource: preflight.dirtySource }),
});

const isStrictLocalCodexDogfoodEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD === '1';

export const dogfoodWorkItems: DogfoodItemDefinition[] = [
  {
    key: 'feature-ci-gate',
    kind: 'requirement',
    title: 'Remote CI gate',
    goal: 'Protect main with install, test, and build checks on GitHub Actions.',
    successCriteria: ['CI workflow exists', 'The CI-equivalent local install/test/build commands pass'],
    objective: boundedLocalCodexObjective({
      itemKey: 'Remote CI gate',
      validationFocus: 'remote CI gate delivery path through ForgeLoop evidence and review handoff',
    }),
    strictRunMode: { executorType: 'local_codex', workflowOnly: false },
    requiresChangesRequestedRerun: false,
  },
  {
    key: 'bugfix-durable-verification',
    kind: 'bug',
    title: 'Durable verification gaps',
    goal: 'Close the documented durable DB and browser verification gaps for delivery readiness.',
    successCriteria: ['Durable schema push passes', 'Durable dogfood passes', 'Browser Run Console E2E passes'],
    objective: boundedLocalCodexObjective({
      itemKey: 'Durable verification gaps',
      validationFocus: 'durable verification closure through ForgeLoop evidence and review handoff',
    }),
    strictRunMode: { executorType: 'local_codex', workflowOnly: false },
    requiresChangesRequestedRerun: false,
  },
  {
    key: 'test-refactor-run-console',
    kind: 'tech_debt',
    title: 'Browser Run Console walkthrough',
    goal: 'Exercise Run Console backfill, SSE append, command submission, and review rerun handling.',
    successCriteria: ['Run Console E2E passes', 'The review flow exercises changes_requested -> rerun -> approve'],
    objective: 'Validate browser Run Console walkthrough and rerun review semantics.',
    strictRunMode: { executorType: 'mock', workflowOnly: true },
    requiresChangesRequestedRerun: true,
  },
];

const withActor = <T extends SupertestTest>(
  test: T,
  actorId: string,
  actorClass = actorId === actorReviewer ? 'human' : 'human_admin',
): T => test.set(actorHeaderName, actorId).set(actorClassHeaderName, actorClass) as T;

const getHeadSha = async (): Promise<string> => {
  const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
  return String(stdout).trim();
};

const getSourceTreeStatus = async (): Promise<'clean' | 'dirty'> => {
  const { stdout } = await execFile('git', ['status', '--short'], { cwd: repoPath });
  return String(stdout).trim().length === 0 ? 'clean' : 'dirty';
};

const createApp = async (): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
};

type ReviewPacketRepository = Pick<DeliveryRepository, 'getRunSession' | 'listReviewPacketsForPackage'>;

type ReviewPacketWaitOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

const terminalStatusesWithoutReviewPacket = new Set<RunSession['status']>(['failed', 'timed_out', 'cancelled', 'stalled']);

const delay = (ms: number): Promise<void> => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

export const waitForReviewPacketFromRepository = async (
  repository: ReviewPacketRepository,
  runSessionId: string,
  options: ReviewPacketWaitOptions = {},
): Promise<ReviewPacket> => {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const runSession = await repository.getRunSession(runSessionId);
    if (runSession !== undefined) {
      const packet = (await repository.listReviewPacketsForPackage(runSession.execution_package_id)).find(
        (item) => item.run_session_id === runSessionId,
      );
      if (packet !== undefined) {
        return packet;
      }
      if (terminalStatusesWithoutReviewPacket.has(runSession.status)) {
        throw new Error(`RunSession ${runSessionId} ended with status ${runSession.status} before ReviewPacket was created`);
      }
    }
    await delay(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for ReviewPacket for ${runSessionId}`);
};

const waitForReviewPacket = async (app: INestApplication, runSessionId: string): Promise<ReviewPacket> => {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

  return waitForReviewPacketFromRepository(repository, runSessionId);
};

const expectSucceededRun = async (app: INestApplication, runSessionId: string): Promise<RunSession> => {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
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

const uniqueSortedSources = (items: readonly { source: string }[]): string[] => [...new Set(items.map((entry) => entry.source))].sort();

const expectSources = (
  workItemKey: string,
  sourceLabel: string,
  actualSources: readonly string[],
  expectedSources: readonly ProductEvidenceSource[],
): void => {
  for (const expected of expectedSources) {
    if (!actualSources.includes(expected)) {
      throw new Error(`Work Item ${workItemKey} ${sourceLabel} is missing ${expected}`);
    }
  }
};

const createProject = async (app: INestApplication, commitSha: string): Promise<string> => {
  const server = app.getHttpServer();
  const project = (
    await withActor(request(server).post('/projects'), actorOwner)
      .send({ name: `Delivery dogfood completion ${new Date().toISOString()}`, owner_actor_id: actorOwner })
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
        driver_actor_id: actorOwner,
        intake_context: intakeContextByKind[item.kind],
      })
      .expect(201)
  ).body as { id: string };

  const { planRevision } = await seedItemScopedSpecPlan(app, workItem.id, {
    actorId: actorOwner,
    reviewerActorId: actorReviewer,
  });

  return { workItemId: workItem.id, planRevisionId: planRevision!.id };
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
        required_artifact_kinds: requiredArtifactKinds,
        allowed_paths: ['.github/**', 'docs/**', 'README.md', 'package.json', 'scripts/**', 'tests/**'],
        forbidden_paths: ['.git/**', 'node_modules/**', '.env'],
      })
      .expect(201)
  ).body as { id: string; version: number };

  await withActor(request(server).post(`/execution-packages/${executionPackage.id}/mark-ready`), actorOwner)
    .send({ actor_id: actorOwner, expected_package_version: executionPackage.version })
    .expect(201);
  return executionPackage.id;
};

const runPackage = async (
  app: INestApplication,
  packageId: string,
  path: 'run' | 'rerun' = 'run',
  body: Record<string, unknown> = {},
  runMode: DogfoodRunMode = { executorType: 'mock', workflowOnly: true },
): Promise<string> => {
  const response = (
    await withActor(request(app.getHttpServer()).post(`/execution-packages/${packageId}/${path}`), actorOwner)
      .send({
        executor_type: runMode.executorType,
        workflow_only: runMode.workflowOnly,
        ...body,
      })
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

export const loadCompletedDogfoodRecordsFromRepository = async (
  repository: DeliveryRepository,
  workItemId: string,
): Promise<CompletedDogfoodItem['records']> => {
  const workItem = await repository.getWorkItem(workItemId);
  if (workItem === undefined) {
    throw new Error(`Repository is missing Work Item ${workItemId}`);
  }

  const executionPackages = await repository.listExecutionPackagesForWorkItem(workItemId);
  const runSessions = (await Promise.all(
    executionPackages.map((executionPackage) => repository.listRunSessionsForPackage(executionPackage.id)),
  )).flat();
  const reviewPackets = (await Promise.all(
    executionPackages.map((executionPackage) => repository.listReviewPacketsForPackage(executionPackage.id)),
  )).flat();

  return {
    workItem,
    executionPackages,
    runSessions,
    reviewPackets,
  };
};

const completeDogfoodItem = async (
  app: INestApplication,
  projectId: string,
  item: DogfoodItemDefinition,
  runMode: DogfoodRunMode,
): Promise<CompletedDogfoodItem> => {
  const { workItemId, planRevisionId } = await approveSpecAndPlan(app, projectId, item);
  const packageId = await createReadyPackage(app, planRevisionId, item);
  const firstRunSessionId = await runPackage(app, packageId, 'run', {}, runMode);
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
        file_path: 'docs/dogfood/delivery-dogfood-work-items.md',
        severity: 'major',
        suggested_validation: 'pnpm dogfood:delivery:work-items',
      },
    ]);
    const rerunSessionId = await runPackage(
      app,
      packageId,
      'rerun',
      { previous_run_session_id: firstRunSessionId },
      runMode,
    );
    const rerunPacket = await waitForReviewPacket(app, rerunSessionId);
    await expectSucceededRun(app, rerunSessionId);
    await approveReviewPacket(app, rerunPacket.id, 'Approved after rerun evidence.');
    runSessionIds.push(rerunSessionId);
    reviewPacketIds.push(rerunPacket.id);
    exercisedChangesRequestedRerun = true;
  } else {
    await approveReviewPacket(app, firstPacket.id, 'Approved for Delivery dogfood completion.');
  }

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workItemRecord = await repository.getWorkItem(workItemId);
  const packageRecord = await repository.getExecutionPackage(packageId);
  if (packageRecord?.resolution !== 'completed') {
    throw new Error(`Package ${packageId} did not complete review handoff`);
  }
  const finalReviewPacketId = reviewPacketIds.at(-1);
  const finalPacket = finalReviewPacketId === undefined ? undefined : await repository.getReviewPacket(finalReviewPacketId);
  if (finalPacket?.decision !== 'approved') {
    throw new Error(`Final ReviewPacket for ${item.key} is not approved`);
  }

  const evidenceChain = (await withActor(request(app.getHttpServer()).get(`/work-items/${workItemId}/evidence-chain`), actorOwner).expect(200))
    .body as EvidenceChainResponse;
  const evidenceChainSources = uniqueSortedSources(evidenceChain.items);
  expectSources(item.key, 'Evidence Chain', evidenceChainSources, productEvidenceSources);
  const reportEvidenceSources = evidenceChainSources;

  if (workItemRecord === undefined) {
    throw new Error(`Repository record for ${item.key} is missing Work Item record`);
  }
  const records = await loadCompletedDogfoodRecordsFromRepository(repository, workItemId);

  return {
    result: {
      key: item.key,
      title: item.title,
      kind: item.kind,
      workItemId,
      packageId,
      executorType: runMode.executorType,
      workflowOnly: runMode.workflowOnly,
      runSessionIds,
      reviewPacketIds,
      finalDecision: 'approved',
      exercisedChangesRequestedRerun,
      timelineSources: reportEvidenceSources,
    },
    records,
  };
};

export const runDeliveryDogfoodWorkItems = async (): Promise<DogfoodCompletionResult> => {
  const strictEnabled = isStrictLocalCodexDogfoodEnabled();
  let strictDirtySource: StrictDirtySourceSummary | undefined;
  if (strictEnabled) {
    const preflight = await preflightLocalCodexDogfood({ env: process.env, repoPath });
    if (!preflight.ok) {
      return {
        generatedAt: new Date().toISOString(),
        durabilityMode: process.env.FORGELOOP_DATABASE_URL === undefined ? 'volatile_demo' : 'durable',
        projectId: 'not-created',
        repoId,
        commitSha: await getHeadSha(),
        strictAcceptance: strictAcceptanceFromPreflight(preflight),
        items: [],
      };
    }
    strictDirtySource = preflight.dirtySource;
  }

  const app = await createApp();
  try {
    const commitSha = await getHeadSha();
    const sourceTreeStatus = await getSourceTreeStatus();
    const projectId = await createProject(app, commitSha);
    const completedItems: CompletedDogfoodItem[] = [];
    for (const item of dogfoodWorkItems) {
      const runMode = strictEnabled ? item.strictRunMode : { executorType: 'mock' as const, workflowOnly: true };
      completedItems.push(await completeDogfoodItem(app, projectId, item, runMode));
    }
    const strictAcceptance = strictEnabled
      ? {
          ...evaluateStrictLocalCodexAcceptance({
            workItems: completedItems.map((item) => item.records.workItem),
            executionPackages: completedItems.flatMap((item) => item.records.executionPackages),
            runSessions: completedItems.flatMap((item) => item.records.runSessions),
            reviewPackets: completedItems.flatMap((item) => item.records.reviewPackets),
          }),
          ...(strictDirtySource === undefined ? {} : { dirtySource: strictDirtySource }),
        }
      : strictAcceptanceDisabled();

    return {
      generatedAt: new Date().toISOString(),
      durabilityMode: app.get(RUN_DURABILITY_MODE) as string,
      projectId,
      repoId,
      commitSha,
      sourceTreeStatus,
      strictAcceptance,
      items: completedItems.map((item) => item.result),
    };
  } finally {
    await app.close();
  }
};

export const renderDogfoodCompletionReport = (result: DogfoodCompletionResult): string => {
  const evidenceLines = result.items.length === 0
    ? [
        '- No Work Items were created in this run.',
      ]
    : [
        '- All three Work Items have approved SpecRevision and PlanRevision records.',
        '- All three Work Items have at least one Execution Package, RunSession, Review Packet, human review decision, and timeline evidence.',
        '- The Browser Run Console Work Item exercised `changes_requested -> rerun -> approve`.',
        '- Default mode uses `executor_type: mock` with `workflow_only=true` to validate the product workflow without creating extra source changes.',
        '- Strict mode requires at least two `local_codex` / `workflow_only=false` Work Items with completed approved Review Packets and required artifacts.',
      ];
  const strictLines = [
    '## Strict local_codex Acceptance',
    '',
    `Strict local_codex acceptance: ${result.strictAcceptance.status}`,
    ...(result.strictAcceptance.status === 'disabled'
      ? [
          '- strict runbook acceptance is not complete in this run.',
          '- real local Codex acceptance is opt-in; set `FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1` to run strict mode.',
        ]
      : [
          `- Qualifying local_codex Work Items: ${result.strictAcceptance.qualifyingWorkItems.length}`,
          ...(result.strictAcceptance.status === 'blocked'
            ? ['- Strict preflight blockers prevented batch execution.']
            : []),
          ...(result.strictAcceptance.status === 'failed'
            ? ['- Strict batch execution completed but did not meet strict acceptance.']
            : []),
          ...(result.strictAcceptance.qualifyingWorkItems.length === 0
            ? []
            : [
                '',
                '| Work Item | Execution Package | RunSession | Review Packet | executor_type | workflow_only |',
                '|---|---|---|---|---|---|',
                ...result.strictAcceptance.qualifyingWorkItems.map((item) =>
                  [
                    item.workItemId,
                    item.executionPackageId,
                    item.runSessionId,
                    item.reviewPacketId,
                    item.executorType,
                    String(item.workflowOnly),
                  ]
                    .map((value) => String(value).replace(/\|/g, '\\|'))
                    .join(' | ')
                    .replace(/^/, '| ')
                    .replace(/$/, ' |'),
                ),
              ]),
          ...(result.strictAcceptance.blockers.length === 0
            ? []
            : [
                '',
                '### Strict Blockers',
                '',
                ...result.strictAcceptance.blockers.flatMap((blocker) => [
                  `- ${blocker.code}: ${blocker.message}`,
                  ...(blocker.details === undefined
                    ? []
                    : [`  - details: \`${JSON.stringify(redactedStrictBlockerDetails(blocker.details)).replace(/`/g, '\\`')}\``]),
                ]),
              ]),
          ...(result.strictAcceptance.dirtySource === undefined
            ? []
            : [
                '',
                '### Strict Dirty Source',
                '',
                `- allowed_dirty_entries: ${result.strictAcceptance.dirtySource.allowed_dirty_entries.join(', ') || 'none'}`,
                `- blocked_dirty_entries: ${result.strictAcceptance.dirtySource.blocked_dirty_entries.join(', ') || 'none'}`,
                `- dirty_allowlist_source: ${result.strictAcceptance.dirtySource.dirty_allowlist_source}`,
              ]),
        ]),
  ];
  const lines = [
    '# Delivery Dogfood Work Items Completion',
    '',
    `Generated: ${result.generatedAt}`,
    `Durability mode: ${result.durabilityMode}`,
    `Project: ${result.projectId}`,
    `Repo: ${result.repoId}`,
    `Source commit: ${result.commitSha}`,
    `Source tree before report write: ${result.sourceTreeStatus}`,
    `Report scope: ${result.strictAcceptance.status === 'passed' ? 'strict local Codex acceptance' : 'workflow dogfood only; strict local Codex acceptance is reported separately below'}`,
    '',
    ...strictLines,
    '',
    '## Summary',
    '',
    '| Work Item | Kind | Package | executor_type | workflow_only | Runs | Review Packets | Final Decision | Rerun Path | Timeline Evidence |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...result.items.map((item) =>
      [
        item.title,
        item.kind,
        item.packageId,
        item.executorType,
        String(item.workflowOnly),
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
    ...evidenceLines,
    '',
    '## P1 Decision Summary',
    '',
    '- Decision: prioritize Trace / Evidence Plane for P1.',
    '- Rationale: the Delivery dogfood path showed that reviewers need a faster way to reconstruct cause and effect across runs, reruns, artifacts, and review decisions.',
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

export const strictAcceptanceExitMessage = (status: 'blocked' | 'failed'): string =>
  `Delivery dogfood work items strict acceptance ${status}. Report: ${reportPath}`;

export const main = async (): Promise<number> => {
  const result = await runDeliveryDogfoodWorkItems();
  await writeDogfoodCompletionReport(result);
  if (result.strictAcceptance.status === 'failed' || result.strictAcceptance.status === 'blocked') {
    console.error(strictAcceptanceExitMessage(result.strictAcceptance.status));
    for (const blocker of result.strictAcceptance.blockers) {
      console.error(`Strict blocker ${blocker.code}: ${blocker.message}`);
    }
    return 1;
  }
  console.log(`Delivery dogfood work items completed. Report: ${reportPath}`);
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
