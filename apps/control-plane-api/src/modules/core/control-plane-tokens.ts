import type { RunRuntimeMetadata } from '@forgeloop/domain';

export type RunDurabilityMode = RunRuntimeMetadata['durability_mode'];

export const DELIVERY_REPOSITORY = Symbol('DELIVERY_REPOSITORY');
export const RUN_DURABILITY_MODE = Symbol('RUN_DURABILITY_MODE');
export const INTERNAL_ARTIFACT_STORE_ROOT = Symbol('INTERNAL_ARTIFACT_STORE_ROOT');
