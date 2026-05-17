import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';

describe('delivery route contract', () => {
  it('does not register old public automation routes', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ rawBody: true });

    await app.init();

    await request(app.getHttpServer()).get('/p0/projects/project-1/automation/capabilities').expect(404);
    await request(app.getHttpServer()).post('/p0/manual-path-holds').send({}).expect(404);

    await app.close();
    await moduleRef.close();
  });
});
