import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunSession } from '@forgeloop/domain';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY, RUN_DURABILITY_MODE } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../../apps/control-plane-api/src/modules/core/control-plane-runtime.service';
import { QueryController } from '../../apps/control-plane-api/src/modules/query/query.controller';
import { actorClassHeaderName, actorHeaderName } from '../../apps/control-plane-api/src/modules/auth/actor-context';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { InMemoryDeliveryRepository } from '../../packages/db/src/index';
import {
  seedActiveRunExecutionProfile,
  seedOnlineCompatibleCodexWorker,
  seedReadyExecutionPackage,
  seedReadyLocalCodexExecutionPackage,
  seedSingleCredentialBinding,
} from '../helpers/delivery-runtime-fixtures';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const ownerHeaders = { [actorHeaderName]: actorOwner, [actorClassHeaderName]: 'human_admin' };
const reviewerHeaders = { [actorHeaderName]: actorReviewer, [actorClassHeaderName]: 'human' };
const later = '2026-05-05T00:01:00.000Z';
const unsafeInternalStrings = [
  'allowed_paths',
  'forbidden_paths',
  'raw_payload',
  'raw_metadata',
  'runtime_metadata',
  'review_payload',
  'raw_extra',
  'client_secret',
] as const;

const validSpecRevision = {
  summary: 'Replay decision spec',
  content: 'Spec content for replay decision coverage.',
  background: 'Replay should show human decision evidence.',
  goals: ['Expose decision summaries'],
  scope_in: ['Spec replay'],
  scope_out: ['Package execution'],
  acceptance_criteria: ['Decision summaries are visible'],
  risk_notes: ['Keep public replay redacted'],
  test_strategy_summary: 'Query module replay test',
  author_actor_id: actorOwner,
};

const validPlanRevision = {
  summary: 'Replay decision plan',
  content: 'Plan content for replay decision coverage.',
  implementation_summary: 'Implement replay decision coverage.',
  split_strategy: 'Single focused change.',
  dependency_order: ['query-replay'],
  test_matrix: ['pnpm vitest run tests/api/query-module.test.ts'],
  risk_mitigations: ['Keep replay public-safe'],
  rollback_notes: 'Revert query replay changes.',
  author_actor_id: actorOwner,
};

