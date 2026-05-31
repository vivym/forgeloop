import { Module } from '@nestjs/common';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  INTERNAL_ARTIFACT_STORE_ROOT,
  RUN_DURABILITY_MODE,
  type RunDurabilityMode,
} from './control-plane-tokens';
import { ControlPlaneRuntimeService } from './control-plane-runtime.service';
import { productWorkspacePreviewSeedId, seedProductWorkspacePreviewRepository } from './product-workspace-preview-seed';
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
  const seedId = env.FORGELOOP_PREVIEW_SEED_ID?.trim();
  if (seedId === productWorkspacePreviewSeedId) {
    await seedProductWorkspacePreviewRepository(repository);
  } else if (seedId !== undefined && seedId.length > 0) {
    throw new Error(`Unsupported FORGELOOP_PREVIEW_SEED_ID: ${seedId}`);
  }
  return repository;
};

const durabilityMode = (): RunDurabilityMode =>
  process.env.FORGELOOP_REPOSITORY_MODE === 'memory' ||
  process.env.FORGELOOP_DATABASE_URL === undefined ||
  process.env.FORGELOOP_DATABASE_URL.trim().length === 0
    ? 'volatile_demo'
    : 'durable';

const internalArtifactStoreRoot = (): string => {
  const configuredRoot = process.env.FORGELOOP_ARTIFACT_STORE_ROOT?.trim();
  if (configuredRoot !== undefined && configuredRoot.length > 0) {
    return configuredRoot;
  }
  if (durabilityMode() === 'volatile_demo') {
    return mkdtempSync(join(tmpdir(), 'forgeloop-internal-artifacts-'));
  }
  throw new Error('FORGELOOP_ARTIFACT_STORE_ROOT is required when the control plane uses durable runtime state');
};

@Module({
  providers: [
    { provide: DELIVERY_REPOSITORY, useFactory: createControlPlaneRepository },
    { provide: RUN_DURABILITY_MODE, useFactory: durabilityMode },
    { provide: INTERNAL_ARTIFACT_STORE_ROOT, useFactory: internalArtifactStoreRoot },
    ControlPlaneRuntimeService,
    RunExecutionRuntimeConfigService,
  ],
  exports: [
    DELIVERY_REPOSITORY,
    RUN_DURABILITY_MODE,
    INTERNAL_ARTIFACT_STORE_ROOT,
    ControlPlaneRuntimeService,
    RunExecutionRuntimeConfigService,
  ],
})
export class ControlPlaneCoreModule {}
