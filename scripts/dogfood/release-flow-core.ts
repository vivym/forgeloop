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
import { InMemoryP0Repository } from '../../packages/db/src';
import type { CheckResult, ExecutionPackage, ReviewPacket, RunSession, WorkItem } from '../../packages/domain/src';

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
  /[A-Za-z]:[\\/]/i,
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

const noopRunWorker = {
  kick: () => undefined,
  drainOnce: async () => undefined,
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
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, repository };
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
    'This report is generated by `pnpm dogfood:release-flow` using a deterministic in-memory Nest app.',
    '',
    ...markerSections,
    '',
  ].join('\n');
  assertNoUnsafeReleaseDogfoodStrings('Release verification report', report);
  return report;
};
