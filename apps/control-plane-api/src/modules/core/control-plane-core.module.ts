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
import { RunExecutionRuntimeConfigService } from './run-execution-runtime-config.service';

const realCodexLaunchTokenEnvelopeSealer: CodexLaunchTokenEnvelopeSealer = {
  sealLaunchTokenEnvelope: sealCodexLaunchTokenEnvelope,
};

const codexLaunchTokenEnvelopeSealer = (): CodexLaunchTokenEnvelopeSealer | undefined =>
  process.env.FORGELOOP_CODEX_NO_SHARED_FILESYSTEM === '1' ? realCodexLaunchTokenEnvelopeSealer : undefined;

const createRepository = (): DeliveryRepository => {
  const sealer = codexLaunchTokenEnvelopeSealer();
  const repositoryOptions = sealer === undefined ? {} : { codexLaunchTokenEnvelopeSealer: sealer };
  const databaseUrl = process.env.FORGELOOP_DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl.trim().length > 0) {
    return new DrizzleDeliveryRepository(createDbClient({ connectionString: databaseUrl }).db, repositoryOptions);
  }

  return new InMemoryDeliveryRepository(repositoryOptions);
};

const durabilityMode = (): RunDurabilityMode =>
  process.env.FORGELOOP_DATABASE_URL === undefined || process.env.FORGELOOP_DATABASE_URL.trim().length === 0
    ? 'volatile_demo'
    : 'durable';

@Module({
  providers: [
    { provide: DELIVERY_REPOSITORY, useFactory: createRepository },
    { provide: RUN_DURABILITY_MODE, useFactory: durabilityMode },
    ControlPlaneRuntimeService,
    RunExecutionRuntimeConfigService,
  ],
  exports: [DELIVERY_REPOSITORY, RUN_DURABILITY_MODE, ControlPlaneRuntimeService, RunExecutionRuntimeConfigService],
})
export class ControlPlaneCoreModule {}
