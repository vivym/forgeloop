import { describe, expect, it } from 'vitest';
import type { ObjectRef } from '@forgeloop/contracts';
import type { Actor, ExecutionPackage, Plan, PlanRevision, Project, Spec, SpecRevision, Task, WorkItem } from '@forgeloop/domain';

import {
  createDbClient,
  DrizzleDeliveryRepository,
  InMemoryDeliveryRepository,
  type DeliveryRepository,
  resetForgeloopDatabase,
} from '../../packages/db/src/index';

const now = '2026-05-23T00:00:00.000Z';
const later = '2026-05-23T00:05:00.000Z';

const ids = {
  project: '22222222-2222-4222-8222-222222222221',
  actor: '11111111-1111-4111-8111-111111111112',
  workItem: '33333333-3333-4333-8333-333333333331',
  spec: '44444444-4444-4444-8444-444444444441',
  specRevision: '44444444-4444-4444-8444-444444444442',
  plan: '55555555-5555-4555-8555-555555555551',
  planRevision: '55555555-5555-4555-8555-555555555552',
  package: '66666666-6666-4666-8666-666666666661',
  task: '77777777-7777-4777-8777-777777777771',
};

const actor: Actor = {
  id: ids.actor,
  display_name: 'Product Driver',
  actor_type: 'human',
  created_at: now,
  updated_at: now,
};

const project: Project = {
  id: ids.project,
  name: 'ForgeLoop',
  repo_ids: ['repo-1'],
  owner_actor_id: ids.actor,
  created_at: now,
  updated_at: now,
};

const requirementFixture: WorkItem = {
  id: ids.workItem,
  project_id: ids.project,
  kind: 'requirement',
  title: 'Implement checkout guard',
  narrative_markdown: '',
  goal: 'Add durable task foundation.',
  success_criteria: ['Task repository records round-trip.'],
  priority: 'p1',
  risk: 'medium',
  driver_actor_id: ids.actor,
  intake_context: {
    type: 'requirement',
    stakeholder_problem: 'Delivery needs task-scoped authoring.',
    desired_outcome: 'Tasks persist approved revision authority.',
    acceptance_criteria: ['Task foundation can link packages to tasks.'],
    in_scope: ['DB/domain foundation'],
  },
  phase: 'execution',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
  current_spec_id: ids.spec,
  current_spec_revision_id: ids.specRevision,
  current_plan_id: ids.plan,
  current_plan_revision_id: ids.planRevision,
  created_at: now,
  updated_at: now,
};

const spec: Spec = {
  id: ids.spec,
  work_item_id: ids.workItem,
  entity_type: 'spec',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: ids.specRevision,
  approved_revision_id: ids.specRevision,
  approved_at: now,
  approved_by_actor_id: ids.actor,
  created_at: now,
  updated_at: now,
};

const specRevision: SpecRevision = {
  id: ids.specRevision,
  spec_id: ids.spec,
  work_item_id: ids.workItem,
  revision_number: 1,
  summary: 'Approved spec',
  content: 'Spec content',
  background: 'Background',
  goals: ['Add tasks'],
  scope_in: ['Task table'],
  scope_out: ['Public routes'],
  acceptance_criteria: ['Task has approved revision authority'],
  risk_notes: ['No public legacy aliases'],
  test_strategy_summary: 'Repository tests',
  artifact_refs: [],
  created_at: now,
};

const plan: Plan = {
  id: ids.plan,
  work_item_id: ids.workItem,
  entity_type: 'plan',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: ids.planRevision,
  approved_revision_id: ids.planRevision,
  approved_at: now,
  approved_by_actor_id: ids.actor,
  created_at: now,
  updated_at: now,
};

const planRevision: PlanRevision = {
  id: ids.planRevision,
  plan_id: ids.plan,
  work_item_id: ids.workItem,
  based_on_spec_revision_id: ids.specRevision,
  revision_number: 1,
  summary: 'Approved plan',
  content: 'Plan content',
  implementation_summary: 'Add task persistence foundation.',
  split_strategy: 'Single DB/domain task.',
  dependency_order: [ids.package],
  test_matrix: ['pnpm vitest run tests/db/task-repository.test.ts'],
  risk_mitigations: ['Keep public routes untouched.'],
  rollback_notes: 'Revert Task 2 commit.',
  artifact_refs: [],
  created_at: now,
};

const taskFixture: Task = {
  id: ids.task,
  project_id: ids.project,
  title: 'Implement checkout guard',
  narrative_markdown: '',
  execution_brief: 'Add validation and tests.',
  acceptance_checklist: ['Validation rejects unsafe input'],
  status: 'ready',
  parent_ref: { type: 'requirement', id: ids.workItem },
  controlling_spec_revision_id: ids.specRevision,
  controlling_plan_revision_id: ids.planRevision,
  stale_state: 'current',
  created_at: now,
  updated_at: now,
};

const executionPackageFixture: ExecutionPackage = {
  id: ids.package,
  work_item_id: ids.workItem,
  spec_id: ids.spec,
  spec_revision_id: ids.specRevision,
  plan_id: ids.plan,
  plan_revision_id: ids.planRevision,
  project_id: ids.project,
  repo_id: 'repo-1',
  objective: 'Implement checkout guard.',
  owner_actor_id: ids.actor,
  reviewer_actor_id: ids.actor,
  qa_owner_actor_id: ids.actor,
  phase: 'ready',
  activity_state: 'idle',
  gate_state: 'not_submitted',
  resolution: 'none',
  required_checks: [],
  required_test_gates: [],
  required_artifact_kinds: [],
  allowed_paths: ['packages/db/**', 'packages/domain/**', 'tests/db/**'],
  forbidden_paths: ['apps/**'],
  source_mutation_policy: 'path_policy_scoped',
  version: 0,
  created_at: now,
  updated_at: now,
};

