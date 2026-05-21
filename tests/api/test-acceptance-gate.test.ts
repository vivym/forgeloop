import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ExecutionPackage,
  Plan,
  PlanRevision,
  Project,
  Release,
  ReviewPacket,
  RunSession,
  Spec,
  SpecRevision,
  WorkItem,
} from '@forgeloop/domain';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
} from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { actorClassHeaderName, actorHeaderName } from '../../apps/control-plane-api/src/modules/auth/actor-context';
import { InMemoryDeliveryRepository } from '../../packages/db/src/index';

const now = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';
const actorOwner = 'actor-owner';
const actorQa = 'actor-qa';
const actorReleaseOwner = 'actor-release-owner';
const actorReviewer = 'actor-reviewer';
const ownerHeaders = { [actorHeaderName]: actorOwner, [actorClassHeaderName]: 'human_admin' };
const qaHeaders = { [actorHeaderName]: actorQa, [actorClassHeaderName]: 'human' };
const releaseOwnerHeaders = { [actorHeaderName]: actorReleaseOwner, [actorClassHeaderName]: 'human_admin' };
const reviewerHeaders = { [actorHeaderName]: actorReviewer, [actorClassHeaderName]: 'human' };

const requirementIntakeContext: WorkItem['intake_context'] = {
  type: 'requirement',
  stakeholder_problem: 'Release approval needs accepted test evidence.',
  desired_outcome: 'Releases are blocked until test acceptance exists.',
  acceptance_criteria: ['Release approval requires test acceptance.'],
  in_scope: ['Release test acceptance gate.'],
};

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  name: 'Forgeloop',
  repo_ids: ['repo-1'],
  owner_actor_id: actorOwner,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const workItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'work-item-1',
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Ship release acceptance gate',
  goal: 'Block releases without accepted test evidence.',
  success_criteria: ['Release approval requires test acceptance.'],
  priority: 'P1',
  risk: 'medium',
  driver_actor_id: actorOwner,
  intake_context: requirementIntakeContext,
  phase: 'done',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'completed',
  current_spec_id: 'spec-1',
  current_plan_id: 'plan-1',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const spec = (overrides: Partial<Spec> = {}): Spec => ({
  id: 'spec-1',
  work_item_id: 'work-item-1',
  entity_type: 'spec',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'spec-revision-1',
  approved_revision_id: 'spec-revision-1',
  approved_at: now,
  approved_by_actor_id: actorReviewer,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const specRevision = (overrides: Partial<SpecRevision> = {}): SpecRevision => ({
  id: 'spec-revision-1',
  spec_id: 'spec-1',
  work_item_id: 'work-item-1',
  revision_number: 1,
  summary: 'Acceptance gate spec.',
  content: 'Require accepted test evidence.',
  background: 'Release readiness needs a QA signal.',
  goals: ['Release owners can see and resolve acceptance blockers.'],
  scope_in: ['Release gate'],
  scope_out: ['New test asset persistence'],
  acceptance_criteria: ['QA acceptance is acknowledged before approval.'],
  risk_notes: [],
  test_strategy_summary: 'Run API acceptance tests and verify evidence chain links.',
  artifact_refs: [],
  created_at: now,
  ...overrides,
});

const plan = (overrides: Partial<Plan> = {}): Plan => ({
  id: 'plan-1',
  work_item_id: 'work-item-1',
  entity_type: 'plan',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'plan-revision-1',
  approved_revision_id: 'plan-revision-1',
  approved_at: now,
  approved_by_actor_id: actorReviewer,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const planRevision = (overrides: Partial<PlanRevision> = {}): PlanRevision => ({
  id: 'plan-revision-1',
  plan_id: 'plan-1',
  work_item_id: 'work-item-1',
  based_on_spec_revision_id: 'spec-revision-1',
  revision_number: 1,
  summary: 'Acceptance gate plan.',
  content: 'Add a release acceptance gate.',
  implementation_summary: 'Use existing release evidence and decision records.',
  split_strategy: 'Single API slice.',
  dependency_order: [],
  test_matrix: ['API acceptance gate tests'],
  risk_mitigations: [],
  rollback_notes: 'Remove the gate assertion.',
  artifact_refs: [],
  created_at: now,
  ...overrides,
});

const executionPackage = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: 'execution-package-1',
  work_item_id: 'work-item-1',
  spec_id: 'spec-1',
  spec_revision_id: 'spec-revision-1',
  plan_id: 'plan-1',
  plan_revision_id: 'plan-revision-1',
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: 'Implement release acceptance gate.',
  owner_actor_id: actorOwner,
  reviewer_actor_id: actorReviewer,
  qa_owner_actor_id: actorQa,
  phase: 'release',
  activity_state: 'idle',
  gate_state: 'release_ready',
  resolution: 'completed',
  required_checks: [
    {
      check_id: 'api-tests',
      display_name: 'API tests',
      command: 'pnpm vitest run tests/api/test-acceptance-gate.test.ts',
      timeout_seconds: 120,
      blocks_review: true,
    },
  ],
  required_artifact_kinds: ['execution_summary'],
  allowed_paths: ['apps/control-plane-api/**'],
  forbidden_paths: [],
  version: 1,
  last_run_session_id: 'run-session-1',
  current_run_session_id: 'run-session-1',
  current_review_packet_id: 'review-packet-1',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const runSession = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: 'run-session-1',
  execution_package_id: 'execution-package-1',
  requested_by_actor_id: actorOwner,
  status: 'succeeded',
  executor_type: 'mock',
  changed_files: [],
  check_results: [
    {
      check_id: 'api-tests',
      command: 'pnpm vitest run tests/api/test-acceptance-gate.test.ts',
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 3,
      blocks_review: true,
    },
  ],
  artifacts: [
    {
      kind: 'execution_summary',
      name: 'Execution summary',
      content_type: 'text/markdown',
      storage_uri: 'https://example.test/execution-summary.md',
    },
  ],
  log_refs: [],
  summary: 'Acceptance gate package completed.',
  created_at: now,
  updated_at: later,
  started_at: now,
  finished_at: later,
  ...overrides,
});

const reviewPacket = (overrides: Partial<ReviewPacket> = {}): ReviewPacket => ({
  id: 'review-packet-1',
  run_session_id: 'run-session-1',
  execution_package_id: 'execution-package-1',
  reviewer_actor_id: actorReviewer,
  spec_revision_id: 'spec-revision-1',
  plan_revision_id: 'plan-revision-1',
  status: 'completed',
  decision: 'approved',
  summary: 'Approved for release.',
  changed_files: [],
  check_result_summary: 'Required checks passed.',
  self_review: {
    status: 'succeeded',
    summary: 'Ready.',
    spec_plan_alignment: 'Aligned.',
    test_assessment: 'Covered by API tests.',
    risk_notes: [],
    follow_up_questions: [],
  },
  risk_notes: [],
  reviewed_by_actor_id: actorReviewer,
  reviewed_at: later,
  requested_changes: [],
  created_at: now,
  updated_at: later,
  completed_at: later,
  ...overrides,
});

describe('release test acceptance gate', () => {
  const apps: INestApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  const createTestApp = async () => {
    const repo = new InMemoryDeliveryRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_REPOSITORY)
      .useValue(repo)
      .overrideProvider(RUN_DURABILITY_MODE)
      .useValue('volatile_demo')
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    apps.push(app);
    return { app, repo };
  };

  const seedRelease = async (
    options: {
      work_item?: Partial<WorkItem>;
      spec_revision?: Partial<SpecRevision>;
      plan?: Partial<Plan>;
      plan_revision?: Partial<PlanRevision>;
      execution_package?: Partial<ExecutionPackage>;
      run_session?: Partial<RunSession>;
      release?: Partial<Release>;
      includeEvidenceChain?: boolean;
    } = {},
  ) => {
    const { app, repo } = await createTestApp();
    await repo.saveProject(project());
    const item = workItem(options.work_item);
    const specRecord = spec({ work_item_id: item.id });
    const specRevisionRecord = specRevision({
      spec_id: specRecord.id,
      work_item_id: item.id,
      ...options.spec_revision,
    });
    const planRecord = plan({ work_item_id: item.id, ...options.plan });
    const planRevisionRecord = planRevision({
      plan_id: planRecord.id,
      work_item_id: item.id,
      based_on_spec_revision_id: specRevisionRecord.id,
      ...options.plan_revision,
    });
    const pkg = executionPackage({
      work_item_id: item.id,
      spec_id: specRecord.id,
      spec_revision_id: specRevisionRecord.id,
      plan_id: planRecord.id,
      plan_revision_id: planRevisionRecord.id,
      ...options.execution_package,
    });
    const run = runSession({ execution_package_id: pkg.id, ...options.run_session });
    const packet = reviewPacket({ execution_package_id: pkg.id, run_session_id: run.id });
    await repo.saveWorkItem(item);
    await repo.saveSpec(specRecord);
    await repo.saveSpecRevision(specRevisionRecord);
    await repo.savePlan(planRecord);
    await repo.savePlanRevision(planRevisionRecord);
    await repo.saveExecutionPackage(pkg);
    await repo.saveRunSession(run);
    await repo.saveReviewPacket(packet);

    const { extra: _extra, ...releaseCreateOverrides } = options.release ?? {};
    const created = await request(app.getHttpServer())
      .post('/releases')
      .set(ownerHeaders)
      .send({
        actor_id: actorOwner,
        project_id: 'project-1',
        title: 'Acceptance Gate Release',
        release_owner_actor_id: actorReleaseOwner,
        rollout_strategy: 'Ship behind a release flag.',
        rollback_plan: 'Disable the release flag.',
        observation_plan: 'Watch API error rate for 30 minutes.',
        ...releaseCreateOverrides,
      })
      .expect(201);
    const releaseId = created.body.release.id as string;
    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/work-items/${item.id}`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/execution-packages/${pkg.id}`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);

    if (options.release?.extra !== undefined) {
      await repo.saveRelease({ ...(await repo.getRelease(releaseId))!, extra: options.release.extra });
    }

    if (options.includeEvidenceChain ?? true) {
      await saveTerminalRunEvidenceTrace(repo, {
        releaseId,
        workItemId: item.id,
        executionPackageId: pkg.id,
        runSessionId: run.id,
        reviewPacketId: packet.id,
        suffix: run.id,
      });
    }

    return {
      app,
      repo,
      releaseId,
      workItem: item,
      executionPackage: pkg,
      runSession: run,
      reviewPacket: packet,
      spec: specRecord,
      specRevision: specRevisionRecord,
      plan: planRecord,
      planRevision: planRevisionRecord,
    };
  };

  const seedReleaseWithHighRiskLinkedWorkItemAndApprovedPackage = () =>
    seedRelease({ work_item: { risk: 'high' }, includeEvidenceChain: true });

  const seedSubmittedReleaseWithHighRiskLinkedWorkItemAndMissingTestAcceptance = async () => {
    const seeded = await seedReleaseWithHighRiskLinkedWorkItemAndApprovedPackage();
    await seeded.repo.saveRelease({
      ...(await seeded.repo.getRelease(seeded.releaseId))!,
      phase: 'approval',
      gate_state: 'awaiting_approval',
      updated_at: later,
    });
    return seeded;
  };

  const saveTerminalRunEvidenceTrace = async (
    repo: InMemoryDeliveryRepository,
    input: {
      releaseId: string;
      workItemId: string;
      executionPackageId: string;
      runSessionId: string;
      reviewPacketId: string;
      suffix: string;
    },
  ) => {
    const eventId = `trace-event:terminal-evidence:${input.suffix}`;
    await repo.saveTraceEvent({
      id: eventId,
      event_type: 'run_terminal_evidence_recorded',
      subject_type: 'run_session',
      subject_id: input.runSessionId,
      actor_id: actorQa,
      summary: 'Terminal run evidence recorded for release acceptance.',
      payload: {
        release_id: input.releaseId,
        run_session_id: input.runSessionId,
        execution_package_id: input.executionPackageId,
        work_item_id: input.workItemId,
        review_packet_id: input.reviewPacketId,
      },
      created_at: later,
    });
    for (const link of [
      { name: 'run', object_type: 'run_session', object_id: input.runSessionId },
      { name: 'work', object_type: 'work_item', object_id: input.workItemId },
      { name: 'package', object_type: 'execution_package', object_id: input.executionPackageId },
      { name: 'review', object_type: 'review_packet', object_id: input.reviewPacketId },
    ]) {
      await repo.saveTraceLink({
        id: `trace-link:terminal-${link.name}:${input.suffix}`,
        trace_event_id: eventId,
        relationship: 'supports',
        object_type: link.object_type,
        object_id: link.object_id,
        created_at: later,
      });
    }
  };

  it('blocks release approval until high-risk test acceptance is acknowledged or overridden', async () => {
    const { app, releaseId } = await seedReleaseWithHighRiskLinkedWorkItemAndApprovedPackage();

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA accepts the existing test evidence.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
  });

  it('blocks release approval when a submitted release still lacks test acceptance', async () => {
    const { app, releaseId } = await seedSubmittedReleaseWithHighRiskLinkedWorkItemAndMissingTestAcceptance();

    const approval = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/approve`)
      .set(releaseOwnerHeaders)
      .send({ actor_id: actorReleaseOwner, rationale: 'Ready to approve.' })
      .expect(422);
    const cockpit = await request(app.getHttpServer()).get(`/query/release-cockpit/${releaseId}`).expect(200);

    expect(approval.body.blocker_snapshot.blocker_fingerprint).toBe(cockpit.body.blocker_snapshot.blocker_fingerprint);

    expect(approval.body.blocker_snapshot).toEqual(
      expect.objectContaining({
        release_id: releaseId,
        blockers: expect.arrayContaining([
          expect.objectContaining({
            code: 'missing_required_evidence_backlink',
            object_type: 'release',
            object_id: releaseId,
            overrideable: true,
          }),
        ]),
      }),
    );
  });

  it('allows public override approval from candidate using the current submit blocker snapshot', async () => {
    const { app, repo, releaseId } = await seedReleaseWithHighRiskLinkedWorkItemAndApprovedPackage();
    const submitted = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
    const cockpit = await request(app.getHttpServer()).get(`/query/release-cockpit/${releaseId}`).expect(200);

    expect(submitted.body.blocker_snapshot.blocker_fingerprint).toBe(cockpit.body.blocker_snapshot.blocker_fingerprint);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/override-approve`)
      .set(releaseOwnerHeaders)
      .send({
        actor_id: actorReleaseOwner,
        rationale: 'Override missing high-risk test acceptance for emergency rollout.',
        blocker_snapshot: submitted.body.blocker_snapshot,
      })
      .expect(201);

    expect(await repo.listDecisionsForObject('release', releaseId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision_type: 'manual_override',
          decision: 'override_approved',
          summary: 'Override missing high-risk test acceptance for emergency rollout.',
          evidence_refs: expect.objectContaining({
            blocker_snapshot: expect.objectContaining({
              blockers: expect.arrayContaining([
                expect.objectContaining({
                  code: 'missing_required_evidence_backlink',
                  object_type: 'release',
                  object_id: releaseId,
                }),
              ]),
            }),
          }),
        }),
      ]),
    );
  });

  it('allows public override approval from candidate when required checks are missing', async () => {
    const { app, repo, releaseId } = await seedRelease({ run_session: { check_results: [] } });
    const submitted = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
    const cockpit = await request(app.getHttpServer()).get(`/query/release-cockpit/${releaseId}`).expect(200);

    expect(submitted.body.blocker_snapshot.blocker_fingerprint).toBe(cockpit.body.blocker_snapshot.blocker_fingerprint);
    expect(submitted.body.blocker_snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'failed_required_check',
          object_type: 'execution_package',
          object_id: 'execution-package-1',
          overrideable: true,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/override-approve`)
      .set(releaseOwnerHeaders)
      .send({
        actor_id: actorReleaseOwner,
        rationale: 'Override missing required checks for emergency rollout.',
        blocker_snapshot: submitted.body.blocker_snapshot,
      })
      .expect(201);

    expect(await repo.listDecisionsForObject('release', releaseId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision_type: 'manual_override',
          decision: 'override_approved',
          evidence_refs: expect.objectContaining({
            blocker_snapshot: expect.objectContaining({
              blockers: expect.arrayContaining([expect.objectContaining({ code: 'failed_required_check' })]),
            }),
          }),
        }),
      ]),
    );
  });

  it('allows public override approval from candidate when required artifacts are missing', async () => {
    const { app, repo, releaseId } = await seedRelease({ run_session: { artifacts: [] } });
    const submitted = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
    const cockpit = await request(app.getHttpServer()).get(`/query/release-cockpit/${releaseId}`).expect(200);

    expect(submitted.body.blocker_snapshot.blocker_fingerprint).toBe(cockpit.body.blocker_snapshot.blocker_fingerprint);
    expect(submitted.body.blocker_snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_required_artifact',
          object_type: 'execution_package',
          object_id: 'execution-package-1',
          overrideable: true,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/override-approve`)
      .set(releaseOwnerHeaders)
      .send({
        actor_id: actorReleaseOwner,
        rationale: 'Override missing required artifacts for emergency rollout.',
        blocker_snapshot: submitted.body.blocker_snapshot,
      })
      .expect(201);

    expect(await repo.listDecisionsForObject('release', releaseId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision_type: 'manual_override',
          decision: 'override_approved',
          evidence_refs: expect.objectContaining({
            blocker_snapshot: expect.objectContaining({
              blockers: expect.arrayContaining([expect.objectContaining({ code: 'missing_required_artifact' })]),
            }),
          }),
        }),
      ]),
    );
  });

  it('rejects candidate override approval when the current blocker snapshot only has planning blockers', async () => {
    const { app, releaseId } = await seedRelease({ release: { rollout_strategy: undefined } });
    const cockpit = await request(app.getHttpServer()).get(`/query/release-cockpit/${releaseId}`).expect(200);

    expect(cockpit.body.blocker_snapshot.blockers).toEqual([
      expect.objectContaining({ code: 'missing_rollout_strategy', overrideable: true }),
    ]);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/override-approve`)
      .set(releaseOwnerHeaders)
      .send({
        actor_id: actorReleaseOwner,
        rationale: 'Override planning gap before approval submission.',
        blocker_snapshot: cockpit.body.blocker_snapshot,
      })
      .expect(422);
  });

  it('rejects candidate override approval for missing approved plan preconditions mapped to evidence blockers', async () => {
    const { app, releaseId } = await seedRelease({
      plan: { status: 'draft', gate_state: 'none', resolution: 'none', approved_revision_id: undefined },
    });
    const submitted = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);

    expect(submitted.body.blocker_snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_required_evidence_backlink',
          object_type: 'work_item',
          object_id: 'work-item-1',
          overrideable: true,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/override-approve`)
      .set(releaseOwnerHeaders)
      .send({
        actor_id: actorReleaseOwner,
        rationale: 'Candidate override should not bypass missing approved plan preconditions.',
        blocker_snapshot: submitted.body.blocker_snapshot,
      })
      .expect(422);
  });

  it('allows candidate override approval for pure active Test/Acceptance release blockers', async () => {
    const { app, repo, releaseId } = await seedRelease({
      release: {
        extra: {
          active_blockers: [
            { code: 'test_environment_unavailable', category: 'tests', status: 'active', summary: 'QA environment is unavailable.' },
          ],
        },
      } as Partial<Release>,
    });
    const submitted = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);

    expect(submitted.body.blocker_snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_required_evidence_backlink',
          object_type: 'release',
          object_id: releaseId,
          overrideable: true,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/override-approve`)
      .set(releaseOwnerHeaders)
      .send({
        actor_id: actorReleaseOwner,
        rationale: 'Override active QA environment blocker for emergency rollout.',
        blocker_snapshot: submitted.body.blocker_snapshot,
      })
      .expect(201);

    expect(await repo.listDecisionsForObject('release', releaseId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ decision_type: 'manual_override', decision: 'override_approved' })]),
    );
  });

  it('rejects high-risk acknowledgement from a non-QA release actor', async () => {
    const { app, releaseId } = await seedReleaseWithHighRiskLinkedWorkItemAndApprovedPackage();

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(releaseOwnerHeaders)
      .send({ actor_id: actorReleaseOwner, summary: 'Release owner accepts QA evidence.' })
      .expect(403);
  });

  it('allows a QA owner from a high-risk work item package when another package is high-risk', async () => {
    const { app, repo, releaseId, workItem: item } = await seedRelease({
      work_item: { risk: 'high' },
      execution_package: { integration_readiness: { risk: 'medium' }, qa_owner_actor_id: actorQa },
      includeEvidenceChain: true,
    });
    const secondPackage = executionPackage({
      id: 'execution-package-2',
      work_item_id: item.id,
      integration_readiness: { risk: 'high' },
      qa_owner_actor_id: actorReviewer,
      current_run_session_id: 'run-session-2',
      last_run_session_id: 'run-session-2',
      current_review_packet_id: 'review-packet-2',
    });
    const secondRun = runSession({ id: 'run-session-2', execution_package_id: secondPackage.id });
    const secondPacket = reviewPacket({
      id: 'review-packet-2',
      execution_package_id: secondPackage.id,
      run_session_id: secondRun.id,
    });
    await repo.saveExecutionPackage(secondPackage);
    await repo.saveRunSession(secondRun);
    await repo.saveReviewPacket(secondPacket);
    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/execution-packages/${secondPackage.id}`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    await saveTerminalRunEvidenceTrace(repo, {
      releaseId,
      workItemId: item.id,
      executionPackageId: secondPackage.id,
      runSessionId: secondRun.id,
      reviewPacketId: secondPacket.id,
      suffix: secondRun.id,
    });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA owner for the high-risk work item package accepts the mixed high-risk scope.' })
      .expect(201);
  });

  it('rejects acknowledgement when no current high-risk scope requires it', async () => {
    const { app, releaseId } = await seedRelease({ work_item: { risk: 'medium' } });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'Pre-acknowledge future QA evidence.' })
      .expect(422);
  });

  it('rejects approval for a submitted release missing a minimal rollback plan', async () => {
    const { app, repo, releaseId } = await seedRelease({ release: { rollback_plan: undefined } });
    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/approve`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Ready to approve.' })
      .expect(422);
    expect((await repo.getRelease(releaseId))?.gate_state).toBe('awaiting_approval');
  });

  it('allows a missing rollback plan only through explicit override approval', async () => {
    const { app, repo, releaseId } = await seedRelease({ release: { rollback_plan: undefined } });
    const submitted = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/override-approve`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, blocker_snapshot: submitted.body.blocker_snapshot })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/override-approve`)
      .set(reviewerHeaders)
      .send({
        actor_id: actorReviewer,
        rationale: 'Explicitly override missing rollback plan for controlled rollout.',
        blocker_snapshot: submitted.body.blocker_snapshot,
      })
      .expect(201);
    expect(await repo.listDecisionsForObject('release', releaseId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decision_type: 'manual_override',
          decision: 'override_approved',
          summary: 'Explicitly override missing rollback plan for controlled rollout.',
        }),
      ]),
    );
  });

  it('rejects submit when the linked Work Item approved Spec revision has no test strategy summary', async () => {
    const { app, releaseId } = await seedRelease({ spec_revision: { test_strategy_summary: '   ' } });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
  });

  it('rejects submit when the linked Work Item approved Spec revision has no acceptance criteria', async () => {
    const { app, releaseId } = await seedRelease({ spec_revision: { acceptance_criteria: [] } });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
  });

  it('rejects submit when the linked Work Item only has an unapproved current Spec revision', async () => {
    const { app, repo, releaseId, spec, specRevision } = await seedRelease();
    await repo.saveSpec({ ...spec, approved_revision_id: undefined, current_revision_id: specRevision.id });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
  });

  it('rejects submit when the linked Work Item Spec has an approved revision id but is not approved', async () => {
    const { app, repo, releaseId, spec } = await seedRelease();
    await repo.saveSpec({ ...spec, status: 'in_review', resolution: 'none', approved_revision_id: 'spec-revision-1' });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
  });

  it('rejects submit when the linked Work Item Plan lacks an approved revision', async () => {
    const { app, releaseId } = await seedRelease({ plan: { approved_revision_id: undefined } });

    const response = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);

    expect(response.body.blocker_snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_required_evidence_backlink',
          object_type: 'work_item',
          object_id: 'work-item-1',
        }),
      ]),
    );
  });

  it('rejects submit when a linked package plan revision is not the approved Plan revision', async () => {
    const { app, releaseId, repo, plan, planRevision: approvedPlanRevision } = await seedRelease();
    await repo.savePlanRevision(
      planRevision({
        id: 'plan-revision-2',
        plan_id: plan.id,
        work_item_id: plan.work_item_id,
        based_on_spec_revision_id: 'spec-revision-1',
        revision_number: 2,
      }),
    );
    await repo.savePlan({ ...plan, current_revision_id: 'plan-revision-2', approved_revision_id: 'plan-revision-2' });
    expect(approvedPlanRevision.id).toBe('plan-revision-1');

    const response = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);

    expect(response.body.blocker_snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_required_evidence_backlink',
          object_type: 'execution_package',
          object_id: 'execution-package-1',
        }),
      ]),
    );
  });

  it('rejects submit until the current QA owner re-acknowledges after the approved Plan revision changes', async () => {
    const {
      app,
      repo,
      releaseId,
      plan,
      planRevision: initiallyApprovedPlanRevision,
    } = await seedReleaseWithHighRiskLinkedWorkItemAndApprovedPackage();

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA accepts the existing approved plan scope.' })
      .expect(201);

    const nextPlanRevision = planRevision({
      id: 'plan-revision-2',
      plan_id: plan.id,
      work_item_id: plan.work_item_id,
      based_on_spec_revision_id: 'spec-revision-1',
      revision_number: 2,
    });
    await repo.savePlanRevision(nextPlanRevision);
    await repo.savePlan({ ...plan, current_revision_id: nextPlanRevision.id, approved_revision_id: nextPlanRevision.id });
    await repo.saveWorkItem({
      ...(await repo.getWorkItem('work-item-1'))!,
      current_plan_revision_id: nextPlanRevision.id,
      updated_at: later,
    });
    await repo.saveExecutionPackage({
      ...(await repo.getExecutionPackage('execution-package-1'))!,
      plan_revision_id: nextPlanRevision.id,
      updated_at: later,
    });
    expect(initiallyApprovedPlanRevision.id).toBe('plan-revision-1');

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA accepts the updated approved plan scope.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
  });

  it('rejects submit when a linked package is missing blocking required checks', async () => {
    const { app, releaseId } = await seedRelease({ run_session: { check_results: [] } });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
  });

  it('rejects submit when a linked package is missing required artifacts', async () => {
    const { app, releaseId } = await seedRelease({ run_session: { artifacts: [] } });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
  });

  it('rejects submit when active test readiness or artifact blockers exist on the release', async () => {
    const { app, releaseId } = await seedRelease({
      release: {
        extra: {
          active_blockers: [
            { code: 'test_environment_unavailable', category: 'tests', status: 'active', summary: 'QA environment is unavailable.' },
            { code: 'artifact_attestation_missing', category: 'artifacts', status: 'active', summary: 'Artifact attestation is missing.' },
          ],
        },
      } as Partial<Release>,
    });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
  });

  it('rejects approve when a high-risk linked package lacks an evidence-chain link', async () => {
    const { app, repo, releaseId } = await seedRelease({
      execution_package: { integration_readiness: { risk: 'high' } },
      includeEvidenceChain: false,
    });
    await repo.saveRelease({
      ...(await repo.getRelease(releaseId))!,
      phase: 'approval',
      gate_state: 'awaiting_approval',
      updated_at: later,
    });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/approve`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Ready to approve.' })
      .expect(422);
  });

  it('rejects submit when a high-risk package only has unrelated trace history', async () => {
    const { app, repo, releaseId, executionPackage: pkg } = await seedRelease({
      execution_package: { integration_readiness: { risk: 'high' } },
      includeEvidenceChain: false,
    });
    await repo.saveTraceEvent({
      id: `trace-event:unrelated:${pkg.id}`,
      event_type: 'run_terminal_evidence_recorded',
      subject_type: 'execution_package',
      subject_id: pkg.id,
      actor_id: actorQa,
      summary: 'Historical package trace unrelated to release acceptance.',
      payload: { execution_package_id: pkg.id },
      created_at: later,
    });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
  });

  it('accepts real terminal run evidence trace links for high-risk release acceptance', async () => {
    const {
      app,
      repo,
      releaseId,
      workItem: item,
      executionPackage: pkg,
      runSession: run,
      reviewPacket: packet,
    } = await seedRelease({
      work_item: { risk: 'high' },
      execution_package: { integration_readiness: { risk: 'high' } },
      includeEvidenceChain: false,
    });
    await saveTerminalRunEvidenceTrace(repo, {
      releaseId,
      workItemId: item.id,
      executionPackageId: pkg.id,
      runSessionId: run.id,
      reviewPacketId: packet.id,
      suffix: run.id,
    });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA accepts terminal run evidence links for high-risk scope.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
  });

  it('rejects terminal run evidence payloads that lack scoped trace links', async () => {
    const {
      app,
      repo,
      releaseId,
      workItem: item,
      executionPackage: pkg,
      runSession: run,
      reviewPacket: packet,
    } = await seedRelease({
      work_item: { risk: 'high' },
      execution_package: { integration_readiness: { risk: 'high' } },
      includeEvidenceChain: false,
    });
    await repo.saveTraceEvent({
      id: `trace-event:terminal-payload-only:${run.id}`,
      event_type: 'run_terminal_evidence_recorded',
      subject_type: 'run_session',
      subject_id: run.id,
      actor_id: actorQa,
      summary: 'Terminal run evidence payload without scoped trace links.',
      payload: {
        release_id: releaseId,
        run_session_id: run.id,
        execution_package_id: pkg.id,
        work_item_id: item.id,
        review_packet_id: packet.id,
      },
      created_at: later,
    });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA should not accept payload-only terminal evidence.' })
      .expect(422);
  });

  it('rejects terminal run evidence scoped by subject without scoped trace links', async () => {
    const {
      app,
      repo,
      releaseId,
      workItem: item,
      executionPackage: pkg,
      runSession: run,
      reviewPacket: packet,
    } = await seedRelease({
      work_item: { risk: 'high' },
      execution_package: { integration_readiness: { risk: 'high' } },
      includeEvidenceChain: false,
    });
    await repo.saveTraceEvent({
      id: `trace-event:terminal-subject-only:${run.id}`,
      event_type: 'run_terminal_evidence_recorded',
      subject_type: 'work_item',
      subject_id: item.id,
      actor_id: actorQa,
      summary: 'Terminal run evidence subject without scoped trace links.',
      payload: {
        release_id: releaseId,
        run_session_id: run.id,
        execution_package_id: pkg.id,
        work_item_id: item.id,
        review_packet_id: packet.id,
      },
      created_at: later,
    });
    await repo.saveTraceLink({
      id: `trace-link:terminal-subject-run:${run.id}`,
      trace_event_id: `trace-event:terminal-subject-only:${run.id}`,
      relationship: 'supports',
      object_type: 'run_session',
      object_id: run.id,
      created_at: later,
    });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA should not accept subject-only terminal evidence.' })
      .expect(422);
  });

  it('rejects old terminal run traces until current high-risk run evidence is linked and acknowledged', async () => {
    const {
      app,
      repo,
      releaseId,
      workItem: item,
      executionPackage: pkg,
      runSession: currentRun,
      reviewPacket: currentPacket,
    } = await seedRelease({
      work_item: { risk: 'high' },
      execution_package: { integration_readiness: { risk: 'high' } },
      includeEvidenceChain: false,
    });
    const oldRun = runSession({
      id: 'run-session-old',
      execution_package_id: pkg.id,
      created_at: '2026-05-04T00:00:00.000Z',
      updated_at: '2026-05-04T00:01:00.000Z',
      started_at: '2026-05-04T00:00:00.000Z',
      finished_at: '2026-05-04T00:01:00.000Z',
    });
    const oldPacket = reviewPacket({
      id: 'review-packet-old',
      execution_package_id: pkg.id,
      run_session_id: oldRun.id,
      created_at: '2026-05-04T00:00:00.000Z',
      updated_at: '2026-05-04T00:01:00.000Z',
      completed_at: '2026-05-04T00:01:00.000Z',
    });
    await repo.saveRunSession(oldRun);
    await repo.saveReviewPacket(oldPacket);
    await saveTerminalRunEvidenceTrace(repo, {
      releaseId,
      workItemId: item.id,
      executionPackageId: pkg.id,
      runSessionId: oldRun.id,
      reviewPacketId: oldPacket.id,
      suffix: oldRun.id,
    });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA should not accept terminal evidence from an old run.' })
      .expect(422);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);

    await saveTerminalRunEvidenceTrace(repo, {
      releaseId,
      workItemId: item.id,
      executionPackageId: pkg.id,
      runSessionId: currentRun.id,
      reviewPacketId: currentPacket.id,
      suffix: currentRun.id,
    });
    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA accepts terminal run evidence links for the current high-risk scope.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
  });

  it('ignores terminal evidence from a run selected independently of the current review packet', async () => {
    const {
      app,
      repo,
      releaseId,
      workItem: item,
      executionPackage: pkg,
      runSession: reviewRun,
      reviewPacket: selectedReviewPacket,
    } = await seedRelease({
      work_item: { risk: 'high' },
      execution_package: { integration_readiness: { risk: 'high' } },
      includeEvidenceChain: false,
    });
    const independentRun = runSession({
      id: 'run-session-independent-current',
      execution_package_id: pkg.id,
      created_at: '2026-05-05T00:03:00.000Z',
      updated_at: '2026-05-05T00:04:00.000Z',
      started_at: '2026-05-05T00:03:00.000Z',
      finished_at: '2026-05-05T00:04:00.000Z',
    });
    await repo.saveRunSession(independentRun);
    await repo.saveRelease({
      ...(await repo.getRelease(releaseId))!,
      current_review_packet_ids: [selectedReviewPacket.id],
      current_run_session_ids: [independentRun.id],
      updated_at: '2026-05-05T00:05:00.000Z',
    });
    await saveTerminalRunEvidenceTrace(repo, {
      releaseId,
      workItemId: item.id,
      executionPackageId: pkg.id,
      runSessionId: independentRun.id,
      reviewPacketId: selectedReviewPacket.id,
      suffix: independentRun.id,
    });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA should not accept evidence from a run outside the selected review packet.' })
      .expect(422);

    await saveTerminalRunEvidenceTrace(repo, {
      releaseId,
      workItemId: item.id,
      executionPackageId: pkg.id,
      runSessionId: reviewRun.id,
      reviewPacketId: selectedReviewPacket.id,
      suffix: reviewRun.id,
    });

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA accepts evidence from the selected review packet run.' })
      .expect(201);
  });

  it('rejects submit until QA re-acknowledges after linked run evidence changes', async () => {
    const { app, repo, releaseId, runSession: run } = await seedReleaseWithHighRiskLinkedWorkItemAndApprovedPackage();

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA accepts the original run evidence.' })
      .expect(201);

    await repo.saveRunSession({
      ...run,
      check_results: run.check_results.map((check) => ({
        ...check,
        stdout: {
          kind: 'check_output',
          name: 'Updated API test stdout',
          content_type: 'text/plain',
          storage_uri: 'https://example.test/api-test-stdout-v2.txt',
          digest: 'sha256:updated-api-test-stdout',
        },
      })),
      artifacts: [
        {
          kind: 'execution_summary',
          name: 'Updated execution summary',
          content_type: 'text/markdown',
          storage_uri: 'https://example.test/execution-summary-v2.md',
          digest: 'sha256:updated-execution-summary',
        },
      ],
      updated_at: '2026-05-05T00:02:00.000Z',
    });

    const staleSubmit = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
    expect(staleSubmit.body.blocker_snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_required_evidence_backlink',
          object_type: 'release',
          object_id: releaseId,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA accepts the updated run evidence.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
  });

  it('rejects submit until QA re-acknowledges after package gate inputs change', async () => {
    const { app, repo, releaseId, executionPackage: pkg } = await seedReleaseWithHighRiskLinkedWorkItemAndApprovedPackage();

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA accepts the original package gate inputs.' })
      .expect(201);

    await repo.saveExecutionPackage({
      ...pkg,
      required_checks: pkg.required_checks.map((check) => ({
        ...check,
        display_name: 'API tests after package gate input update',
        command: `${check.command} --reporter=verbose`,
      })),
      updated_at: '2026-05-05T00:02:00.000Z',
    });

    const staleSubmit = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(422);
    expect(staleSubmit.body.blocker_snapshot.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_required_evidence_backlink',
          object_type: 'release',
          object_id: releaseId,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/test-acceptance/acknowledge`)
      .set(qaHeaders)
      .send({ actor_id: actorQa, summary: 'QA accepts the updated package gate inputs.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
  });

  it('uses the selected review packet run as the current release runtime scope', async () => {
    const {
      app,
      repo,
      releaseId,
      executionPackage: pkg,
      runSession: selectedReviewRun,
      reviewPacket: selectedReviewPacket,
    } = await seedRelease();
    const newerRun = runSession({
      id: 'run-session-newer',
      execution_package_id: pkg.id,
      created_at: '2026-05-05T00:03:00.000Z',
      updated_at: '2026-05-05T00:04:00.000Z',
      started_at: '2026-05-05T00:03:00.000Z',
      finished_at: '2026-05-05T00:04:00.000Z',
    });
    await repo.saveRunSession(newerRun);
    await repo.saveRelease({
      ...(await repo.getRelease(releaseId))!,
      current_review_packet_ids: [selectedReviewPacket.id],
      current_run_session_ids: [newerRun.id],
      updated_at: '2026-05-05T00:05:00.000Z',
    });

    expect(selectedReviewPacket.run_session_id).toBe(selectedReviewRun.id);

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/submit-for-approval`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
  });

});
