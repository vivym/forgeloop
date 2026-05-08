import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  RUN_DURABILITY_MODE,
  RUN_WORKER,
} from '../../apps/control-plane-api/src/p0/p0.service';
import { InMemoryP0Repository } from '../../packages/db/src';

describe('durable P0 object IDs', () => {
  const apps: INestApplication[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  const createDurableApp = async (repository: InMemoryP0Repository): Promise<INestApplication> => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(P0_REPOSITORY)
      .useValue(repository)
      .overrideProvider(RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .overrideProvider(RUN_DURABILITY_MODE)
      .useValue('durable')
      .overrideProvider(P0_DEMO_ACTOR_ID_FALLBACK)
      .useValue(false)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    apps.push(app);
    return app;
  };

  it('does not reuse deterministic IDs after a durable app restart', async () => {
    const repository = new InMemoryP0Repository();
    const firstApp = await createDurableApp(repository);
    const firstProject = (
      await request(firstApp.getHttpServer())
        .post('/projects')
        .send({ name: 'First durable app', owner_actor_id: 'actor-owner' })
        .expect(201)
    ).body as { id: string };

    await firstApp.close();
    apps.splice(apps.indexOf(firstApp), 1);

    const secondApp = await createDurableApp(repository);
    const secondProject = (
      await request(secondApp.getHttpServer())
        .post('/projects')
        .send({ name: 'Second durable app', owner_actor_id: 'actor-owner' })
        .expect(201)
    ).body as { id: string };

    expect(secondProject.id).not.toBe(firstProject.id);
  });
});
