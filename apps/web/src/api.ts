import { createForgeloopCommandApi } from './api/commands';
import { createForgeloopQueryApi } from './api/query';

export type * from './api/types';
export { ForgeloopApiError } from './api/common';
export type { ForgeloopApiOptions } from './api/common';
export { createForgeloopCommandApi } from './api/commands';
export type { ForgeloopCommandApi } from './api/commands';
export { createForgeloopQueryApi } from './api/query';
export type { ForgeloopQueryApi } from './api/query';

export const api = createForgeloopCommandApi();
export const queryApi = createForgeloopQueryApi();
