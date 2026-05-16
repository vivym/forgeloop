import type { RunRuntimeMetadata } from '@forgeloop/domain';

export type RunDurabilityMode = RunRuntimeMetadata['durability_mode'];

export const DELIVERY_REPOSITORY = Symbol('DELIVERY_REPOSITORY');
export const RUN_DURABILITY_MODE = Symbol('RUN_DURABILITY_MODE');
export const DELIVERY_DEMO_ACTOR_ID_FALLBACK = Symbol('DELIVERY_DEMO_ACTOR_ID_FALLBACK');
