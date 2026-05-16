import type { RunRuntimeMetadata } from '@forgeloop/domain';

export type RunDurabilityMode = RunRuntimeMetadata['durability_mode'];

export const P0_REPOSITORY = Symbol('P0_REPOSITORY');
export const RUN_DURABILITY_MODE = Symbol('RUN_DURABILITY_MODE');
export const P0_DEMO_ACTOR_ID_FALLBACK = Symbol('P0_DEMO_ACTOR_ID_FALLBACK');
