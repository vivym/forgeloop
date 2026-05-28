import { Module } from '@nestjs/common';
import { sealCodexLaunchTokenEnvelope } from '@forgeloop/codex-worker-runtime';
import {
  createDbClient,
  DrizzleDeliveryRepository,
  InMemoryDeliveryRepository,
  type CodexLaunchTokenEnvelopeSealer,
  type DeliveryRepository,
} from '@forgeloop/db';

import {
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
  type RunDurabilityMode,
} from './control-plane-tokens';
import { ControlPlaneRuntimeService } from './control-plane-runtime.service';
import { productArchitectureDemoSeedId, seedProductArchitectureDemoRepository } from './product-architecture-demo-seed';
import { RunExecutionRuntimeConfigService } from './run-execution-runtime-config.service';

const realCodexLaunchTokenEnvelopeSealer: CodexLaunchTokenEnvelopeSealer = {
  sealLaunchTokenEnvelope: sealCodexLaunchTokenEnvelope,
};

const codexLaunchTokenEnvelopeSealer = (env: NodeJS.ProcessEnv = process.env): CodexLaunchTokenEnvelopeSealer | undefined =>
  env.FORGELOOP_CODEX_NO_SHARED_FILESYSTEM === '1' ? realCodexLaunchTokenEnvelopeSealer : undefined;

export const createControlPlaneRepository = async (env: NodeJS.ProcessEnv = process.env): Promise<DeliveryRepository> => {
  const repositoryMode = env.FORGELOOP_REPOSITORY_MODE?.trim();
  const forceMemoryRepository = repositoryMode === 'memory';
  if (repositoryMode !== undefined && repositoryMode.length > 0 && repositoryMode !== 'memory') {
    throw new Error(`Unsupported FORGELOOP_REPOSITORY_MODE: ${repositoryMode}`);
  }

  const sealer = codexLaunchTokenEnvelopeSealer(env);
  const repositoryOptions = sealer === undefined ? {} : { codexLaunchTokenEnvelopeSealer: sealer };
  const databaseUrl = env.FORGELOOP_DATABASE_URL;
  if (!forceMemoryRepository && databaseUrl !== undefined && databaseUrl.trim().length > 0) {
    return new DrizzleDeliveryRepository(createDbClient({ connectionString: databaseUrl }).db, repositoryOptions);
  }

  const repository = new InMemoryDeliveryRepository(repositoryOptions);
  const seedId = env.FORGELOOP_DEMO_SEED_ID?.trim();
  if (seedId === productArchitectureDemoSeedId) {
    await seedProductArchitectureDemoRepository(repository);
  } else if (seedId !== undefined && seedId.length > 0) {
    throw new Error(`Unsupported FORGELOOP_DEMO_SEED_ID: ${seedId}`);
  }
  return repository;
};

const durabilityMode = (): RunDurabilityMode =>
  process.env.FORGELOOP_REPOSITORY_MODE === 'memory' ||
  process.env.FORGELOOP_DATABASE_URL === undefined ||
  process.env.FORGELOOP_DATABASE_URL.trim().length === 0
    ? 'volatile_demo'
    : 'durable';

@Module({
  providers: [
    { provide: DELIVERY_REPOSITORY, useFactory: createControlPlaneRepository },
    { provide: RUN_DURABILITY_MODE, useFactory: durabilityMode },
    ControlPlaneRuntimeService,
    RunExecutionRuntimeConfigService,
  ],
  exports: [DELIVERY_REPOSITORY, RUN_DURABILITY_MODE, ControlPlaneRuntimeService, RunExecutionRuntimeConfigService],
})
export class ControlPlaneCoreModule {}
