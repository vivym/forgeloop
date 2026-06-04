import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
} from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import type { DeliveryRepository } from '../../packages/db/src';
import { seedReadyExecutionPackageThroughApi } from '../helpers/delivery-runtime-fixtures';

const actorOwner = 'actor-owner';
const actorHeaderName = 'X-Forgeloop-Actor-Id';

describe('async run API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('fails closed without creating a RunSession', async () => {
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    const response = await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackage.id}/run`)
      .set(actorHeaderName, actorOwner)
      .send({ workflow_only: true })
      .expect(409);

    expect(response.body).toMatchObject({
      code: 'workflow_legacy_entrypoint_disabled',
    });
    expect(response.body).not.toHaveProperty('run_session_id');
    expect(response.body).not.toHaveProperty('workflow_result');

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    expect(await repository.listRunSessionsForPackage(executionPackage.id)).toEqual([]);
  });

  it('rejects durable run requests that provide the deleted body actor field', async () => {
    await app.close();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .overrideProvider(RUN_DURABILITY_MODE)
      .useValue('durable')
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackage.id}/run`)
      .send({ requested_by_actor_id: 'actor-owner', workflow_only: true })
      .expect(400);
  });
});