const isResettable = (databaseUrl: string) => /localhost|127\.0\.0\.1|forgeloop.*test|test.*forgeloop/i.test(databaseUrl);

async function seedProjectActorWorkItemSpecPlan(repository: DeliveryRepository): Promise<void> {
  await repository.saveActor(actor);
  await repository.saveProject(project);
  await repository.saveWorkItem(requirementFixture);
  await repository.saveSpec(spec);
  await repository.saveSpecRevision(specRevision);
  await repository.savePlan(plan);
  await repository.savePlanRevision(planRevision);
}

function runTaskRepositoryExamples(name: string, createRepository: () => DeliveryRepository): void {
  describe(name, () => {
    it('saves and reads first-class Tasks with approved revision authority', async () => {
      const repository = createRepository();
      await seedProjectActorWorkItemSpecPlan(repository);

      await repository.saveTask(taskFixture);

      expect(await repository.getTask(ids.task)).toMatchObject({
        id: ids.task,
        parent_ref: { type: 'requirement', id: ids.workItem },
        controlling_spec_revision_id: ids.specRevision,
        controlling_plan_revision_id: ids.planRevision,
        stale_state: 'current',
      });
      expect(await repository.listTasks(ids.project)).toEqual([taskFixture]);
      expect(await repository.listTasksForParent({ type: 'requirement', id: ids.workItem })).toEqual([taskFixture]);
    });

    it('matches task parent refs by object identity when display metadata differs', async () => {
      const repository = createRepository();
      await seedProjectActorWorkItemSpecPlan(repository);
      const taskWithTitledParent: Task = {
        ...taskFixture,
        parent_ref: { type: 'requirement', id: ids.workItem, title: 'Checkout guard requirement' },
      };

      await repository.saveTask(taskWithTitledParent);

      expect(await repository.listTasksForParent({ type: 'requirement', id: ids.workItem })).toEqual([taskWithTitledParent]);
    });

    it('links execution packages to tasks without exposing package registries as product pages', async () => {
      const repository = createRepository();
      await seedProjectActorWorkItemSpecPlan(repository);
      await repository.saveTask(taskFixture);
      await repository.saveExecutionPackage(executionPackageFixture);

      await repository.linkExecutionPackageToTask({ task_id: ids.task, execution_package_id: ids.package });

      expect(await repository.getTaskForExecutionPackage(ids.package)).toMatchObject({ id: ids.task });
      expect(await repository.getExecutionPackage(ids.package)).toMatchObject({ task_id: ids.task });
    });

    it('persists narrative Markdown on storage-backed typed Work Items and Tasks', async () => {
      const repository = createRepository();
      await seedProjectActorWorkItemSpecPlan(repository);
      await repository.saveTask(taskFixture);

      await repository.updateWorkItemNarrative({
        work_item_id: ids.workItem,
        markdown: '# Requirement brief',
        updated_at: later,
      });
      await repository.updateTaskNarrative({
        task_id: ids.task,
        markdown: '# Task execution brief',
        updated_at: later,
      });

      expect(await repository.getWorkItem(ids.workItem)).toMatchObject({
        narrative_markdown: '# Requirement brief',
        updated_at: later,
      });
      expect(await repository.getTask(ids.task)).toMatchObject({
        narrative_markdown: '# Task execution brief',
        updated_at: later,
      });
    });
  });
}

runTaskRepositoryExamples('Task repository in-memory adapter', () => new InMemoryDeliveryRepository());

describe('Task repository Drizzle adapter contract', () => {
  const databaseUrl = process.env.FORGELOOP_TEST_DATABASE_URL ?? process.env.FORGELOOP_DATABASE_URL;

  if (databaseUrl === undefined) {
    it.skip('skips Task repository contract because no disposable database URL is configured', () => {});
  } else if (!isResettable(databaseUrl)) {
    it.skip('skips Task repository contract because configured database URL is not resettable', () => {});
  } else {
    it('satisfies the Task repository examples', async () => {
      await resetForgeloopDatabase(databaseUrl);
      const { db, pool } = createDbClient({ connectionString: databaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(db);
        await seedProjectActorWorkItemSpecPlan(repository);
        await repository.saveTask({
          ...taskFixture,
          parent_ref: { type: 'requirement', id: ids.workItem, title: 'Checkout guard requirement' },
        });
        await repository.saveExecutionPackage(executionPackageFixture);

        const parentRef: ObjectRef = { type: 'requirement', id: ids.workItem };
        expect(await repository.getTask(ids.task)).toMatchObject({ id: ids.task, parent_ref: parentRef });
        expect(await repository.listTasksForParent(parentRef)).toHaveLength(1);

        await repository.linkExecutionPackageToTask({ task_id: ids.task, execution_package_id: ids.package });
        expect(await repository.getTaskForExecutionPackage(ids.package)).toMatchObject({ id: ids.task });
      } finally {
        await pool.end();
      }
    });
  }
});

describe('Task repository Drizzle adapter missing task guard', () => {
  it('rejects linking an execution package to a nonexistent task before updating the package', async () => {
    let updateCalled = false;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
      update: () => {
        updateCalled = true;
        return {
          set: () => ({
            where: () => ({
              returning: async () => [{ id: ids.package }],
            }),
          }),
        };
      },
    };
    const repository = new DrizzleDeliveryRepository(db as never);

    await expect(
      repository.linkExecutionPackageToTask({
        task_id: '77777777-7777-4777-8777-777777777779',
        execution_package_id: ids.package,
      }),
    ).rejects.toThrow('Task 77777777-7777-4777-8777-777777777779 was not found');
    expect(updateCalled).toBe(false);
  });
});
