import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { DeliveryRepository } from '@forgeloop/db';
import type {
  DevelopmentPlan,
  DevelopmentPlanItem,
  Execution,
  ExecutionPackage,
  ExecutionPlanDocument,
  ExecutionPlanRevision,
  SpecRevision,
  WorkItem,
} from '@forgeloop/domain';
import { transitionExecutionPackage } from '@forgeloop/domain';

import { ControlPlaneRuntimeService } from '../../apps/control-plane-api/src/modules/core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DEFAULT_SOURCE_MUTATION_POLICY, defaultPackagePolicyFields } from '../../apps/control-plane-api/src/modules/execution-packages/package-policy-fields';
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
  executionPackage?: ExecutionPackage;
};

export async function seedApprovedExecutionPlan(
  app: INestApplication,
  options: {
    executionPlanRevisionSummary?: string;
    executionPlanRevisionContent?: string;
    executionPlanStructuredDocument?: Record<string, unknown>;
    seedExecutionPackage?: boolean;
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
        success_criteria: ['Execution starts only from an approved item Implementation Plan Doc.'],
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: executionActorOwner,
        intake_context: {
          type: 'requirement',
          stakeholder_problem: 'AI execution needs a product-level supervision loop.',
          desired_outcome: 'A Development Plan Item can move through execution, code review, and QA.',
          acceptance_criteria: ['The execution supervision API is item scoped.'],
          in_scope: ['Execution supervision API tests'],
          out_of_scope: ['Top-level Task routes'],
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
  const executionPackage =
    options.seedExecutionPackage === false
      ? undefined
      : await seedRunnableExecutionPackage(repository, runtime, {
          workItem: seeded.workItem,
          developmentPlan: seeded.developmentPlan,
          item: seeded.item,
          specRevision: seeded.specRevision,
          executionPlan: { ...executionPlan, approved_revision_id: executionPlanRevision.id },
          executionPlanRevision,
          options,
        });

  return {
    workItem: seeded.workItem,
    developmentPlan: seeded.developmentPlan,
    item: seeded.item,
    specRevision: seeded.specRevision,
    executionPlan: { ...executionPlan, approved_revision_id: executionPlanRevision.id },
    executionPlanRevision,
    ...(executionPackage === undefined ? {} : { executionPackage }),
  };
}

async function seedRunnableExecutionPackage(
  repository: DeliveryRepository,
  runtime: ControlPlaneRuntimeService,
  context: Pick<ApprovedExecutionPlanSeed, 'workItem' | 'developmentPlan' | 'item' | 'specRevision' | 'executionPlan' | 'executionPlanRevision'> & {
    options: {
      executionPlanRevisionSummary?: string;
      executionPlanRevisionContent?: string;
      executionPlanStructuredDocument?: Record<string, unknown>;
    };
  },
): Promise<ExecutionPackage> {
  const project = await repository.getProject(context.developmentPlan.project_id);
  if (project === undefined) throw new Error(`Project ${context.developmentPlan.project_id} not found`);
  const repo = (await repository.listProjectRepos(project.id))[0];
  if (repo === undefined) throw new Error(`Project ${project.id} has no repo`);
  const at = runtime.now();
  const structuredDocument = context.options.executionPlanStructuredDocument;
  const structuredRequiredChecks = Array.isArray(structuredDocument?.required_checks)
    ? (structuredDocument.required_checks as ExecutionPackage['required_checks']).map((check) => ({
        ...check,
        display_name: check.display_name ?? check.check_id,
      }))
    : undefined;
  const structuredAllowedPaths = Array.isArray(structuredDocument?.allowed_paths)
    ? (structuredDocument.allowed_paths.filter((entry) => typeof entry === 'string' && entry.trim().length > 0) as string[])
    : undefined;
  const structuredForbiddenPaths = Array.isArray(structuredDocument?.forbidden_paths)
    ? (structuredDocument.forbidden_paths.filter((entry) => typeof entry === 'string' && entry.trim().length > 0) as string[])
    : undefined;
  const requiredChecks = structuredRequiredChecks ?? [
    {
      check_id: 'focused',
      display_name: 'Focused verification',
      command: 'pnpm test',
      timeout_seconds: 120,
      blocks_review: true,
    },
  ];
  const allowedPaths = structuredAllowedPaths ?? ['apps/control-plane-api/**', 'apps/web/**', 'packages/domain/**', 'packages/contracts/**', 'tests/**'];
  const forbiddenPaths = structuredForbiddenPaths ?? ['packages/db/**'];
  const packagePolicyFields = await defaultPackagePolicyFields(repository, {
    projectId: project.id,
    repoId: repo.repo_id,
    loadedAt: at,
    requiredChecks,
    allowedPaths,
    forbiddenPaths,
    sourceMutationPolicy: DEFAULT_SOURCE_MUTATION_POLICY,
  });
  const executionPackage: ExecutionPackage = {
    ...transitionExecutionPackage(undefined, {
      type: 'generate_package',
      id: runtime.id('execution-package'),
      work_item_id: context.workItem.id,
      spec_id: context.specRevision.spec_id,
      spec_revision_id: context.specRevision.id,
      plan_id: context.executionPlan.id,
      plan_revision_id: context.executionPlanRevision.id,
      project_id: project.id,
      repo_id: repo.repo_id,
      objective:
        context.executionPlanRevision.summary.trim().length > 0
          ? context.executionPlanRevision.summary
          : `Execute ${context.item.title}.`,
      owner_actor_id: executionActorDeveloper,
      reviewer_actor_id: context.item.reviewer_actor_id ?? executionActorReviewer,
      qa_owner_actor_id: executionActorQa,
      required_checks: requiredChecks,
      required_artifact_kinds: ['execution_summary'],
      allowed_paths: allowedPaths,
      forbidden_paths: forbiddenPaths,
      source_mutation_policy: DEFAULT_SOURCE_MUTATION_POLICY,
      at,
    }),
    development_plan_item_id: context.item.id,
    execution_plan_id: context.executionPlan.id,
    execution_plan_revision_id: context.executionPlanRevision.id,
    execution_package_set_id: `item-execution:${context.item.id}:${context.executionPlanRevision.id}`,
    generation_key: 'item-execution',
    package_key: 'default-runtime-package',
    sequence: 0,
    manifest_digest: `execution-plan-revision:${context.executionPlanRevision.id}`,
    phase: 'ready',
    activity_state: 'idle',
    gate_state: 'not_submitted',
    required_test_gates: [{ gate_id: 'qa-strategy', summary: 'Accepted Spec test strategy' }],
    ...packagePolicyFields,
  };
  await repository.saveExecutionPackage(executionPackage);
  return executionPackage;
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
