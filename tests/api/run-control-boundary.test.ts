import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';

describe('RunControl boundary', () => {
  it('provides the run worker through the delivery run-control token', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .compile();

    expect(moduleRef.get(DELIVERY_RUN_WORKER)).toBeDefined();
  });

  it('keeps run, rerun, and force-rerun package routes outside the old namespace', async () => {
    const routes = readFileSync('apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts', 'utf8');
    expect(routes).toContain("@Post('execution-packages/:packageId/run')");
    expect(routes).toContain("@Post('execution-packages/:packageId/rerun')");
    expect(routes).toContain("@Post('execution-packages/:packageId/force-rerun')");
    expect(routes).not.toContain("@Controller('p0");
  });
});
