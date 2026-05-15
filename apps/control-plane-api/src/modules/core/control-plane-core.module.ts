import { Module } from '@nestjs/common';
import { createDbClient, createDrizzleP0Repository, InMemoryP0Repository, type P0Repository } from '@forgeloop/db';

import {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  RUN_DURABILITY_MODE,
  type RunDurabilityMode,
} from './control-plane-tokens';

const createRepository = (): P0Repository => {
  const databaseUrl = process.env.FORGELOOP_DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl.trim().length > 0) {
    return createDrizzleP0Repository(createDbClient({ connectionString: databaseUrl }).db);
  }

  return new InMemoryP0Repository();
};

const durabilityMode = (): RunDurabilityMode =>
  process.env.FORGELOOP_DATABASE_URL === undefined || process.env.FORGELOOP_DATABASE_URL.trim().length === 0
    ? 'volatile_demo'
    : 'durable';

@Module({
  providers: [
    { provide: P0_REPOSITORY, useFactory: createRepository },
    { provide: RUN_DURABILITY_MODE, useFactory: durabilityMode },
    {
      provide: P0_DEMO_ACTOR_ID_FALLBACK,
      useFactory: (mode: RunDurabilityMode) => mode === 'volatile_demo',
      inject: [RUN_DURABILITY_MODE],
    },
  ],
  exports: [P0_REPOSITORY, RUN_DURABILITY_MODE, P0_DEMO_ACTOR_ID_FALLBACK],
})
export class ControlPlaneCoreModule {}
