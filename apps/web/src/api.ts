import { createForgeloopCommandApi } from './shared/api/commands';
import { createForgeloopQueryApi } from './shared/api/query';

export type * from './shared/api/types';
export { ForgeloopApiError } from './shared/api/common';
export type { ForgeloopApiOptions } from './shared/api/common';
export { createForgeloopCommandApi } from './shared/api/commands';
export type { ForgeloopCommandApi } from './shared/api/commands';
export { createForgeloopQueryApi } from './shared/api/query';
export type { ForgeloopQueryApi } from './shared/api/query';

export const api = createForgeloopCommandApi();
export const queryApi = createForgeloopQueryApi();
