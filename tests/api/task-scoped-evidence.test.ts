import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';
import type { ExecutionPackage, ReviewPacket, RunSession, Task, WorkItem } from '../../packages/domain/src';

const now = '2026-05-23T00:00:00.000Z';

describe('retired task-scoped evidence query API', () => {
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

  it('does not expose task-scoped package evidence as a product query route', async () => {
    await seedTaskPackageRunReview(repository, { task_id: 'task-1', package_id: 'pkg-1', run_id: 'run-1', review_id: 'review-1' });

    await request(app.getHttpServer()).get('/query/tasks/task-1/packages/pkg-1').expect(404);
    await request(app.getHttpServer()).get('/query/tasks/task-other/packages/pkg-1').expect(404);
  });

  it('does not expose task-scoped run or review evidence as product query routes', async () => {
    await seedTaskPackageRunReview(repository, { task_id: 'task-1', package_id: 'pkg-1', run_id: 'run-1', review_id: 'review-1' });

    await request(app.getHttpServer()).get('/query/tasks/task-1/runs/run-1').expect(404);
    await request(app.getHttpServer()).get('/query/tasks/task-other/runs/run-1').expect(404);
    await request(app.getHttpServer()).get('/query/tasks/task-1/reviews/review-1').expect(404);
    await request(app.getHttpServer()).get('/query/tasks/task-other/reviews/review-1').expect(404);
  });
});

async function seedTaskPackageRunReview(
  repository: InMemoryDeliveryRepository,
  ids: { task_id: string; package_id: string; run_id: string; review_id: string },
): Promise<void> {
  await repository.saveWorkItem(workItemFixture());
  await repository.saveTask(taskFixture(ids.task_id));
  await repository.saveExecutionPackage(packageFixture(ids.task_id, ids.package_id));
  await repository.saveRunSession(runFixture(ids.package_id, ids.run_id));
  await repository.saveReviewPacket(reviewFixture(ids.package_id, ids.run_id, ids.review_id));
}

function workItemFixture(): WorkItem {
  return {
    id: 'req-1',
    project_id: 'project-1',
    kind: 'requirement',
    title: 'Checkout guard requirement',
    narrative_markdown: '',
    goal: 'Block invalid checkout data.',
    success_criteria: ['Evidence is task scoped.'],
    priority: 'P1',
    risk: 'medium',
    driver_actor_id: 'actor-product',
    intake_context: {
      type: 'requirement',
      stakeholder_problem: 'Runtime evidence is hard to find.',
      desired_outcome: 'Evidence is reachable from the Task.',
      acceptance_criteria: ['Task evidence routes enforce scope.'],
      in_scope: ['Task evidence routes'],
    },
    phase: 'execution',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    created_at: now,
    updated_at: now,
  };
}

function taskFixture(id: string): Task {
  return {
    id,
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
  };
}

function packageFixture(taskId: string, packageId: string): ExecutionPackage {
  return {
    id: packageId,
    task_id: taskId,
    work_item_id: 'req-1',
    spec_id: 'spec-1',
    spec_revision_id: 'spec-rev-1',
    plan_id: 'plan-1',
    plan_revision_id: 'plan-rev-1',
    project_id: 'project-1',
    repo_id: 'repo-1',
    objective: 'Implement checkout guard.',
    owner_actor_id: 'actor-dev',
    reviewer_actor_id: 'actor-reviewer',
    qa_owner_actor_id: 'actor-qa',
    phase: 'review',
    activity_state: 'idle',
    gate_state: 'ready_for_review',
    resolution: 'none',
    required_checks: [],
    required_artifact_kinds: ['execution_summary'],
    allowed_paths: ['apps/control-plane-api/**'],
    forbidden_paths: [],
    source_mutation_policy: 'allow_list',
    version: 1,
    created_at: now,
    updated_at: now,
  };
}

function runFixture(packageId: string, runId: string): RunSession {
  return {
    id: runId,
    execution_package_id: packageId,
    requested_by_actor_id: 'actor-dev',
    status: 'succeeded',
    executor_type: 'mock',
    changed_files: [],
    check_results: [],
    artifacts: [],
    log_refs: [],
    created_at: now,
    updated_at: now,
  };
}

function reviewFixture(packageId: string, runId: string, reviewId: string): ReviewPacket {
  return {
    id: reviewId,
    run_session_id: runId,
    execution_package_id: packageId,
    reviewer_actor_id: 'actor-reviewer',
    spec_revision_id: 'spec-rev-1',
    plan_revision_id: 'plan-rev-1',
    status: 'completed',
    decision: 'approved',
    changed_files: [],
    check_result_summary: 'Checks passed.',
    self_review: {
      status: 'succeeded',
      summary: 'Implementation matches the task.',
      spec_plan_alignment: 'Aligned.',
      test_assessment: 'Passed.',
      risk_notes: [],
      follow_up_questions: [],
    },
    risk_notes: [],
    requested_changes: [],
    reviewed_by_actor_id: 'actor-reviewer',
    reviewed_at: now,
    created_at: now,
    updated_at: now,
    completed_at: now,
  };
}