describe('query module', () => {
  const apps: INestApplication[] = [];

  const track = async <T extends { app: INestApplication }>(value: Promise<T>): Promise<T> => {
    const resolved = await value;
    apps.push(resolved.app);
    return resolved;
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.unstubAllEnvs();
  });

  it('allows AppModule to override core query providers without QueryModule owning delivery wiring', async () => {
    const repository = new InMemoryDeliveryRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_REPOSITORY)
      .useValue(repository)
      .compile();

    try {
      expect(moduleRef.get(DELIVERY_REPOSITORY)).toBe(repository);
    } finally {
      await moduleRef.close();
    }
  });

  it('exposes shared core tokens from the semantic core boundary', async () => {
    const coreTokensModule = await import('../../apps/control-plane-api/src/modules/core/control-plane-tokens');

    expect(coreTokensModule).toHaveProperty('DELIVERY_REPOSITORY');
    expect(coreTokensModule).toHaveProperty('RUN_DURABILITY_MODE');
  });

  const createTestApp = async (options: { durabilityMode?: 'durable' | 'volatile_demo'; now?: string } = {}) => {
    const repo = new InMemoryDeliveryRepository();
    let idCounter = 0;
    let moduleBuilder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_REPOSITORY)
      .useValue(repo)
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined });
    if (options.durabilityMode !== undefined) {
      moduleBuilder = moduleBuilder.overrideProvider(RUN_DURABILITY_MODE).useValue(options.durabilityMode);
    }
    if (options.now !== undefined) {
      moduleBuilder = moduleBuilder.overrideProvider(ControlPlaneRuntimeService).useValue({
        id: (prefix: string) => `${prefix}-test-${++idCounter}`,
        now: () => options.now,
      });
    }
    const moduleRef = await moduleBuilder.compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return { app, repo };
  };

  const seedReadyPackage = async (app: INestApplication) =>
    await seedReadyExecutionPackage(app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository);

  const createLinkedRelease = async (app: INestApplication) => {
    const executionPackage = await seedReadyPackage(app);
    const releaseResponse = await request(app.getHttpServer())
      .post('/releases')
      .set(ownerHeaders)
      .send({
        actor_id: actorOwner,
        project_id: executionPackage.project_id,
        title: 'Release Radar',
        rollout_strategy: 'Ship behind a feature flag.',
        rollback_plan: 'Disable the feature flag.',
        observation_plan: 'Watch latency for 30 minutes.',
      })
      .expect(201);
    const releaseId = releaseResponse.body.release.id as string;

    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/work-items/${executionPackage.work_item_id}`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/execution-packages/${executionPackage.id}`)
      .set(ownerHeaders)
      .send({ actor_id: actorOwner })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/releases/${releaseId}/evidences`)
      .set(ownerHeaders)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Release cockpit observation.',
        extra: {
          observation: {
            source: 'human',
            severity: 'info',
            observed_at: later,
            summary: 'Release looks healthy.',
            links: [
              { object_type: 'release', object_id: releaseId, relationship: 'observed' },
              { object_type: 'work_item', object_id: executionPackage.work_item_id, relationship: 'affected' },
            ],
          },
        },
      })
      .expect(201);

    return { executionPackage, releaseId };
  };

  const createProjectRepoWorkItem = async (app: INestApplication) => {
    const server = app.getHttpServer();
    const project = (await request(server).post('/projects').send({ name: 'Replay Project', owner_actor_id: actorOwner }).expect(201))
      .body;
    await request(server)
      .post(`/projects/${project.id}/repos`)
      .send({
        repo_id: 'repo-replay',
        name: 'forgeloop',
        local_path: '/workspace/forgeloop',
        default_branch: 'main',
        base_commit_sha: 'abc123',
      })
      .expect(201);
    const workItem = (
      await request(server)
        .post('/work-items')
        .send({
          project_id: project.id,
          kind: 'requirement',
          title: 'Replay decision evidence',
          goal: 'Show Spec and Plan decisions in replay.',
          success_criteria: ['Spec replay includes decisions', 'Plan replay includes decisions'],
          priority: 'high',
          risk: 'medium',
          driver_actor_id: actorOwner,
          intake_context: {
            type: 'requirement',
            stakeholder_problem: 'Replay needs Work Item driver-safe fixtures.',
            desired_outcome: 'Query tests seed typed Work Item intake records.',
            acceptance_criteria: ['The replay test Work Item can create Spec and Plan revisions.'],
            in_scope: ['Query module tests'],
          },
        })
        .expect(201)
    ).body;

    return { project, workItem };
  };

  it('returns the work item cockpit from the query surface', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    await repo.saveRunSession({
      id: 'run-session-runtime-redaction',
      execution_package_id: executionPackage.id,
      requested_by_actor_id: actorOwner,
      status: 'running',
      executor_type: 'local_codex',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        worker_id: 'worker-runtime-redaction',
        worker_lease_status: 'active',
        worker_lease_heartbeat_at: '2026-05-20T00:00:00.000Z',
        worker_lease_expires_at: '2026-05-20T00:05:00.000Z',
        last_event_cursor: 'cursor-runtime-redaction',
        last_event_at: '2026-05-20T00:00:01.000Z',
        recovery_attempt_count: 0,
        runtime_profile_id: 'profile-runtime-redaction',
        credential_binding_id: 'credential-runtime-redaction',
        launch_lease_id: 'lease-runtime-redaction',
        docker_image_digest: `sha256:${'a'.repeat(64)}`,
        workspace_path: '/workspace/private',
        codex_config_toml: 'approval_policy = "never"',
        effective_dangerous_mode: 'not_requested',
      },
      created_at: later,
      updated_at: later,
    });

    const response = await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}`)
      .expect(200);
    const serialized = JSON.stringify(response.body);

    expect(response.body.item).toMatchObject({ id: executionPackage.work_item_id });
    expect(response.body.packages).toEqual([expect.objectContaining({ id: executionPackage.id })]);
    expect(response.body.run_sessions).toEqual(expect.any(Array));
    expect(response.body.run_sessions.find((run: { id: string }) => run.id === 'run-session-runtime-redaction')).toMatchObject({
      runtime_metadata: {
        durability_mode: 'durable',
        driver_kind: 'app_server',
        driver_status: 'active',
        last_event_at: '2026-05-20T00:00:01.000Z',
        recovery_attempt_count: 0,
      },
    });
    for (const unsafeText of [
      'worker-runtime-redaction',
      'cursor-runtime-redaction',
      'profile-runtime-redaction',
      'credential-runtime-redaction',
      'lease-runtime-redaction',
      'sha256:',
      '/workspace/private',
      'codex_config_toml',
    ]) {
      expect(serialized).not.toContain(unsafeText);
    }
    expect(response.body.review_packets).toEqual(expect.any(Array));
    expect(response.body.delivery_readiness).toMatchObject({
      scope_ref: { type: 'requirement', id: executionPackage.work_item_id },
      active_lane: 'requirements',
    });
    expect(response.body).not.toHaveProperty('next_actions');
    expect(response.body).not.toHaveProperty('completion_state');

    await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=execution-owner`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.delivery_readiness.active_lane).toBe('execution-owner');
      });

    await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=unknown`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?foo=bar`)
      .expect(400);

    vi.spyOn(repo, 'listExecutionPackageDependencies').mockRejectedValueOnce(new Error('dependency read failed'));
    const degraded = await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=execution-owner`)
      .expect(200);
    expect(degraded.body.delivery_readiness.degraded_sources).toContain('package_dependencies');
    expect(degraded.body.delivery_readiness.stages.find((stage: { id: string }) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'blocked',
    });

    vi.spyOn(repo, 'listExecutionPackagesForWorkItem').mockRejectedValueOnce(new Error('package read failed'));
    const degradedPackages = await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=execution-owner`)
      .expect(200);
    expect(degradedPackages.body.delivery_readiness.degraded_sources).toContain('execution_packages');
    expect(degradedPackages.body.delivery_readiness.stages.find((stage: { id: string }) => stage.id === 'packages')).toMatchObject({
      state: 'blocked',
    });

    vi.spyOn(repo, 'getSpecRevision').mockRejectedValueOnce(new Error('spec revision read failed'));
    const degradedSpecRevision = await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}`)
      .expect(200);
    expect(degradedSpecRevision.body.delivery_readiness.degraded_sources).toContain('spec_revision');
    expect(degradedSpecRevision.body.delivery_readiness.stages.find((stage: { id: string }) => stage.id === 'spec')).toMatchObject({
      state: 'blocked',
    });
  });

  it('returns public-safe runtime readiness for a local Codex execution package', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repo);
    const profile = await seedActiveRunExecutionProfile(repo, executionPackage);
    await seedSingleCredentialBinding(repo, profile, executionPackage);
    await seedOnlineCompatibleCodexWorker(repo, profile, executionPackage);

    const response = await request(app.getHttpServer())
      .get(`/query/execution-packages/${executionPackage.id}/runtime-readiness`)
      .expect(200);
    const serialized = JSON.stringify(response.body);

    expect(response.body).toMatchObject({
      executor_type: 'local_codex',
      target_kind: 'run_execution',
    });
    expect(response.body.state).toMatch(/^(ready|blocked)$/);
    expect(response.body.generated_at).toBe('2026-05-05T00:00:01.000Z');
    expect(response.body).not.toHaveProperty('execution_package_id');
    for (const unsafeText of [
      'profile-run-execution',
      'credential-binding',
      'worker-',
      'lease-',
      'sha256:',
      '/workspace/',
      'codex_config',
      'runtime_profile_id',
      'credential_binding_id',
      'docker_image_digest',
    ]) {
      expect(serialized).not.toContain(unsafeText);
    }
  });

  it('uses server run execution runtime config for readiness without exposing raw selection ids', async () => {
    const { app, repo } = await track(createTestApp({ now: '2026-05-20T00:00:00.000Z' }));
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repo);
    const profile = await seedActiveRunExecutionProfile(repo, executionPackage);
    const configuredBinding = await seedSingleCredentialBinding(repo, profile, executionPackage, 'configured');
    await seedSingleCredentialBinding(repo, profile, executionPackage, 'rotation');
    await seedOnlineCompatibleCodexWorker(repo, profile, executionPackage);
    vi.stubEnv('FORGELOOP_CODEX_RUN_EXECUTION_RUNTIME_PROFILE_ID', profile.profile_id);
    vi.stubEnv('FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID', configuredBinding.bindingId);

    const readiness = await request(app.getHttpServer())
      .get(`/query/execution-packages/${executionPackage.id}/runtime-readiness`)
      .expect(200);
    expect(readiness.body).toMatchObject({ state: 'ready', blockers: [] });

    const cockpit = await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=execution-owner`)
      .expect(200);
    const runAction = cockpit.body.delivery_readiness.next_actions.find(
      (candidate: { kind: string; command?: { type: string } }) =>
        candidate.kind === 'command' && candidate.command?.type === 'run_package',
    );
    expect(runAction).toMatchObject({ enabled: true });

    const serialized = `${JSON.stringify(readiness.body)} ${JSON.stringify(cockpit.body)}`;
    expect(serialized).not.toContain(profile.profile_id);
    expect(serialized).not.toContain(configuredBinding.bindingId);
    expect(serialized).not.toContain('runtime_profile_id');
    expect(serialized).not.toContain('credential_binding_id');
  });

  it('uses runtime readiness blockers to disable cockpit run package next actions', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repo);

    const response = await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}?lane=execution-owner`)
      .expect(200);
    const action = response.body.delivery_readiness.next_actions.find(
      (candidate: { kind: string; command?: { type: string } }) =>
        candidate.kind === 'command' && candidate.command?.type === 'run_package',
    );

    expect(action).toMatchObject({
      enabled: false,
      disabled_reason: 'A local Codex run execution profile must be active for this package scope.',
      blocked_reason: 'A local Codex run execution profile must be active for this package scope.',
      command: expect.objectContaining({ type: 'run_package', package_id: executionPackage.id }),
    });
    expect(JSON.stringify(action)).not.toContain('sha256:');
    expect(JSON.stringify(action)).not.toContain('/workspace');
    expect(JSON.stringify(action)).not.toContain('codex_config');
  });

  it('returns 404 for a missing work item cockpit', async () => {
    const { app } = await track(createTestApp());

    await request(app.getHttpServer()).get('/query/work-item-cockpit/missing-work-item').expect(404);
  });

  it('returns the release cockpit from the query surface', async () => {
    const { app } = await track(createTestApp());
    const { releaseId } = await createLinkedRelease(app);

    const response = await request(app.getHttpServer()).get(`/query/release-cockpit/${releaseId}`).expect(200);

    expect(response.body.release).toMatchObject({ id: releaseId });
    expect(response.body.latest_run_sessions).toEqual(expect.any(Array));
    expect(response.body.current_review_packets).toEqual(expect.any(Array));
    expect(response.body.evidences).toEqual(expect.any(Array));
    expect(response.body.observations).toEqual(expect.any(Array));
    expect(response.body.decisions).toEqual(expect.any(Array));
    expect(response.body.overridden_blockers).toEqual(expect.any(Array));
    expect(response.body.checklist).toEqual(expect.any(Array));
    expect(response.body.risk_summary).toEqual(expect.any(Object));
  });

  it('serves the product pipeline read model with all PRD stages', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    const projectId = executionPackage.project_id;
    const runSession: RunSession = {
      id: 'run-session-for-pipeline',
      execution_package_id: executionPackage.id,
      requested_by_actor_id: actorOwner,
      status: 'succeeded',
      executor_type: 'mock',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      summary: 'Pipeline run succeeded.',
      created_at: later,
      updated_at: later,
      finished_at: later,
    };
    await repo.saveRunSession(runSession);
    await repo.saveReviewPacket({
      id: 'review-packet-for-pipeline',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      reviewer_actor_id: executionPackage.reviewer_actor_id,
      spec_revision_id: executionPackage.spec_revision_id,
      plan_revision_id: executionPackage.plan_revision_id,
      status: 'ready',
      decision: 'none',
      changed_files: [],
      check_result_summary: 'Pipeline checks passed.',
      self_review: { status: 'succeeded', summary: 'Ready for review.' },
      requested_changes: [],
      risk_notes: [],
      created_at: later,
      updated_at: later,
    });

    const response = await request(app.getHttpServer()).get('/query/pipeline').query({ project_id: projectId }).expect(200);

    expect(response.body.stages.map((stage: { id: string }) => stage.id)).toEqual([
      'intake',
      'spec_plan',
      'execution',
      'review',
      'integration_validation',
      'test_acceptance',
      'release',
      'observation',
    ]);
    expect(response.body.degraded_sources).toEqual(expect.any(Array));
    expect(response.body.stages.every((stage: { degraded: boolean; stale_hint?: string }) => stage.degraded && stage.stale_hint)).toBe(
      true,
    );
    expect(response.body.stages.find((stage: { id: string }) => stage.id === 'spec_plan').representative_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ object: expect.objectContaining({ type: 'spec' }) }),
        expect.objectContaining({ object: expect.objectContaining({ type: 'execution_plan' }) }),
      ]),
    );
    expect(response.body.stages.find((stage: { id: string }) => stage.id === 'execution').representative_items).toEqual(
      expect.arrayContaining([expect.objectContaining({ object: expect.objectContaining({ type: 'run_session' }) })]),
    );
    expect(response.body.stages.find((stage: { id: string }) => stage.id === 'review').representative_items).toEqual(
      expect.arrayContaining([expect.objectContaining({ object: expect.objectContaining({ type: 'review_packet' }) })]),
    );
  });

  it('reports unsupported product pipeline filters as degraded sources', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    const projectId = executionPackage.project_id;

    const response = await request(app.getHttpServer())
      .get('/query/pipeline')
      .query({ project_id: projectId, status: 'idle', risk: 'high', phase: 'execution' })
      .expect(200);

    expect(response.body.degraded_sources).toEqual(
      expect.arrayContaining([
        'pipeline:unsupported_filter:status',
        'pipeline:unsupported_filter:risk',
        'pipeline:unsupported_filter:phase',
      ]),
    );
  });

  it('applies the product pipeline limit to representative items', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    const projectId = executionPackage.project_id;

    const response = await request(app.getHttpServer())
      .get('/query/pipeline')
      .query({ project_id: projectId, limit: 1 })
      .expect(200);
    const executionStage = response.body.stages.find((stage: { id: string }) => stage.id === 'execution');

    expect(executionStage.representative_items).toHaveLength(1);
    for (const stage of response.body.stages as { representative_items: unknown[] }[]) {
      expect(stage.representative_items.length).toBeLessThanOrEqual(1);
    }
  });

  it('serves product list read models for specs, plans, packages, runs, and reviews', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    const projectId = executionPackage.project_id;
    await repo.saveExecutionPackage({
      ...executionPackage,
      current_run_session_id: 'run-session-product-list-current',
      current_review_packet_id: 'review-packet-product-list-current',
      integration_readiness: { status: 'ready' },
      required_test_gates: [{ gate_id: 'regression' }],
      updated_at: later,
    });

    await request(app.getHttpServer()).get('/query/work-items').query({ project_id: projectId }).expect(200);
    await request(app.getHttpServer()).get('/query/specs').query({ project_id: projectId }).expect(200);
    await request(app.getHttpServer()).get('/query/plans').query({ project_id: projectId }).expect(200);
    const packageResponse = await request(app.getHttpServer())
      .get('/query/execution-packages')
      .query({ project_id: projectId })
      .expect(200);
    expect(packageResponse.body.items).toContainEqual(
      expect.objectContaining({
        id: executionPackage.id,
        package_state: expect.objectContaining({
          current_run_session_id: 'run-session-product-list-current',
          current_review_packet_id: 'review-packet-product-list-current',
          integration_readiness: { status: 'ready' },
          required_test_gates: [{ gate_id: 'regression' }],
        }),
      }),
    );
    await request(app.getHttpServer()).get('/query/runs').query({ project_id: projectId }).expect(200);
    await request(app.getHttpServer()).get('/query/review-packets').query({ project_id: projectId }).expect(200);
  });

  it('filters product Work Items by driver_actor_id and does not expose owner_actor_id', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    const projectId = executionPackage.project_id;

    const response = await request(app.getHttpServer())
      .get('/query/work-items')
      .query({ project_id: projectId, driver_actor_id: actorOwner })
      .expect(200);

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: executionPackage.work_item_id,
          driver_actor_id: actorOwner,
        }),
      ]),
    );
    expect(JSON.stringify(response.body.items)).not.toContain('owner_actor_id');
  });

  it('rejects owner_actor_id on product Work Item registry queries', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);

    await request(app.getHttpServer())
      .get('/query/work-items')
      .query({ project_id: executionPackage.project_id, owner_actor_id: actorOwner })
      .expect(400);
  });

  it('keeps non-Work-Item product registry owner and reviewer filters', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    const projectId = executionPackage.project_id;

    const packagesResponse = await request(app.getHttpServer())
      .get('/query/execution-packages')
      .query({ project_id: projectId, execution_owner_actor_id: actorOwner })
      .expect(200);
    expect(packagesResponse.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: executionPackage.id, execution_owner_actor_id: actorOwner })]),
    );

    await request(app.getHttpServer())
      .get('/query/review-packets')
      .query({ project_id: projectId, reviewer_actor_id: actorReviewer })
      .expect(200);
  });

  it('parses product list boolean query filters from strings', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    const projectId = executionPackage.project_id;

    const unblockedResponse = await request(app.getHttpServer())
      .get('/query/execution-packages')
      .query({ project_id: projectId, blocked: 'false' })
      .expect(200);
    expect(unblockedResponse.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: executionPackage.id })]),
    );

    await repo.saveExecutionPackage({
      ...executionPackage,
      blocked_reason: 'Waiting for manual unblock.',
      updated_at: later,
    });

    const blockedResponse = await request(app.getHttpServer())
      .get('/query/execution-packages')
      .query({ project_id: projectId, blocked: 'true' })
      .expect(200);
    expect(blockedResponse.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: executionPackage.id })]),
    );

    const blockedFalseResponse = await request(app.getHttpServer())
      .get('/query/execution-packages')
      .query({ project_id: projectId, blocked: 'false' })
      .expect(200);
    expect(blockedFalseResponse.body.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: executionPackage.id })]),
    );
  });

  it('serves Spec and Plan history through replay-compatible endpoints', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    const specId = executionPackage.spec_id;
    const planId = executionPackage.plan_id;

    await request(app.getHttpServer()).get(`/query/replay/spec/${specId}`).expect(200);
    await request(app.getHttpServer()).get(`/query/replay/plan/${planId}`).expect(200);
  });

  it('includes Spec and Plan approval decisions in replay timelines', async () => {
    const { app } = await track(createTestApp());
    const server = app.getHttpServer();
    const { workItem } = await createProjectRepoWorkItem(app);
    const spec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body;
    await request(server).post(`/specs/${spec.id}/revisions`).send(validSpecRevision).expect(201);
    await request(server).post(`/specs/${spec.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
    await request(server)
      .post(`/specs/${spec.id}/approve`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Spec approved for replay.' })
      .expect(201);

    const plan = (await request(server).post(`/work-items/${workItem.id}/plans`).send({}).expect(201)).body;
    await request(server).post(`/plans/${plan.id}/revisions`).send(validPlanRevision).expect(201);
    await request(server).post(`/plans/${plan.id}/submit-for-approval`).set(ownerHeaders).send({ actor_id: actorOwner }).expect(201);
    await request(server)
      .post(`/plans/${plan.id}/approve`)
      .set(reviewerHeaders)
      .send({ actor_id: actorReviewer, rationale: 'Plan approved for replay.' })
      .expect(201);

    const specReplay = await request(server).get(`/query/replay/spec/${spec.id}`).expect(200);
    const planReplay = await request(server).get(`/query/replay/plan/${plan.id}`).expect(200);

    expect(specReplay.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'decision',
          object_type: 'spec',
          object_id: spec.id,
          summary: 'Spec approved for replay.',
        }),
      ]),
    );
    expect(planReplay.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'decision',
          object_type: 'plan',
          object_id: plan.id,
          summary: 'Plan approved for replay.',
        }),
      ]),
    );
    expect(JSON.stringify([...specReplay.body, ...planReplay.body])).not.toContain('raw_ref');
  });

  it('does not expose unsafe release cockpit internals', async () => {
    const { app } = await track(createTestApp());
    const { releaseId } = await createLinkedRelease(app);

    const response = await request(app.getHttpServer()).get(`/query/release-cockpit/${releaseId}`).expect(200);
    const serialized = JSON.stringify(response.body);

    for (const unsafeText of unsafeInternalStrings) {
      expect(serialized).not.toContain(unsafeText);
    }
  });

  it('does not depend on emitted constructor metadata to inject query routes', async () => {
    const metadataReflect = Reflect as typeof Reflect & {
      deleteMetadata?: (metadataKey: string, target: object) => boolean;
      defineMetadata?: (metadataKey: string, metadataValue: unknown, target: object) => void;
      getMetadata?: (metadataKey: string, target: object) => unknown;
    };
    const existingParamTypes = metadataReflect.getMetadata?.('design:paramtypes', QueryController);
    metadataReflect.deleteMetadata?.('design:paramtypes', QueryController);

    try {
      const { app } = await track(createTestApp());

      await request(app.getHttpServer()).get('/query/work-item-cockpit/missing-work-item').expect(404);
    } finally {
      if (existingParamTypes !== undefined) {
        metadataReflect.defineMetadata?.('design:paramtypes', existingParamTypes, QueryController);
      }
    }
  });

  it('returns the work item replay from the query surface', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);

    const response = await request(app.getHttpServer())
      .get(`/query/replay/work_item/${executionPackage.work_item_id}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'object_event',
          object_type: 'work_item',
          object_id: executionPackage.work_item_id,
        }),
        expect.objectContaining({
          object_type: 'execution_package',
          object_id: executionPackage.id,
        }),
      ]),
    );
  });

  it('returns execution package and review packet replay from the query surface', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    const runSession: RunSession = {
      id: 'run-session-for-replay',
      execution_package_id: executionPackage.id,
      requested_by_actor_id: actorOwner,
      status: 'succeeded',
      executor_type: 'mock',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      created_at: later,
      updated_at: later,
      finished_at: later,
    };
    const reviewPacketId = 'review-packet-for-replay';

    await repo.saveRunSession(runSession);
    await repo.saveReviewPacket({
      id: reviewPacketId,
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      reviewer_actor_id: executionPackage.reviewer_actor_id,
      spec_revision_id: executionPackage.spec_revision_id,
      plan_revision_id: executionPackage.plan_revision_id,
      status: 'ready',
      decision: 'none',
      changed_files: [],
      check_result_summary: 'Required checks passed.',
      self_review: {
        status: 'succeeded',
        summary: 'Ready for public replay.',
        spec_plan_alignment: 'Aligned.',
        test_assessment: 'Passed.',
        risk_notes: [],
        follow_up_questions: [],
      },
      risk_notes: [],
      requested_changes: [],
      created_at: later,
      updated_at: later,
    });
    await repo.appendObjectEvent({
      id: 'review-packet-replay-event',
      object_type: 'review_packet',
      object_id: reviewPacketId,
      event_type: 'review_packet_ready',
      actor_type: 'system',
      metadata: {},
      payload: { review_packet_id: reviewPacketId },
      created_at: later,
    });

    const packageReplay = await request(app.getHttpServer())
      .get(`/query/replay/execution_package/${executionPackage.id}`)
      .expect(200);
    const reviewDetail = await request(app.getHttpServer()).get(`/query/reviews/${reviewPacketId}`).expect(200);
    const reviewReplay = await request(app.getHttpServer()).get(`/query/replay/review_packet/${reviewPacketId}`).expect(200);

    expect(packageReplay.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ object_type: 'execution_package', object_id: executionPackage.id })]),
    );
    expect(reviewDetail.body).toEqual(expect.objectContaining({ id: reviewPacketId, execution_package_id: executionPackage.id }));
    expect(reviewReplay.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ object_type: 'review_packet', object_id: reviewPacketId })]),
    );
  });

  it('returns the release replay from the query surface through the public boundary', async () => {
    const { app } = await track(createTestApp());
    const { releaseId } = await createLinkedRelease(app);

    const response = await request(app.getHttpServer()).get(`/query/replay/release/${releaseId}`).expect(200);
    const serialized = JSON.stringify(response.body);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'object_event',
          object_type: 'release',
          object_id: releaseId,
        }),
      ]),
    );
    for (const unsafeText of unsafeInternalStrings) {
      expect(serialized).not.toContain(unsafeText);
    }
  });

  it('redacts unsafe release evidence backlinks from cockpit and replay links', async () => {
    const { app } = await track(createTestApp());
    const { releaseId } = await createLinkedRelease(app);

    const createResponse = await request(app.getHttpServer())
      .post(`/releases/${releaseId}/evidences`)
      .set(ownerHeaders)
      .send({
        actor_id: actorOwner,
        evidence_type: 'observation_note',
        summary: 'Backlink points to a non-public object.',
        extra: {
          observation: {
            source: 'human',
            severity: 'warning',
            observed_at: later,
            summary: 'Follow-up needed.',
            links: [
              { object_type: 'release', object_id: releaseId, relationship: 'observed' },
              { object_type: 'work_item', object_id: 'missing-work-item', relationship: 'affected' },
            ],
          },
        },
      })
      .expect(201);
    expect(createResponse.body.blockers.map((blocker: { code: string }) => blocker.code)).toContain(
      'unsafe_or_redacted_evidence_backlink',
    );

    const cockpit = await request(app.getHttpServer()).get(`/query/release-cockpit/${releaseId}`).expect(200);
    const replay = await request(app.getHttpServer()).get(`/query/replay/release/${releaseId}`).expect(200);

    expect(JSON.stringify(cockpit.body.evidences)).not.toContain('missing-work-item');
    expect(JSON.stringify(cockpit.body.observations)).not.toContain('missing-work-item');
    expect(JSON.stringify(replay.body)).not.toContain('missing-work-item');
    expect(cockpit.body.blockers.map((blocker: { code: string }) => blocker.code)).toContain(
      'unsafe_or_redacted_evidence_backlink',
    );
  });

  it('serializes replay payloads through the public evidence boundary', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);
    const workItemId = executionPackage.work_item_id;
    const createdAt = '2026-05-10T00:00:00.000Z';

    await repo.appendObjectEvent({
      id: 'object-event-public-boundary',
      object_type: 'work_item',
      object_id: workItemId,
      event_type: 'work_item_public_boundary',
      actor_type: 'system',
      actor_id: 'actor-system',
      reason: 'test',
      metadata: { internal_payload: 'not public' },
      payload: {
        work_item_id: workItemId,
        required_check_ids: ['contracts', 123],
        accessToken: 'secret',
        output_path: '/Users/viv/out.log',
        unknown: 'drop me',
      },
      created_at: createdAt,
    });
    await repo.appendStatusHistory({
      id: 'status-history-public-boundary',
      object_type: 'work_item',
      object_id: workItemId,
      to_status: 'ready',
      context: {
        work_item_id: workItemId,
        failed_check_ids: ['api', false],
        client_secret: 'secret',
        path: 'artifacts/run/out.log',
      },
      created_at: createdAt,
    });
    await repo.saveDecision({
      id: 'decision-public-boundary',
      object_type: 'work_item',
      object_id: workItemId,
      actor_id: 'actor-reviewer',
      decision: 'approved',
      summary: 'Approved',
      evidence_refs: { raw_ref: 'local://decision/raw.json' },
      created_at: createdAt,
    });
    await repo.saveArtifact({
      id: 'artifact-unsafe-uri',
      object_type: 'work_item',
      object_id: workItemId,
      ref: {
        kind: 'diff',
        name: 'Unsafe patch',
        content_type: 'text/x-patch',
        storage_uri: 'https://example.test/out.patch?token=secret',
      },
      created_at: createdAt,
    });
    await repo.saveArtifact({
      id: 'artifact-safe-uri',
      object_type: 'work_item',
      object_id: workItemId,
      ref: {
        kind: 'diff',
        name: 'Safe patch',
        content_type: 'text/x-patch',
        storage_uri: 'https://example.test/out.patch',
        local_ref: '/Users/viv/private/out.patch',
        digest: 'sha256:1234',
      },
      created_at: createdAt,
    });

    const response = await request(app.getHttpServer()).get(`/query/replay/work_item/${workItemId}`).expect(200);
    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('client_secret');
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('artifacts/run/out.log');
    expect(serialized).not.toContain('raw_ref');
    expect(serialized).not.toContain('token=secret');
    expect(serialized).not.toContain('metadata');
    expect(serialized).not.toContain('internal_payload');

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'object-event-public-boundary',
          source: 'object_event',
          payload: expect.objectContaining({
            payload: { work_item_id: workItemId, required_check_ids: ['contracts'] },
          }),
        }),
        expect.objectContaining({
          id: 'status-history-public-boundary',
          source: 'status_history',
          payload: expect.objectContaining({
            context: { work_item_id: workItemId, failed_check_ids: ['api'] },
          }),
        }),
        expect.objectContaining({
          id: 'decision-public-boundary',
          source: 'decision',
          payload: expect.not.objectContaining({ evidence_refs: expect.anything() }),
        }),
        expect.objectContaining({
          id: 'artifact-safe-uri',
          source: 'artifact',
          payload: {
            kind: 'diff',
            name: 'Safe patch',
            content_type: 'text/x-patch',
            storage_uri: 'https://example.test/out.patch',
            digest: 'sha256:1234',
          },
        }),
      ]),
    );

    expect(response.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'artifact-unsafe-uri' })]));
  });

  it('returns 404 for a missing supported replay object', async () => {
    const { app } = await track(createTestApp());

    await request(app.getHttpServer()).get('/query/replay/work_item/missing-work-item').expect(404);
    await request(app.getHttpServer()).get('/query/replay/release/missing-release').expect(404);
  });

  it('rejects unsupported replay object types before lookup', async () => {
    const { app } = await track(createTestApp());

    const response = await request(app.getHttpServer()).get('/query/replay/unsupported/missing').expect(400);
    await request(app.getHttpServer()).get('/query/replay/incident/incident-1').expect(400);

    expect(response.body.message).toContain('Unsupported replay object type');
  });

  it('does not expose old work item read routes', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyPackage(app);

    await request(app.getHttpServer()).get(`/work-items/${executionPackage.work_item_id}/cockpit`).expect(404);
    await request(app.getHttpServer()).get(`/work-items/${executionPackage.work_item_id}/timeline`).expect(404);
  });

  it('preserves only public-safe durable runtime metadata fallback when a leased run has no persisted runtime metadata', async () => {
    const { app, repo } = await track(createTestApp({ durabilityMode: 'durable' }));
    const executionPackage = await seedReadyPackage(app);
    const runSession: RunSession = {
      id: 'run-session-with-old-metadata',
      execution_package_id: executionPackage.id,
      requested_by_actor_id: 'actor-owner',
      status: 'running',
      executor_type: 'mock',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      created_at: '2026-05-05T00:10:00.000Z',
      updated_at: '2026-05-05T00:10:00.000Z',
    };

    await repo.saveRunSession(runSession);
    await repo.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-05T00:10:01.000Z',
      expires_at: '2026-05-05T00:11:01.000Z',
    });

    const response = await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}`)
      .expect(200);

    expect(response.body.run_sessions[0].runtime_metadata).toEqual({
      durability_mode: 'durable',
      recovery_attempt_count: 0,
    });
    expect(JSON.stringify(response.body)).not.toContain('worker-1');
    expect(JSON.stringify(response.body)).not.toContain('lease-token-1');
  });
});
