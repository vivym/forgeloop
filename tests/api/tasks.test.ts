import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';
import type { Plan, PlanRevision, Project, ProjectRepo, Spec, SpecRevision, Task, WorkItem } from '../../packages/domain/src';
import { createWorkflowPolicyRepoRoot } from '../helpers/runtime-policy-repo';

const now = '2026-05-23T00:00:00.000Z';

describe('Task authority API', () => {
  let app: INestApplication;
  let repository: InMemoryDeliveryRepository;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a Task as first-class developer work, not as a Work Item kind', async () => {
    await seedApprovedParent(repository);

    const response = await request(app.getHttpServer())
      .post('/tasks')
      .send({
        project_id: 'project-1',
        title: 'Implement checkout guard',
        execution_brief: 'Add validation and route tests.',
        acceptance_checklist: ['Route test passes'],
        parent_ref: { type: 'requirement', id: 'req-1' },
        controlling_spec_revision_id: 'spec-rev-1',
        controlling_plan_revision_id: 'plan-rev-1',
      })
      .expect(201);

    expect(response.body).toMatchObject({ object_ref: { type: 'task' }, stale_state: 'current' });
    expect(JSON.stringify(response.body)).not.toContain('"type":"work_item"');
    expect(JSON.stringify(response.body)).not.toContain('work_item_kind');
  });

  it('rejects parent refs from a different project', async () => {
    await seedApprovedParent(repository);
    await repository.saveProject(projectFixture({ id: 'project-2', name: 'Other project' }));
    await repository.saveWorkItem(requirementFixture({ id: 'req-2', project_id: 'project-2' }));

    await request(app.getHttpServer())
      .post('/tasks')
      .send({
        project_id: 'project-1',
        title: 'Implement scoped checkout guard',
        execution_brief: 'Reject cross-project task parents.',
        acceptance_checklist: ['Cross-project parent refs are rejected'],
        parent_ref: { type: 'requirement', id: 'req-2' },
        controlling_spec_revision_id: 'spec-rev-1',
        controlling_plan_revision_id: 'plan-rev-1',
      })
      .expect(400);
  });

  it('rejects controlling revisions from a different project', async () => {
    await seedApprovedParent(repository);
    await seedApprovedParent(repository, {
      project: projectFixture({ id: 'project-2', name: 'Other project' }),
      projectRepo: await projectRepoFixture({ id: 'project-repo-2', project_id: 'project-2', repo_id: 'repo-2' }),
      workItem: requirementFixture({ id: 'req-2', project_id: 'project-2' }),
      spec: specFixture({ id: 'spec-2', work_item_id: 'req-2', current_revision_id: 'spec-rev-2', approved_revision_id: 'spec-rev-2' }),
      specRevision: specRevisionFixture({ id: 'spec-rev-2', spec_id: 'spec-2', work_item_id: 'req-2' }),
      plan: planFixture({ id: 'plan-2', work_item_id: 'req-2', current_revision_id: 'plan-rev-2', approved_revision_id: 'plan-rev-2' }),
      planRevision: planRevisionFixture({
        id: 'plan-rev-2',
        plan_id: 'plan-2',
        work_item_id: 'req-2',
        based_on_spec_revision_id: 'spec-rev-2',
      }),
    });

    await request(app.getHttpServer())
      .post('/tasks')
      .send({
        project_id: 'project-1',
        title: 'Implement scoped authority guard',
        execution_brief: 'Reject cross-project revision authority.',
        acceptance_checklist: ['Cross-project revisions are rejected'],
        controlling_spec_revision_id: 'spec-rev-2',
        controlling_plan_revision_id: 'plan-rev-2',
      })
      .expect(400);
  });

  it('marks independent Tasks stale when their Spec authority is not current approved', async () => {
    await seedApprovedParent(repository);
    await repository.saveSpecRevision(specRevisionFixture({ id: 'spec-rev-old', revision_number: 0 }));

    const response = await request(app.getHttpServer())
      .post('/tasks')
      .send({
        project_id: 'project-1',
        title: 'Implement stale checkout guard',
        execution_brief: 'Use an old spec revision.',
        acceptance_checklist: ['Stale authority is blocked'],
        controlling_spec_revision_id: 'spec-rev-old',
        controlling_plan_revision_id: 'plan-rev-1',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      object_ref: { type: 'task' },
      stale_state: 'stale_spec',
      package_generation_eligible: false,
    });
  });

  it('blocks package generation when Task Spec authority does not match the approved Plan authority', async () => {
    await seedTask(repository, {
      id: 'task-mismatched-authority',
      parent_ref: undefined,
      controlling_spec_revision_id: 'spec-rev-other',
      controlling_plan_revision_id: 'plan-rev-1',
      stale_state: 'current',
    });
    await repository.saveSpecRevision(specRevisionFixture({ id: 'spec-rev-other', revision_number: 2 }));

    await request(app.getHttpServer())
      .post('/tasks/task-mismatched-authority/packages')
      .send({ actor_id: 'actor-dev' })
      .expect(409);
  });

  it('rejects package generation for manual_exception tasks', async () => {
    await seedManualExceptionTask(repository, 'task-manual');

    await request(app.getHttpServer()).post('/tasks/task-manual/packages').send({ actor_id: 'actor-dev' }).expect(409);
  });

  it('does not relink an existing generated package from another current Task', async () => {
    await seedTask(repository, { id: 'task-first' });
    await seedTask(repository, { id: 'task-second' });

    const firstResponse = await request(app.getHttpServer())
      .post('/tasks/task-first/packages')
      .send({ actor_id: 'actor-dev' })
      .expect(201);
    const packageId = firstResponse.body.package_ref.id;

    await request(app.getHttpServer()).post('/tasks/task-second/packages').send({ actor_id: 'actor-dev' }).expect(409);

    await request(app.getHttpServer()).get(`/query/tasks/task-first/packages/${packageId}`).expect(200);
    await request(app.getHttpServer()).get(`/query/tasks/task-second/packages/${packageId}`).expect(404);
  });

  it('persists Task narrative Markdown only after shared validation passes', async () => {
    await seedTask(repository, { id: 'task-1' });

    await request(app.getHttpServer())
      .patch('/tasks/task-1/narrative')
      .send({
        object_ref: { type: 'task', id: 'task-1' },
        markdown: 'Execution context with [package](/tasks/task-1/packages/pkg-1).',
        allowed_blocks: ['paragraph', 'link'],
        attachment_refs: [],
        validation_version: '2026-05-23',
      })
      .expect(200);

    const response = await request(app.getHttpServer()).get('/query/tasks/task-1').expect(200);
    expect(response.body.narrative_markdown).toContain('Execution context');
  });
});

