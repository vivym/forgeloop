import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { seedReadyExecutionPackageThroughApi } from '../helpers/p0-runtime-fixtures';

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

  it('returns immediately with run_session_id and no workflow_result', async () => {
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    const response = await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackage.id}/run`)
      .send({ requested_by_actor_id: 'actor-owner', workflow_only: true })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'accepted',
      run_session_id: expect.stringContaining('run-session'),
      execution_package_id: executionPackage.id,
    });
    expect(response.body).not.toHaveProperty('workflow_result');
  });
});
