import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { DeliveryRepository } from '../../packages/db/src';
import { seedApprovedExecutionPlan } from '../helpers/execution-supervision-fixtures';

describe('Task product API retirement', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('does not expose generic Task creation as a product API', async () => {
    const { workItem, developmentPlan } = await seedApprovedExecutionPlan(app);
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const approvedWorkItem = await repository.getWorkItem(workItem.id);
    if (approvedWorkItem?.current_spec_revision_id === undefined || approvedWorkItem.current_plan_revision_id === undefined) {
      throw new Error('Expected seeded work item to have legacy approved Spec and Plan revisions for route retirement test');
    }

    await request(app.getHttpServer())
      .post('/tasks')
      .send({
        project_id: developmentPlan.project_id,
        title: 'Legacy task',
        execution_brief: 'Should not be product-visible.',
        acceptance_checklist: ['The old Task route is not available.'],
        parent_ref: { type: workItem.kind, id: workItem.id },
        controlling_spec_revision_id: approvedWorkItem.current_spec_revision_id,
        controlling_plan_revision_id: approvedWorkItem.current_plan_revision_id,
      })
      .expect(404);
  });
});
