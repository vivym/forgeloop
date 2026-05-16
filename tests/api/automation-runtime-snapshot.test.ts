import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { RUN_WORKER } from '../../apps/control-plane-api/src/p0/p0.service';
import { signAutomationRequest } from '../../packages/automation/src/index';
import type {
  ExecutionPackage,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  RunSession,
  Spec,
  SpecRevision,
  WorkItem,
} from '../../packages/domain/src/index';
import { buildManualScopeKey, transitionExecutionPackage } from '../../packages/domain/src/index';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';

const secret = 'test-secret';
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const now = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';
const rawSecretPath = '/Users/viv/projs/forgeloop/.worktrees/feature/http-automation-daemon-mvp-impl';

const apps: INestApplication[] = [];

const bootAutomationApp = async (): Promise<{ app: INestApplication; repository: DeliveryRepository }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(new InMemoryDeliveryRepository())
    .overrideProvider(RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  apps.push(app);
  return { app, repository: app.get(DELIVERY_REPOSITORY) as DeliveryRepository };
};

const signedAutomationGet = (app: INestApplication, pathAndQuery = '/internal/automation/runtime-snapshot') => {
  const headers = signAutomationRequest({
    method: 'GET',
    pathAndQuery,
    rawBody: Buffer.alloc(0),
    actorId: 'daemon-actor',
    actorClass: 'automation_daemon',
    daemonIdentity: 'daemon-1',
    timestamp: new Date().toISOString(),
    secret,
  });

  return request(app.getHttpServer()).get(pathAndQuery).set(headers);
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

const projectRepo = (overrides: Partial<ProjectRepo> = {}): ProjectRepo => ({
  id: 'project-repo-1',
  repo_id: 'repo-1',
  project_id: 'project-1',
  name: 'forgeloop',
  status: 'active',
  local_path: '/workspace/forgeloop',
  default_branch: 'main',
  base_commit_sha: 'abc123',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const workItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'work-item-1',
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Ship runtime snapshot',
  goal: 'Expose daemon planner projection.',
  success_criteria: ['Daemon receives eligible targets.'],
  priority: 'P0',
  risk: 'medium',
  owner_actor_id: actorOwner,
  phase: 'spec',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
  current_spec_id: 'spec-1',
  current_spec_revision_id: 'spec-revision-1',
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
  summary: 'Approved runtime snapshot spec',
  content: 'Spec body',
  background: 'Background',
  goals: ['Expose runtime snapshot'],
  scope_in: ['Automation daemon'],
  scope_out: [],
  acceptance_criteria: ['Snapshot includes eligible targets'],
  risk_notes: [],
  test_strategy_summary: 'API tests',
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
  summary: 'Approved runtime snapshot plan',
  content: 'Plan body',
  implementation_summary: 'Implement snapshot projection.',
  split_strategy: 'One package',
  dependency_order: [],
  test_matrix: ['pnpm test tests/api/automation-runtime-snapshot.test.ts'],
  risk_mitigations: [],
  rollback_notes: 'Revert snapshot service.',
  artifact_refs: [],
  created_at: now,
  ...overrides,
});

const seedProjectRepo = async (repository: DeliveryRepository, overrides: { repo?: Partial<ProjectRepo> } = {}) => {
  await repository.saveProject(project());
  await repository.saveProjectRepo(projectRepo(overrides.repo));
  return repository.setAutomationProjectSettings({
    id: 'automation-settings-repo-1',
    project_id: 'project-1',
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'draft_only',
    expected_version: 0,
    reason: 'enable snapshot tests',
    evidence_refs: [],
    actor: { actor_id: actorOwner, actor_class: 'human_admin' },
    now,
  });
};

const addDraftOnlyRepo = async (repository: DeliveryRepository, repo: Partial<ProjectRepo> & { repo_id: string }) => {
  await repository.saveProjectRepo(
    projectRepo({
      id: `project-${repo.repo_id}`,
      name: repo.repo_id,
      local_path: `/workspace/${repo.repo_id}`,
      ...repo,
    }),
  );
  return repository.setAutomationProjectSettings({
    id: `automation-settings-${repo.repo_id}`,
    project_id: repo.project_id ?? 'project-1',
    repo_id: repo.repo_id,
    scope_type: 'repo',
    preset: 'draft_only',
    expected_version: 0,
    reason: 'enable second repo ambiguity test',
    evidence_refs: [],
    actor: { actor_id: actorOwner, actor_class: 'human_admin' },
    now,
  });
};

const seedApprovedSpec = async (repository: DeliveryRepository, overrides: { item?: Partial<WorkItem> } = {}) => {
  await seedProjectRepo(repository);
  await repository.saveWorkItem(workItem(overrides.item));
  await repository.saveSpec(spec({ work_item_id: overrides.item?.id ?? 'work-item-1' }));
  await repository.saveSpecRevision(specRevision({ work_item_id: overrides.item?.id ?? 'work-item-1' }));
};

const seedApprovedPlan = async (repository: DeliveryRepository) => {
  await seedApprovedSpec(repository, { item: { phase: 'plan', current_plan_id: 'plan-1', current_plan_revision_id: 'plan-revision-1' } });
  await repository.savePlan(plan());
  await repository.savePlanRevision(planRevision());
};

const seedReadyExecutionPackage = async (repository: DeliveryRepository): Promise<ExecutionPackage> => {
  const generated = transitionExecutionPackage(undefined, {
    type: 'generate_package',
    id: 'execution-package-1',
    work_item_id: 'work-item-1',
    spec_id: 'spec-1',
    spec_revision_id: 'spec-revision-1',
    plan_id: 'plan-1',
    plan_revision_id: 'plan-revision-1',
    project_id: 'project-1',
    repo_id: 'repo-1',
    objective: 'Implement snapshot projection.',
    owner_actor_id: actorOwner,
    reviewer_actor_id: actorReviewer,
    qa_owner_actor_id: actorQa,
    required_checks: [],
    required_artifact_kinds: [],
    allowed_paths: ['apps/control-plane-api/**'],
    forbidden_paths: [],
    at: now,
  });
  const readyPackage = transitionExecutionPackage(generated, { type: 'mark_ready', at: later });
  await repository.saveExecutionPackage(readyPackage);
  return readyPackage;
};

const seedCompletedAction = async (
  repository: DeliveryRepository,
  input: {
    id: string;
    actionType: string;
    status?: 'succeeded' | 'failed' | 'skipped' | 'blocked';
    targetObjectType?: string;
    targetObjectId?: string;
    targetRevisionId?: string;
    targetStatus?: string;
    automationScope?: `project:${string}` | `repo:${string}:${string}`;
    actionInputJson?: Record<string, unknown>;
    resultJson?: Record<string, unknown>;
    finishedAt?: string;
  },
) => {
  const claimToken = `${input.id}-claim`;
  await repository.claimAutomationActionRun({
    id: input.id,
    action_type: input.actionType,
    target_object_type: input.targetObjectType ?? 'work_item',
    target_object_id: input.targetObjectId ?? 'work-item-1',
    ...(input.targetRevisionId === undefined ? {} : { target_revision_id: input.targetRevisionId }),
    target_status: input.targetStatus ?? 'approved',
    idempotency_key: `${input.id}-idempotency`,
    automation_scope: input.automationScope ?? 'repo:project-1:repo-1',
    automation_settings_version: 1,
    capability_fingerprint: 'capability-fingerprint-1',
    precondition_fingerprint: `${input.id}-precondition`,
    action_input_json: input.actionInputJson ?? {},
    claim_token: claimToken,
    locked_until: '2026-05-05T00:10:00.000Z',
    now,
  });
  return repository.completeAutomationActionRun({
    id: input.id,
    idempotency_key: `${input.id}-idempotency`,
    claim_token: claimToken,
    status: input.status ?? 'succeeded',
    ...(input.resultJson === undefined ? {} : { result_json: input.resultJson }),
    finished_at: input.finishedAt ?? later,
  });
};

describe('internal automation runtime snapshot', () => {
  beforeEach(() => {
    process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = secret;
    process.env.FORGELOOP_AUTOMATION_TEST_NOW = now;
  });

  afterEach(async () => {
    delete process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
    delete process.env.FORGELOOP_AUTOMATION_TEST_NOW;
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('lists approved spec revisions missing plan drafts', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedSpec(repository);

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.work_items_requiring_plan).toContainEqual(
          expect.objectContaining({
            target_object_type: 'work_item',
            target_object_id: 'work-item-1',
            target_revision_id: 'spec-revision-1',
            target_status: 'approved',
            project_id: 'project-1',
            repo_id: 'repo-1',
            automation_scope: 'repo:project-1:repo-1',
          }),
        );
      });
  });

  it('preserves project scope for approved specs when multiple active repos can draft plans', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedSpec(repository);
    await addDraftOnlyRepo(repository, { repo_id: 'repo-2' });

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.work_items_requiring_plan).toEqual([
          expect.objectContaining({
            target_object_type: 'work_item',
            target_object_id: 'work-item-1',
            target_revision_id: 'spec-revision-1',
            target_status: 'approved',
            project_id: 'project-1',
            eligible_repo_ids: ['repo-1', 'repo-2'],
            automation_scope: 'project:project-1',
          }),
        ]);
        expect(body.work_items_requiring_plan[0]).not.toHaveProperty('repo_id');
      });
  });

  it('keeps duplicate active project repo rows as a single logical repo for plan draft targets', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedSpec(repository);
    await repository.saveProjectRepo(
      projectRepo({
        id: 'project-repo-duplicate-row',
        name: 'forgeloop duplicate row',
        local_path: '/workspace/forgeloop-duplicate',
      }),
    );

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.work_items_requiring_plan).toEqual([
          expect.objectContaining({
            target_object_type: 'work_item',
            target_object_id: 'work-item-1',
            target_revision_id: 'spec-revision-1',
            project_id: 'project-1',
            repo_id: 'repo-1',
            automation_scope: 'repo:project-1:repo-1',
          }),
        ]);
        expect(body.work_items_requiring_plan[0]).not.toHaveProperty('eligible_repo_ids');
      });
  });

  it('lists approved plan revisions missing package generation', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedPlan(repository);

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.plan_revisions_requiring_packages).toContainEqual(
          expect.objectContaining({
            target_object_type: 'plan_revision',
            target_object_id: 'plan-revision-1',
            target_revision_id: 'default:plan-revision-1',
            target_status: 'approved',
            project_id: 'project-1',
            repo_id: 'repo-1',
            generation_key: 'default:plan-revision-1',
          }),
        );
      });
  });

  it('preserves project scope for approved plan revisions when multiple active repos can draft packages', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedPlan(repository);
    await addDraftOnlyRepo(repository, { repo_id: 'repo-2' });

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.plan_revisions_requiring_packages).toEqual([
          expect.objectContaining({
            target_object_type: 'plan_revision',
            target_object_id: 'plan-revision-1',
            target_revision_id: 'default:plan-revision-1',
            target_status: 'approved',
            project_id: 'project-1',
            eligible_repo_ids: ['repo-1', 'repo-2'],
            automation_scope: 'project:project-1',
            generation_key: 'default:plan-revision-1',
          }),
        ]);
        expect(body.plan_revisions_requiring_packages[0]).not.toHaveProperty('repo_id');
      });
  });

  it('keeps duplicate active project repo rows as a single logical repo for package draft targets', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedPlan(repository);
    await repository.saveProjectRepo(
      projectRepo({
        id: 'project-repo-duplicate-row',
        name: 'forgeloop duplicate row',
        local_path: '/workspace/forgeloop-duplicate',
      }),
    );

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.plan_revisions_requiring_packages).toEqual([
          expect.objectContaining({
            target_object_type: 'plan_revision',
            target_object_id: 'plan-revision-1',
            target_revision_id: 'default:plan-revision-1',
            project_id: 'project-1',
            repo_id: 'repo-1',
            automation_scope: 'repo:project-1:repo-1',
            generation_key: 'default:plan-revision-1',
          }),
        ]);
        expect(body.plan_revisions_requiring_packages[0]).not.toHaveProperty('eligible_repo_ids');
      });
  });

  it('suppresses mutating eligibility for active manual holds and terminal work items', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedSpec(repository);
    await repository.saveWorkItem(
      workItem({
        id: 'work-item-done',
        current_spec_id: 'spec-done',
        current_spec_revision_id: 'spec-revision-done',
        phase: 'done',
        resolution: 'completed',
      }),
    );
    await repository.saveSpec(spec({ id: 'spec-done', work_item_id: 'work-item-done', current_revision_id: 'spec-revision-done' }));
    await repository.saveSpecRevision(specRevision({ id: 'spec-revision-done', spec_id: 'spec-done', work_item_id: 'work-item-done' }));
    await repository.requestManualPathHold({
      id: 'hold-work-item-1',
      object_type: 'work_item',
      object_id: 'work-item-1',
      scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: 'work-item-1' }),
      reason_code: 'needs_human_triage',
      reason: 'Human triage required.',
      evidence_refs: [],
      requested_by: 'daemon-1',
      requested_at: now,
      idempotency_key: 'hold-work-item-1-idempotency',
    });

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.work_items_requiring_plan).toEqual([]);
        expect(JSON.stringify(body)).not.toContain('work-item-done');
      });
  });

  it('reports run enqueue disabled for ready packages', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedPlan(repository);
    await seedReadyExecutionPackage(repository);

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.run_enqueue_disabled_reason).toBe('run_enqueue_disabled_by_scope');
        expect(body.run_enqueue_disabled_packages).toContainEqual(
          expect.objectContaining({
            target_object_type: 'execution_package',
            target_object_id: 'execution-package-1',
            target_revision_id: 'plan-revision-1',
            target_status: 'ready',
            project_id: 'project-1',
            repo_id: 'repo-1',
            automation_scope: 'repo:project-1:repo-1',
            disabled_reason: 'run_enqueue_disabled_by_scope',
          }),
        );
      });
  });

  it('suppresses package draft eligibility for active work item ancestor holds', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedPlan(repository);
    await repository.requestManualPathHold({
      id: 'hold-work-item-package-ancestor',
      object_type: 'work_item',
      object_id: 'work-item-1',
      scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: 'work-item-1' }),
      reason_code: 'needs_human_triage',
      reason: 'Human triage required before package drafting.',
      evidence_refs: [],
      requested_by: 'daemon-1',
      requested_at: now,
      idempotency_key: 'hold-work-item-package-ancestor-idempotency',
    });

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.plan_revisions_requiring_packages).toEqual([]);
      });
  });

  it('suppresses package draft eligibility for active spec revision ancestor holds', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedPlan(repository);
    await repository.requestManualPathHold({
      id: 'hold-spec-revision-package-ancestor',
      object_type: 'spec_revision',
      object_id: 'spec-revision-1',
      scope_key: buildManualScopeKey({ object_type: 'spec_revision', object_id: 'spec-revision-1' }),
      reason_code: 'needs_human_spec_review',
      reason: 'Spec review required before package drafting.',
      evidence_refs: [],
      requested_by: 'daemon-1',
      requested_at: now,
      idempotency_key: 'hold-spec-revision-package-ancestor-idempotency',
    });

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.plan_revisions_requiring_packages).toEqual([]);
      });
  });

  it('includes public-safe active hold summaries', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedSpec(repository);
    await repository.requestManualPathHold({
      id: 'hold-public-summary',
      object_type: 'work_item',
      object_id: 'work-item-1',
      scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: 'work-item-1' }),
      reason_code: 'needs_human_triage',
      reason: 'Human triage required.',
      evidence_refs: [{ kind: 'file', uri: `${rawSecretPath}/hold-evidence.txt` }],
      requested_by: 'daemon-1',
      requested_at: now,
      idempotency_key: 'hold-public-summary-idempotency',
    });

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.active_holds).toContainEqual({
          object_type: 'work_item',
          object_id: 'work-item-1',
          scope_key: 'work_item:work-item-1',
          reason_code: 'needs_human_triage',
          status: 'active',
          requested_at: now,
          fingerprint: 'work_item:work-item-1:needs_human_triage',
        });
        expect(JSON.stringify(body.active_holds)).not.toContain(rawSecretPath);
        expect(JSON.stringify(body.active_holds)).not.toContain('evidence_refs');
      });
  });

  it('projects latest completed runtime policy observations and last known good policy data', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedProjectRepo(repository);
    await repository.saveProjectRepo(
      projectRepo({
        id: 'project-repo-2',
        repo_id: 'repo-2',
        local_path: '/workspace/forgeloop-secondary',
      }),
    );
    await repository.setAutomationProjectSettings({
      id: 'automation-settings-repo-2',
      project_id: 'project-1',
      repo_id: 'repo-2',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable unsafe path projection test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now,
    });
    await seedCompletedAction(repository, {
      id: 'policy-loaded-old',
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'repo',
      targetObjectId: 'repo-1',
      targetStatus: 'observed',
      finishedAt: '2026-05-05T00:01:00.000Z',
      actionInputJson: {
        repo_id: 'repo-1',
        policy_status: 'loaded',
        policy_digest: 'sha256:old-good',
        parser_version: 'workflow-md-parser:v1',
      },
      resultJson: {
        repo_id: 'repo-1',
        policy_status: 'loaded',
        policy_digest: 'sha256:old-good',
        parser_version: 'workflow-md-parser:v1',
        observed_at: '2026-05-05T00:00:30.000Z',
      },
    });
    await seedCompletedAction(repository, {
      id: 'policy-loaded-latest',
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'repo',
      targetObjectId: 'repo-1',
      targetStatus: 'observed',
      finishedAt: '2026-05-05T00:02:00.000Z',
      actionInputJson: {
        repo_id: 'repo-1',
        policy_status: 'loaded',
        policy_digest: 'sha256:last-good',
        parser_version: 'workflow-md-parser:v1',
      },
      resultJson: {
        repo_id: 'repo-1',
        policy_status: 'loaded',
        policy_digest: 'sha256:last-good',
        parser_version: 'workflow-md-parser:v1',
        observed_at: '2026-05-05T00:01:30.000Z',
      },
    });
    await seedCompletedAction(repository, {
      id: 'policy-parse-failed-current',
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'repo',
      targetObjectId: 'repo-1',
      targetStatus: 'observed',
      finishedAt: '2026-05-05T00:03:00.000Z',
      actionInputJson: {
        repo_id: 'repo-1',
        policy_status: 'parse_failed',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'workflow_parse_failed',
      },
      resultJson: {
        repo_id: 'repo-1',
        policy_status: 'parse_failed',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'workflow_parse_failed',
        observed_at: '2026-05-05T00:02:45.000Z',
        last_known_good_policy_digest: 'sha256:daemon-supplied-good',
        last_known_good_observed_at: '2026-05-05T00:01:15.000Z',
        local_path: rawSecretPath,
        metadata_json: { hmac: 'secret-hmac' },
        command_output: 'secret command output',
        claim_token: 'secret-claim-token',
      },
    });
    await seedCompletedAction(repository, {
      id: 'policy-loaded-repo-2',
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'repo',
      targetObjectId: 'repo-2',
      targetStatus: 'observed',
      automationScope: 'repo:project-1:repo-2',
      finishedAt: '2026-05-05T00:02:30.000Z',
      actionInputJson: {
        repo_id: 'repo-2',
        policy_status: 'loaded',
        policy_digest: 'sha256:repo-2-good',
        parser_version: 'workflow-md-parser:v1',
      },
      resultJson: {
        repo_id: 'repo-2',
        policy_status: 'loaded',
        policy_digest: 'sha256:repo-2-good',
        parser_version: 'workflow-md-parser:v1',
        observed_at: '2026-05-05T00:02:15.000Z',
      },
    });
    await seedCompletedAction(repository, {
      id: 'policy-unsafe-current',
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'repo',
      targetObjectId: 'repo-2',
      targetStatus: 'observed',
      automationScope: 'repo:project-1:repo-2',
      finishedAt: '2026-05-05T00:03:30.000Z',
      actionInputJson: {
        repo_id: 'repo-2',
        policy_status: 'unsafe_path',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'workflow_unsafe_path',
      },
      resultJson: {
        repo_id: 'repo-2',
        policy_status: 'unsafe_path',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'workflow_unsafe_path',
        observed_at: '2026-05-05T00:03:15.000Z',
      },
    });

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        expect(body.repos).toContainEqual(
          expect.objectContaining({
            repo_id: 'repo-1',
            policy_projection: {
              repo_id: 'repo-1',
              policy_status: 'parse_failed',
              parser_version: 'workflow-md-parser:v1',
              reason_code: 'workflow_parse_failed',
              observed_at: '2026-05-05T00:02:45.000Z',
              last_known_good_policy_digest: 'sha256:last-good',
              last_known_good_observed_at: '2026-05-05T00:01:30.000Z',
            },
          }),
        );
        expect(body.repos).toContainEqual(
          expect.objectContaining({
            repo_id: 'repo-2',
            policy_projection: expect.objectContaining({
              policy_status: 'unsafe_path',
              reason_code: 'workflow_unsafe_path',
              last_known_good_policy_digest: 'sha256:repo-2-good',
              observed_at: '2026-05-05T00:03:15.000Z',
              last_known_good_observed_at: '2026-05-05T00:02:15.000Z',
            }),
          }),
        );
        const publicSnapshot = JSON.stringify(body);
        expect(publicSnapshot).not.toContain(rawSecretPath);
        expect(publicSnapshot).not.toContain('secret-hmac');
        expect(publicSnapshot).not.toContain('secret command output');
        expect(publicSnapshot).not.toContain('secret-claim-token');
        expect(publicSnapshot).not.toContain('metadata_json');
        expect(publicSnapshot).not.toContain('command_output');
      });
  });

  it('keeps policy projections isolated by canonical repo scope when projects share a repo id', async () => {
    const { app, repository } = await bootAutomationApp();
    await repository.saveProject(
      project({
        id: 'project-alpha',
        name: 'Alpha',
        repo_ids: ['shared-repo'],
      }),
    );
    await repository.saveProjectRepo(
      projectRepo({
        id: 'project-alpha-shared-repo',
        project_id: 'project-alpha',
        repo_id: 'shared-repo',
        name: 'shared-alpha',
        local_path: '/workspace/alpha',
      }),
    );
    await repository.setAutomationProjectSettings({
      id: 'automation-settings-alpha-shared',
      project_id: 'project-alpha',
      repo_id: 'shared-repo',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable alpha projection',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now,
    });
    await repository.saveProject(
      project({
        id: 'project-beta',
        name: 'Beta',
        repo_ids: ['shared-repo'],
      }),
    );
    await repository.saveProjectRepo(
      projectRepo({
        id: 'project-beta-shared-repo',
        project_id: 'project-beta',
        repo_id: 'shared-repo',
        name: 'shared-beta',
        local_path: '/workspace/beta',
      }),
    );
    await repository.setAutomationProjectSettings({
      id: 'automation-settings-beta-shared',
      project_id: 'project-beta',
      repo_id: 'shared-repo',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable beta projection',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now,
    });
    await seedCompletedAction(repository, {
      id: 'policy-alpha-loaded',
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'repo',
      targetObjectId: 'shared-repo',
      targetStatus: 'observed',
      automationScope: 'repo:project-alpha:shared-repo',
      finishedAt: '2026-05-05T00:01:00.000Z',
      actionInputJson: {
        repo_id: 'shared-repo',
        policy_status: 'loaded',
        policy_digest: 'sha256:alpha-policy',
        parser_version: 'workflow-md-parser:v1',
      },
      resultJson: {
        repo_id: 'shared-repo',
        policy_status: 'loaded',
        policy_digest: 'sha256:alpha-policy',
        parser_version: 'workflow-md-parser:v1',
        observed_at: '2026-05-05T00:00:45.000Z',
      },
    });
    await seedCompletedAction(repository, {
      id: 'policy-beta-loaded',
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'repo',
      targetObjectId: 'shared-repo',
      targetStatus: 'observed',
      automationScope: 'repo:project-beta:shared-repo',
      finishedAt: '2026-05-05T00:02:00.000Z',
      actionInputJson: {
        repo_id: 'shared-repo',
        policy_status: 'loaded',
        policy_digest: 'sha256:beta-policy',
        parser_version: 'workflow-md-parser:v1',
      },
      resultJson: {
        repo_id: 'shared-repo',
        policy_status: 'loaded',
        policy_digest: 'sha256:beta-policy',
        parser_version: 'workflow-md-parser:v1',
        observed_at: '2026-05-05T00:01:45.000Z',
      },
    });
    await seedCompletedAction(repository, {
      id: 'policy-project-scope-ignored',
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'project',
      targetObjectId: 'project-alpha',
      targetStatus: 'observed',
      automationScope: 'project:project-alpha',
      finishedAt: '2026-05-05T00:03:00.000Z',
      actionInputJson: {
        repo_id: 'shared-repo',
        policy_status: 'loaded',
        policy_digest: 'sha256:project-scope-ignored',
        parser_version: 'workflow-md-parser:v1',
      },
      resultJson: {
        repo_id: 'shared-repo',
        policy_status: 'loaded',
        policy_digest: 'sha256:project-scope-ignored',
        parser_version: 'workflow-md-parser:v1',
        observed_at: '2026-05-05T00:02:45.000Z',
      },
    });
    await seedCompletedAction(repository, {
      id: 'policy-mismatched-scope-ignored',
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'repo',
      targetObjectId: 'other-repo',
      targetStatus: 'observed',
      automationScope: 'repo:project-alpha:other-repo',
      finishedAt: '2026-05-05T00:04:00.000Z',
      actionInputJson: {
        repo_id: 'shared-repo',
        policy_status: 'loaded',
        policy_digest: 'sha256:mismatched-scope-ignored',
        parser_version: 'workflow-md-parser:v1',
      },
      resultJson: {
        repo_id: 'shared-repo',
        policy_status: 'loaded',
        policy_digest: 'sha256:mismatched-scope-ignored',
        parser_version: 'workflow-md-parser:v1',
        observed_at: '2026-05-05T00:03:45.000Z',
      },
    });

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        const alphaRepo = body.repos.find(
          (repo: { project_id: string; repo_id: string }) => repo.project_id === 'project-alpha' && repo.repo_id === 'shared-repo',
        );
        const betaRepo = body.repos.find(
          (repo: { project_id: string; repo_id: string }) => repo.project_id === 'project-beta' && repo.repo_id === 'shared-repo',
        );

        expect(alphaRepo?.policy_projection).toMatchObject({
          repo_id: 'shared-repo',
          policy_status: 'loaded',
          policy_digest: 'sha256:alpha-policy',
          observed_at: '2026-05-05T00:00:45.000Z',
        });
        expect(betaRepo?.policy_projection).toMatchObject({
          repo_id: 'shared-repo',
          policy_status: 'loaded',
          policy_digest: 'sha256:beta-policy',
          observed_at: '2026-05-05T00:01:45.000Z',
        });
        expect(JSON.stringify(body.repos)).not.toContain('project-scope-ignored');
        expect(JSON.stringify(body.repos)).not.toContain('mismatched-scope-ignored');
      });
  });

  it('redacts raw action results, runtime metadata, and public-unsafe local paths', async () => {
    const { app, repository } = await bootAutomationApp();
    await seedApprovedPlan(repository);
    const readyPackage = await seedReadyExecutionPackage(repository);
    const runSession: RunSession = {
      id: 'run-session-1',
      execution_package_id: readyPackage.id,
      requested_by_actor_id: actorOwner,
      status: 'failed',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      runtime_metadata: {
        durability_mode: 'durable',
        workspace_path: `${rawSecretPath}/repo`,
        source_repo_path: `${rawSecretPath}/repo`,
        recovery_attempt_count: 1,
        effective_dangerous_mode: 'confirmed',
      },
      created_at: now,
      updated_at: later,
    };
    await repository.saveRunSession(runSession);
    await seedCompletedAction(repository, {
      id: 'action-with-private-output',
      actionType: 'ensure_plan_draft',
      resultJson: { local_path: `${rawSecretPath}/result.json`, raw_metadata: { secret: 'raw-runtime-metadata' } },
    });

    await signedAutomationGet(app)
      .expect(200)
      .expect(({ body }) => {
        const publicSnapshot = JSON.stringify({
          ...body,
          repos: body.repos.map((repo: Record<string, unknown>) => ({ ...repo, daemon_internal_local_path: '<allowed>' })),
        });
        expect(body.repos[0].daemon_internal_local_path).toBe('/workspace/forgeloop');
        expect(publicSnapshot).not.toContain(rawSecretPath);
        expect(publicSnapshot).not.toContain('result_json');
        expect(publicSnapshot).not.toContain('metadata_json');
        expect(publicSnapshot).not.toContain('raw-runtime-metadata');
        expect(publicSnapshot).not.toContain('runtime_metadata');
      });
  });
});
