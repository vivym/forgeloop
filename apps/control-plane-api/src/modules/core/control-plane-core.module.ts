import { Module } from '@nestjs/common';
import { createDbClient, createDrizzleDeliveryRepository, InMemoryDeliveryRepository, type DeliveryRepository } from '@forgeloop/db';

import {
  DELIVERY_DEMO_ACTOR_ID_FALLBACK,
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
  type RunDurabilityMode,
} from './control-plane-tokens';
import { ControlPlaneRuntimeService } from './control-plane-runtime.service';

const createRepository = (): DeliveryRepository => {
  const databaseUrl = process.env.FORGELOOP_DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl.trim().length > 0) {
    return createDrizzleDeliveryRepository(createDbClient({ connectionString: databaseUrl }).db);
  }

  return new InMemoryDeliveryRepository();
};

const durabilityMode = (): RunDurabilityMode =>
  process.env.FORGELOOP_DATABASE_URL === undefined || process.env.FORGELOOP_DATABASE_URL.trim().length === 0
    ? 'volatile_demo'
    : 'durable';

@Module({
  providers: [
    { provide: DELIVERY_REPOSITORY, useFactory: createRepository },
    { provide: RUN_DURABILITY_MODE, useFactory: durabilityMode },
    {
      provide: DELIVERY_DEMO_ACTOR_ID_FALLBACK,
      useFactory: (mode: RunDurabilityMode) => mode === 'volatile_demo',
      inject: [RUN_DURABILITY_MODE],
    },
    ControlPlaneRuntimeService,
  ],
  exports: [DELIVERY_REPOSITORY, RUN_DURABILITY_MODE, DELIVERY_DEMO_ACTOR_ID_FALLBACK, ControlPlaneRuntimeService],
})
export class ControlPlaneCoreModule {}
