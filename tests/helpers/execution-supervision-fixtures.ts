import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DeliveryRepository } from '@forgeloop/db';
import type {
  DevelopmentPlan,
  DevelopmentPlanItem,
  Execution,
  ExecutionPlanDocument,
  ExecutionPlanRevision,
  SpecRevision,
  WorkItem,
} from '@forgeloop/domain';

import { ControlPlaneRuntimeService } from '../../apps/control-plane-api/src/modules/core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { seedItemScopedSpecPlan } from './item-scoped-artifact-fixtures';
import { createWorkflowPolicyRepoRoot } from './runtime-policy-repo';

export const executionActorDeveloper = 'actor-dev';
export const executionActorOwner = 'actor-owner';
export const executionActorReviewer = 'actor-reviewer';
export const executionActorQa = 'actor-qa';
export const executionActorTechLead = 'actor-tech-lead';

export const reviewerHeaders = {
  'x-forgeloop-actor-id': executionActorReviewer,
  'x-forgeloop-actor-class': 'human',
};

export const techLeadHeaders = {
  'x-forgeloop-actor-id': executionActorTechLead,
  'x-forgeloop-actor-class': 'human_admin',
};

export type ApprovedExecutionPlanSeed = {
  workItem: WorkItem;
  developmentPlan: DevelopmentPlan;
  item: DevelopmentPlanItem;
  specRevision: SpecRevision;
  executionPlan: ExecutionPlanDocument;
  executionPlanRevision: ExecutionPlanRevision;
};

export async function seedApprovedExecutionPlan(
  app: INestApplication,
  options: {
    executionPlanRevisionSummary?: string;
    executionPlanRevisionContent?: string;
    executionPlanStructuredDocument?: Record<string, unknown>;
  } = {},
): Promise<ApprovedExecutionPlanSeed> {
  const server = app.getHttpServer();
  const project = (
    await request(server)
      .post('/projects')
      .send({ name: 'AI-native project management', owner_actor_id: executionActorOwner })
      .expect(201)
  ).body;
  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: 'repo-1',
      name: 'forgeloop',
      local_path: await createWorkflowPolicyRepoRoot(),
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
        title: 'Build product execution supervision',
        goal: 'Move item execution through code review and QA handoff.',
        success_criteria: ['Execution starts only from an approved item Execution Plan.'],
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: executionActorOwner,
        intake_context: {
          type: 'requirement',
          stakeholder_problem: 'AI execution needs a product-level supervision loop.',
          desired_outcome: 'A Development Plan Item can move through execution, code review, and QA.',
          acceptance_criteria: ['The execution supervision API is item scoped.'],
          in_scope: ['Execution supervision API tests'],
        },
      })
      .expect(201)
  ).body;

  const seeded = await seedItemScopedSpecPlan(app, workItem.id, {
    actorId: executionActorOwner,
    reviewerActorId: executionActorReviewer,
    itemReviewerActorId: executionActorReviewer,
  });
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const runtime = app.get(ControlPlaneRuntimeService);
  const now = runtime.now();
  const executionPlan: ExecutionPlanDocument = {
    id: runtime.id('execution-plan'),
    development_plan_item_id: seeded.item.id,
    status: 'approved',
    current_revision_id: runtime.id('execution-plan-revision'),
    approved_revision_id: undefined,
    approved_by_actor_id: executionActorReviewer,
    approved_at: now,
    created_at: now,
    updated_at: now,
  };
  const executionPlanRevision: ExecutionPlanRevision = {
    id: executionPlan.current_revision_id!,
    execution_plan_id: executionPlan.id,
    development_plan_item_id: seeded.item.id,
    based_on_spec_revision_id: seeded.specRevision.id,
    revision_number: 1,
    summary: options.executionPlanRevisionSummary ?? 'Execute item-scoped supervision work',
    content: options.executionPlanRevisionContent ?? 'Implement the approved item supervision plan.',
    ...(options.executionPlanStructuredDocument === undefined ? {} : { structured_document: options.executionPlanStructuredDocument }),
    author_actor_id: executionActorOwner,
    created_at: now,
  };
  await repository.saveExecutionPlan({ ...executionPlan, approved_revision_id: executionPlanRevision.id });
  await repository.saveExecutionPlanRevision(executionPlanRevision);

  return {
    workItem: seeded.workItem,
    developmentPlan: seeded.developmentPlan,
    item: seeded.item,
    specRevision: seeded.specRevision,
    executionPlan: { ...executionPlan, approved_revision_id: executionPlanRevision.id },
    executionPlanRevision,
  };
}

export async function seedCompletedExecution(app: INestApplication): Promise<ApprovedExecutionPlanSeed & { execution: Execution }> {
  const seeded = await seedApprovedExecutionPlan(app);
  const started = (
    await request(app.getHttpServer())
      .post(`/development-plans/${seeded.developmentPlan.id}/items/${seeded.item.id}/execution/start`)
      .send({ actor_id: executionActorDeveloper })
      .expect(201)
  ).body as Execution;
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const runtime = app.get(ControlPlaneRuntimeService);
  const execution: Execution = { ...started, status: 'completed', updated_at: runtime.now() };
  await repository.saveExecution(execution);
  return { ...seeded, execution };
}
