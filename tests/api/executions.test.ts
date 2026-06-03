import { INestApplication } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import type { DevelopmentPlanItemRevision } from '@forgeloop/domain';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import {
  executionActorDeveloper,
  seedApprovedExecutionPlan,
  startExecutionInternally,
} from '../helpers/execution-supervision-fixtures';
import {
  seedWorkflowWithApprovedImplementationPlan,
} from '../helpers/plan-item-workflow-fixtures';

const digest = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;

async function expectInternalExecutionStartToReject(
  app: INestApplication,
  developmentPlanId: string,
  itemId: string,
  expectedMessage: string,
) {
  try {
    await startExecutionInternally(app, developmentPlanId, itemId);
  } catch (error) {
    const response =
      typeof (error as { getResponse?: () => unknown }).getResponse === 'function'
        ? (error as { getResponse: () => unknown }).getResponse()
        : undefined;
    expect(`${error instanceof Error ? error.message : String(error)} ${JSON.stringify(response ?? error)}`).toContain(expectedMessage);
    return;
  }
  throw new Error(`Expected internal execution start to reject with ${expectedMessage}`);
}

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

  it('starts execution only from an approved Implementation Plan Doc revision, links the approved Spec chain, and enqueues a run session', async () => {
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
    const execution = await startExecutionInternally(app, developmentPlan.id, item.id);

    expect(execution).toMatchObject({
      development_plan_item_id: item.id,
      implementation_plan_revision_id: executionPlanRevision.id,
      implementation_plan_revision_ref: expect.objectContaining({ id: executionPlanRevision.id }),
      approved_spec_revision_id: specRevision.id,
      approved_spec_revision_ref: expect.objectContaining({ id: specRevision.id, spec_id: specRevision.spec_id }),
      status: 'running',
      evidence_refs: expect.arrayContaining([
        expect.objectContaining({ type: 'spec_revision', id: specRevision.id }),
        expect.objectContaining({ type: 'implementation_plan_revision', id: executionPlanRevision.id }),
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

  it('rejects direct execution start for workflow-owned items', async () => {
    const seeded = await seedWorkflowWithApprovedImplementationPlan(app, { idPrefix: '13131313' });
    const server = app.getHttpServer();

    await request(server)
      .post(`/development-plans/${seeded.plan.id}/items/${seeded.item.id}/execution/start`)
      .send({ actor_id: seeded.ids.actorLeader })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.listExecutions()).resolves.toHaveLength(0);
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('starts execution after the item revision advances through Spec and Implementation Plan Doc approvals', async () => {
    const { developmentPlan, item, specRevision, executionPlanRevision } = await seedApprovedExecutionPlan(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const boundary = await repository.getBoundarySummary(specRevision.boundary_summary_id!);
    if (boundary === undefined) {
      throw new Error('Boundary Summary was not persisted');
    }
    const [boundaryRevision] = await repository.listBoundarySummaryRevisions(boundary.id);
    if (boundaryRevision === undefined) {
      throw new Error('Boundary Summary Revision was not persisted');
    }
    const boundaryApprovalItemRevisionId = 'development-plan-item-revision-at-boundary-approval';
    await repository.saveBoundarySummary({
      ...boundary,
      development_plan_item_revision_id: boundaryApprovalItemRevisionId,
    });
    await repository.updateBoundarySummaryRevision({
      ...boundaryRevision,
      development_plan_item_revision_id: boundaryApprovalItemRevisionId,
    });
    const currentItem = {
      ...item,
      revision_id: 'development-plan-item-revision-after-execution-plan-approval',
      spec_status: 'approved' as const,
      implementation_plan_status: 'approved' as const,
      next_action: 'start_execution',
      updated_at: '2026-05-05T00:01:00.000Z',
    };
    const currentItemRevision: DevelopmentPlanItemRevision = {
      id: currentItem.revision_id,
      development_plan_item_id: currentItem.id,
      development_plan_id: currentItem.development_plan_id,
      revision_number: 2,
      snapshot: currentItem,
      change_reason: 'implementation_plan_approved',
      edited_by_actor_id: executionActorDeveloper,
      created_at: currentItem.updated_at,
    };
    await repository.saveDevelopmentPlanItem(currentItem);
    await repository.saveDevelopmentPlanItemRevision(currentItemRevision);

    const execution = await startExecutionInternally(app, developmentPlan.id, item.id);

    expect(execution).toMatchObject({
      development_plan_item_id: item.id,
      implementation_plan_revision_id: executionPlanRevision.id,
      approved_spec_revision_id: specRevision.id,
      status: 'running',
    });
    await expect(repository.listRunSessions()).resolves.toHaveLength(1);
  });

  it('fails closed when the item advances after Implementation Plan Doc approval before execution starts', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const driftedItem = {
      ...item,
      revision_id: 'development-plan-item-revision-after-unrelated-edit',
      spec_status: 'approved' as const,
      implementation_plan_status: 'approved' as const,
      next_action: 'start_execution',
      updated_at: '2026-05-05T00:01:00.000Z',
    };
    const driftedItemRevision: DevelopmentPlanItemRevision = {
      id: driftedItem.revision_id,
      development_plan_item_id: driftedItem.id,
      development_plan_id: driftedItem.development_plan_id,
      revision_number: 2,
      snapshot: driftedItem,
      change_reason: 'item_metadata_updated',
      edited_by_actor_id: executionActorDeveloper,
      created_at: driftedItem.updated_at,
    };
    await repository.saveDevelopmentPlanItem(driftedItem);
    await repository.saveDevelopmentPlanItemRevision(driftedItemRevision);

    await expectInternalExecutionStartToReject(
      app,
      developmentPlan.id,
      item.id,
      'approved_implementation_plan_not_current_item_revision',
    );
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('rejects legacy direct execution start before body validation and without persisting Execution Package ownership', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app, { seedExecutionPackage: false });
    const server = app.getHttpServer();

    await request(server)
      .post(`/development-plans/${developmentPlan.id}/items/${item.id}/execution/start`)
      .send({})
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.listExecutionPackages(developmentPlan.project_id)).resolves.toEqual([]);
  });

  it('rejects execution start when approved document gates have no runnable internal Execution Package boundary', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app, { seedExecutionPackage: false });

    await expectInternalExecutionStartToReject(app, developmentPlan.id, item.id, 'execution_package_boundary_missing');
  });

  it('does not create a second product Execution for an already-started item revision', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app);
    const firstExecution = await startExecutionInternally(app, developmentPlan.id, item.id);
    const replayedExecution = await startExecutionInternally(app, developmentPlan.id, item.id);
    expect(replayedExecution.id).toBe(firstExecution.id);

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const [executionPackageRef] = firstExecution.runtime_evidence_refs.filter(
      (ref: { type: string }) => ref.type === 'execution_package',
    );
    const executionPackage = await repository.getExecutionPackage(executionPackageRef.id);
    expect(executionPackage?.execution_id).toBe(firstExecution.id);
    await expect(repository.listRunSessionsForPackage(executionPackageRef.id)).resolves.toHaveLength(1);
  });

  it('exposes real run-worker execution evidence on product Development Plan Item projections', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app, {
      executionPlanRevisionSummary: 'Write strict runtime dogfood report',
      executionPlanRevisionContent: 'Create the public-safe dogfood report.',
      executionPlanStructuredDocument: {
        implementation_sequence: ['Write docs/superpowers/reports/codex-runtime-superpowers-dogfood.md'],
        validation_strategy: ['Verify public-safe report evidence'],
        allowed_paths: ['docs/**'],
        forbidden_paths: ['packages/db/**'],
        required_checks: [
          {
            check_id: 'docs-verify',
            command: 'pnpm vitest run tests/api/executions.test.ts',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
        public_summary: 'Docs-only strict runtime dogfood report.',
      },
    });
    const execution = await startExecutionInternally(app, developmentPlan.id, item.id);
    const runSessionRef = execution.runtime_evidence_refs.find((ref: { type: string; id: string }) => ref.type === 'run_session');
    if (runSessionRef === undefined) {
      throw new Error('Run session runtime evidence ref was not recorded');
    }
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const runSession = await repository.getRunSession(runSessionRef.id);
    if (runSession === undefined) {
      throw new Error('Run session was not persisted');
    }
    const changedFiles = [
      {
        repo_id: 'repo-1',
        path: 'docs/superpowers/reports/codex-runtime-superpowers-dogfood.md',
        change_kind: 'added' as const,
      },
    ];
    await repository.saveRunSession({
      ...runSession,
      status: 'succeeded',
      changed_files: changedFiles,
      executor_result: {
        run_session_id: runSession.id,
        executor_type: 'local_codex',
        executor_version: 'codex-remote-worker',
        status: 'succeeded',
        started_at: runSession.started_at ?? runSession.created_at,
        finished_at: '2026-05-05T00:02:00.000Z',
        summary: 'Strict runtime dogfood report written.',
        changed_files: changedFiles,
        checks: [],
        artifacts: [],
        raw_metadata: {
          workspace_bundle_digest: digest('w'),
          workspace_bundle_manifest_digest: digest('x'),
          mounted_task_workspace_digest: digest('m'),
        },
      },
      updated_at: '2026-05-05T00:02:00.000Z',
      finished_at: '2026-05-05T00:02:00.000Z',
    });

    const response = await request(app.getHttpServer())
      .get(`/query/development-plans/${developmentPlan.id}/items/${item.id}`)
      .expect(200);

    expect(response.body.executions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: execution.id,
          runtime_evidence: {
            workspace_bundle_digest: digest('w'),
            workspace_bundle_manifest_digest: digest('x'),
            mounted_task_workspace_digest: digest('m'),
            changed_files: ['docs/superpowers/reports/codex-runtime-superpowers-dogfood.md'],
          },
        }),
      ]),
    );
  });

  it('fails docs-only dogfood execution before launch when the approved Implementation Plan Doc omits docs allowlist', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app, {
      executionPlanRevisionSummary: 'Apply docs-only strict dogfood closure',
      executionPlanRevisionContent: 'This is a docs-only dogfood Implementation Plan Doc.',
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

    await expectInternalExecutionStartToReject(app, developmentPlan.id, item.id, 'path_policy_docs_allowlist_required');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('fails closed for missing, draft, stale, or unapproved Implementation Plan Doc revisions', async () => {
    const { developmentPlan, item, executionPlan } = await seedApprovedExecutionPlan(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

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
      await expectInternalExecutionStartToReject(app, developmentPlan.id, item.id, 'cannot start execution');
    }

    await repository.saveExecutionPlan({
      ...executionPlan,
      status: 'approved',
      approved_revision_id: executionPlan.approved_revision_id,
      approved_by_actor_id: executionPlan.approved_by_actor_id,
      approved_at: executionPlan.approved_at,
      current_revision_id: 'stale-revision',
    });
    await expectInternalExecutionStartToReject(app, developmentPlan.id, item.id, 'approved_implementation_plan_revision_not_current');
  });

  it('fails closed when the approved Spec no longer owns the item Boundary chain', async () => {
    const { developmentPlan, item, specRevision } = await seedApprovedExecutionPlan(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    await repository.saveSpecRevision({
      ...specRevision,
      structured_document: {
        ...(specRevision.structured_document ?? {}),
        boundary_summary_revision_id: 'missing-boundary-summary-revision',
      },
    });
    await expectInternalExecutionStartToReject(app, developmentPlan.id, item.id, 'approved_spec_boundary_revision_missing');
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);

    await repository.saveSpecRevision({
      ...specRevision,
      development_plan_item_id: 'other-development-plan-item',
    });
    await expectInternalExecutionStartToReject(app, developmentPlan.id, item.id, 'approved_spec_item_mismatch');
    await expect(repository.listRunSessions()).resolves.toHaveLength(0);
  });

  it('supports interrupt and continue controls for a running product Execution', async () => {
    const { developmentPlan, item } = await seedApprovedExecutionPlan(app);
    const server = app.getHttpServer();
    const execution = await startExecutionInternally(app, developmentPlan.id, item.id);

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
