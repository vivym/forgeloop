import { INestApplication } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import {
  executionActorDeveloper,
  seedApprovedExecutionPlan,
} from '../helpers/execution-supervision-fixtures';

describe('Executions API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('starts execution only from an approved Execution Plan revision, links the approved Spec chain, and enqueues a run session', async () => {
    const requiredChecks = [
      {
        check_id: 'docs-verify',
        command: 'pnpm vitest run tests/api/executions.test.ts',
        timeout_seconds: 120,
        blocks_review: true,
      },
    ];
    const { workItem, developmentPlan, item, specRevision, executionPlanRevision } = await seedApprovedExecutionPlan(app, {
      executionPlanRevisionSummary: 'Update strict dogfood runtime docs',
      executionPlanRevisionContent: 'Implement a docs-only strict dogfood runtime change.',
      executionPlanStructuredDocument: {
        implementation_sequence: ['Update runbook', 'Verify Execution bridge'],
        validation_strategy: ['Run focused Execution API tests'],
        allowed_paths: ['docs/**'],
        forbidden_paths: ['packages/db/**'],
        required_checks: requiredChecks,
        public_summary: 'Docs-only strict dogfood runtime execution.',
      },
    });
    const server = app.getHttpServer();

    const execution = (
      await request(server)
        .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;

    expect(execution).toMatchObject({
      development_plan_item_id: item.id,
      execution_plan_revision_id: executionPlanRevision.id,
      execution_plan_revision_ref: expect.objectContaining({ id: executionPlanRevision.id }),
      approved_spec_revision_id: specRevision.id,
      approved_spec_revision_ref: expect.objectContaining({ id: specRevision.id, spec_id: specRevision.spec_id }),
      status: 'running',
      evidence_refs: expect.arrayContaining([
        expect.objectContaining({ type: 'spec_revision', id: specRevision.id }),
        expect.objectContaining({ type: 'execution_plan_revision', id: executionPlanRevision.id }),
      ]),
      runtime_evidence_refs: expect.arrayContaining([
        expect.objectContaining({ type: 'execution_package' }),
        expect.objectContaining({ type: 'run_session' }),
      ]),
    });
    expect(execution).not.toHaveProperty('execution_package_id');
    expect(execution).not.toHaveProperty('run_session_id');
    expect(execution).not.toHaveProperty('internal_execution_package_id');
    expect(execution).not.toHaveProperty('internal_run_session_id');

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const executionPackageRef = execution.runtime_evidence_refs.find(
      (ref: { type: string; id: string }) => ref.type === 'execution_package',
    );
    const runSessionRef = execution.runtime_evidence_refs.find(
      (ref: { type: string; id: string }) => ref.type === 'run_session',
    );
    if (executionPackageRef === undefined) {
      throw new Error('Execution package runtime evidence ref was not recorded');
    }
    if (runSessionRef === undefined) {
      throw new Error('Run session runtime evidence ref was not recorded');
    }
    const executionPackage = await repository.getExecutionPackage(executionPackageRef.id);
    expect(executionPackage).toMatchObject({
      development_plan_item_id: item.id,
      execution_id: execution.id,
      execution_plan_revision_id: executionPlanRevision.id,
      objective: 'Update strict dogfood runtime docs',
      allowed_paths: ['docs/**'],
      forbidden_paths: ['packages/db/**'],
      required_checks: [
        expect.objectContaining({
          check_id: 'docs-verify',
          display_name: 'docs-verify',
          command: 'pnpm vitest run tests/api/executions.test.ts',
          timeout_seconds: 120,
          blocks_review: true,
        }),
      ],
    });
    expect(executionPackage?.task_id).toBeUndefined();
    if (executionPackage === undefined) {
      throw new Error('Execution package was not persisted');
    }
    const runSession = await repository.getRunSession(runSessionRef.id);
    expect(runSession?.run_spec).toMatchObject({
      execution_package_id: executionPackage.id,
      work_item_id: workItem.id,
      spec_revision_id: specRevision.id,
      plan_revision_id: executionPlanRevision.id,
      executor_type: 'local_codex',
      workflow_only: false,
      allowed_paths: ['docs/**'],
      forbidden_paths: ['packages/db/**'],
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({
      execution_status: 'running',
      next_action: 'monitor_execution',
    });
  });

  it('replays an already-started item revision without enqueueing a second run session', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app);
    const server = app.getHttpServer();
    const firstExecution = (
      await request(server)
        .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;

    const replayedExecution = (
      await request(server)
        .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;
    expect(replayedExecution.id).toBe(firstExecution.id);

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const [executionPackageRef] = firstExecution.runtime_evidence_refs.filter(
      (ref: { type: string }) => ref.type === 'execution_package',
    );
    const executionPackage = await repository.getExecutionPackage(executionPackageRef.id);
    expect(executionPackage?.execution_id).toBe(firstExecution.id);
    await expect(repository.listRunSessionsForPackage(executionPackageRef.id)).resolves.toHaveLength(1);
  });

  it('fails docs-only dogfood execution before launch when the approved Execution Plan omits docs allowlist', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app, {
      executionPlanRevisionSummary: 'Apply docs-only strict dogfood closure',
      executionPlanRevisionContent: 'This is a docs-only dogfood execution plan.',
      executionPlanStructuredDocument: {
        implementation_sequence: ['Update docs/superpowers/reports/dogfood.md'],
        validation_strategy: ['Verify docs-only mutation'],
        allowed_paths: ['apps/control-plane-api/**'],
        forbidden_paths: [],
        required_checks: [
          {
            check_id: 'docs-gate',
            command: 'pnpm test',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
        public_summary: 'Docs-only dogfood plan without docs allowlist.',
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
      .send({ actor_id: executionActorDeveloper })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'path_policy_docs_allowlist_required',
    });
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('fails closed for missing, draft, stale, or unapproved Execution Plan revisions', async () => {
    const { developmentPlan, item, executionPlan } = await seedApprovedExecutionPlan(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const server = app.getHttpServer();

    const blockedExecutionPlanStates = [
      {
        ...executionPlan,
        status: 'draft' as const,
        approved_revision_id: undefined,
        approved_by_actor_id: undefined,
        approved_at: undefined,
      },
      {
        ...executionPlan,
        status: 'in_review' as const,
        approved_revision_id: undefined,
        approved_by_actor_id: undefined,
        approved_at: undefined,
      },
      {
        ...executionPlan,
        status: 'approved' as const,
        current_revision_id: 'missing-approved-revision',
        approved_revision_id: 'missing-approved-revision',
      },
    ];

    for (const blockedExecutionPlan of blockedExecutionPlanStates) {
      await repository.saveExecutionPlan(blockedExecutionPlan);
      await request(server)
        .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
        .send({ actor_id: executionActorDeveloper })
        .expect(400);
    }

    await repository.saveExecutionPlan({
      ...executionPlan,
      status: 'approved',
      approved_revision_id: executionPlan.approved_revision_id,
      approved_by_actor_id: executionPlan.approved_by_actor_id,
      approved_at: executionPlan.approved_at,
      current_revision_id: 'stale-revision',
    });
    await request(server)
      .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
      .send({ actor_id: executionActorDeveloper })
      .expect(400);
  });

  it('fails closed when the approved Spec no longer owns the item Boundary chain', async () => {
    const { developmentPlan, item, specRevision } = await seedApprovedExecutionPlan(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const server = app.getHttpServer();

    await repository.saveSpecRevision({
      ...specRevision,
      structured_document: {
        ...(specRevision.structured_document ?? {}),
        boundary_summary_revision_id: 'missing-boundary-summary-revision',
      },
    });
    await request(server)
      .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
      .send({ actor_id: executionActorDeveloper })
      .expect(400);
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);

    await repository.saveSpecRevision({
      ...specRevision,
      development_plan_item_id: 'other-development-plan-item',
    });
    await request(server)
      .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
      .send({ actor_id: executionActorDeveloper })
      .expect(400);
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('supports interrupt and continue controls for a running product Execution', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app);
    const server = app.getHttpServer();
    const execution = (
      await request(server)
        .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;

    const interrupted = (
      await request(server)
        .post(`/executions/${execution.id}/interrupt`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;
    expect(interrupted.status).toBe('interrupted');

    const continued = (
      await request(server)
        .post(`/executions/${execution.id}/continue`)
        .send({ actor_id: executionActorDeveloper })
        .expect(201)
    ).body;
    expect(continued.status).toBe('running');

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({
      execution_status: 'running',
      next_action: 'monitor_execution',
    });
  });
});