async function seedApprovedParent(
  repository: InMemoryDeliveryRepository,
  overrides: {
    project?: Project;
    projectRepo?: ProjectRepo;
    workItem?: WorkItem;
    spec?: Spec;
    specRevision?: SpecRevision;
    plan?: Plan;
    planRevision?: PlanRevision;
  } = {},
): Promise<void> {
  await repository.saveProject(overrides.project ?? projectFixture());
  await repository.saveProjectRepo(overrides.projectRepo ?? (await projectRepoFixture()));
  await repository.saveWorkItem(overrides.workItem ?? requirementFixture());
  await repository.saveSpec(overrides.spec ?? specFixture());
  await repository.saveSpecRevision(overrides.specRevision ?? specRevisionFixture());
  await repository.savePlan(overrides.plan ?? planFixture());
  await repository.savePlanRevision(overrides.planRevision ?? planRevisionFixture());
}

async function seedTask(repository: InMemoryDeliveryRepository, overrides: Partial<Task> = {}): Promise<Task> {
  await seedApprovedParent(repository);
  const task: Task = {
    id: 'task-1',
    project_id: 'project-1',
    title: 'Implement checkout guard',
    narrative_markdown: '',
    execution_brief: 'Add validation and route tests.',
    acceptance_checklist: ['Route test passes'],
    status: 'ready',
    parent_ref: { type: 'requirement', id: 'req-1' },
    controlling_spec_revision_id: 'spec-rev-1',
    controlling_plan_revision_id: 'plan-rev-1',
    stale_state: 'current',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  await repository.saveTask(task);
  return task;
}

async function seedManualExceptionTask(repository: InMemoryDeliveryRepository, id: string): Promise<void> {
  await seedTask(repository, {
    id,
    stale_state: 'manual_exception',
    audited_exception: {
      exception_id: 'exception-1',
      actor_id: 'actor-dev',
      reason: 'Emergency manual follow-up before normal approval.',
      risk: 'high',
      rollback_plan: 'Revert the manual change.',
      verification_ref: { type: 'audited_exception_decision', id: 'decision-1' },
      supporting_attachment_refs: [],
      release_impact: 'release_scoped',
      created_at: now,
    },
  });
}

function projectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Forgeloop',
    repo_ids: ['repo-1'],
    owner_actor_id: 'actor-product',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

async function projectRepoFixture(overrides: Partial<ProjectRepo> = {}): Promise<ProjectRepo> {
  return {
    id: 'project-repo-1',
    project_id: 'project-1',
    repo_id: 'repo-1',
    name: 'forgeloop',
    status: 'active',
    local_path: await createWorkflowPolicyRepoRoot(),
    default_branch: 'main',
    base_commit_sha: 'abc123',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function requirementFixture(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'req-1',
    project_id: 'project-1',
    kind: 'requirement',
    title: 'Checkout guard requirement',
    narrative_markdown: '',
    goal: 'Block invalid checkout data.',
    success_criteria: ['Route validation test passes.'],
    priority: 'P1',
    risk: 'medium',
    driver_actor_id: 'actor-product',
    intake_context: {
      type: 'requirement',
      stakeholder_problem: 'Invalid checkout data reaches execution.',
      desired_outcome: 'Checkout data is validated.',
      acceptance_criteria: ['Invalid payloads fail.'],
      in_scope: ['Checkout guard'],
    },
    phase: 'execution',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    current_spec_id: 'spec-1',
    current_spec_revision_id: 'spec-rev-1',
    current_plan_id: 'plan-1',
    current_plan_revision_id: 'plan-rev-1',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function specFixture(overrides: Partial<Spec> = {}): Spec {
  return {
    id: 'spec-1',
    work_item_id: 'req-1',
    entity_type: 'spec',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: 'spec-rev-1',
    approved_revision_id: 'spec-rev-1',
    approved_at: now,
    approved_by_actor_id: 'actor-reviewer',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function specRevisionFixture(overrides: Partial<SpecRevision> = {}): SpecRevision {
  return {
    id: 'spec-rev-1',
    spec_id: 'spec-1',
    work_item_id: 'req-1',
    revision_number: 1,
    summary: 'Checkout guard spec',
    content: 'Validate checkout data.',
    background: 'Invalid data reaches execution.',
    goals: ['Block invalid input'],
    scope_in: ['API validation'],
    scope_out: ['Web IA'],
    acceptance_criteria: ['Invalid payloads fail'],
    risk_notes: ['Keep scope narrow'],
    test_strategy_summary: 'API tests',
    artifact_refs: [],
    author_actor_id: 'actor-product',
    created_at: now,
    ...overrides,
  };
}

function planFixture(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    work_item_id: 'req-1',
    entity_type: 'plan',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: 'plan-rev-1',
    approved_revision_id: 'plan-rev-1',
    approved_at: now,
    approved_by_actor_id: 'actor-reviewer',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function planRevisionFixture(overrides: Partial<PlanRevision> = {}): PlanRevision {
  return {
    id: 'plan-rev-1',
    plan_id: 'plan-1',
    work_item_id: 'req-1',
    based_on_spec_revision_id: 'spec-rev-1',
    revision_number: 1,
    summary: 'Checkout guard plan',
    content: 'Implement the guard.',
    implementation_summary: 'Add validation and tests.',
    split_strategy: 'Single API change.',
    dependency_order: ['validation'],
    test_matrix: ['pnpm vitest run tests/api/tasks.test.ts'],
    risk_mitigations: ['Use existing validation pipe'],
    rollback_notes: 'Revert the guard.',
    artifact_refs: [],
    author_actor_id: 'actor-product',
    created_at: now,
    ...overrides,
  };
}
