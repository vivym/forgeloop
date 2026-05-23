import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';
import type { Release, Task, WorkItem } from '../../packages/domain/src';

const now = '2026-05-23T00:00:00.000Z';
const later = '2026-05-23T00:01:00.000Z';

describe('project management query API', () => {
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

  it('returns role-aware My Work rows with concrete object types', async () => {
    await seedProjectManagementFixture(repository);

    const response = await request(app.getHttpServer())
      .get('/query/my-work')
      .query({ project_id: 'project-1', actor_id: 'actor-product' })
      .expect(200);

    expect(response.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ object_ref: { type: 'requirement', id: 'req-1' } }),
        expect.objectContaining({ object_ref: { type: 'task', id: 'task-1' } }),
        expect.objectContaining({ object_ref: { type: 'release', id: 'release-1' } }),
      ]),
    );
    expect(response.body.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ object_ref: { type: 'requirement', id: 'req-other' } }),
        expect.objectContaining({ object_ref: { type: 'task', id: 'task-other' } }),
        expect.objectContaining({ object_ref: { type: 'release', id: 'release-other' } }),
      ]),
    );
    expect(response.body.degraded_sources).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain('"type":"work_item"');
    expect(JSON.stringify(response.body)).not.toContain('owner_actor_id');
  });

  it('lists requirements, initiatives, tech debt, bugs, and tasks through typed endpoints', async () => {
    await seedProjectManagementFixture(repository);

    for (const route of ['/query/requirements', '/query/initiatives', '/query/tech-debt', '/query/bugs', '/query/tasks']) {
      await request(app.getHttpServer()).get(route).query({ project_id: 'project-1' }).expect(200);
    }
  });
});

async function seedProjectManagementFixture(repository: InMemoryDeliveryRepository): Promise<void> {
  for (const workItem of [
    workItemFixture('requirement', 'req-1', 'Checkout guard requirement', later),
    workItemFixture('requirement', 'req-other', 'Unrelated requirement', later, 'actor-other'),
    workItemFixture('initiative', 'init-1', 'Checkout reliability initiative', now),
    workItemFixture('tech_debt', 'td-1', 'Checkout validation debt', now),
    workItemFixture('bug', 'bug-1', 'Checkout regression', now),
  ]) {
    await repository.saveWorkItem(workItem);
  }
  await repository.saveTask(taskFixture('task-1'));
  await repository.saveTask(taskFixture('task-other', { parent_ref: { type: 'requirement', id: 'req-other' } }));
  await repository.saveRelease(releaseFixture('release-1'));
  await repository.saveRelease(releaseFixture('release-other', 'actor-other'));
}

function workItemFixture(
  kind: WorkItem['kind'],
  id: string,
  title: string,
  updatedAt: string,
  driverActorId = 'actor-product',
): WorkItem {
  return {
    id,
    project_id: 'project-1',
    kind,
    title,
    narrative_markdown: '',
    goal: 'Keep project management query fixtures typed.',
    success_criteria: ['The query API emits concrete product refs.'],
    priority: kind === 'bug' ? 'critical' : 'P1',
    risk: kind === 'bug' ? 'high' : 'medium',
    driver_actor_id: driverActorId,
    intake_context: intakeContextFor(kind),
    phase: 'draft',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    created_at: now,
    updated_at: updatedAt,
  };
}

function intakeContextFor(kind: WorkItem['kind']): WorkItem['intake_context'] {
  if (kind === 'initiative') {
    return {
      type: 'initiative',
      business_outcome: 'Reduce coordination misses.',
      scope_narrative: 'Group checkout reliability work.',
      success_metrics: ['Typed query rows render.'],
    };
  }
  if (kind === 'bug') {
    return {
      type: 'bug',
      impact_summary: 'Checkout users can bypass validation.',
      observed_behavior: 'Validation does not block bad input.',
      expected_behavior: 'Validation blocks bad input.',
      reproduction_steps: ['Submit invalid checkout data'],
      affected_environment: 'control-plane API',
      verification_path: 'API test',
    };
  }
  if (kind === 'tech_debt') {
    return {
      type: 'tech_debt',
      current_pain: 'Validation logic is duplicated.',
      desired_invariant: 'Validation has one source of truth.',
      affected_modules: ['apps/control-plane-api'],
      behavior_preservation: 'Existing checkout behavior remains intact.',
      validation_strategy: 'Focused API tests',
    };
  }
  return {
    type: 'requirement',
    stakeholder_problem: 'Checkout needs stronger validation.',
    desired_outcome: 'Invalid checkout data is blocked.',
    acceptance_criteria: ['Invalid payloads fail validation.'],
    in_scope: ['Checkout guard'],
  };
}

function taskFixture(id: string, overrides: Partial<Task> = {}): Task {
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
    updated_at: later,
    ...overrides,
  };
}

function releaseFixture(id: string, releaseOwnerActorId = 'actor-product'): Release {
  return {
    id,
    org_id: 'org-1',
    project_id: 'project-1',
    title: 'Checkout release',
    phase: 'planning',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    work_item_ids: ['req-1'],
    execution_package_ids: [],
    created_by_actor_id: 'actor-product',
    release_owner_actor_id: releaseOwnerActorId,
    created_at: now,
    updated_at: now,
  };
}
