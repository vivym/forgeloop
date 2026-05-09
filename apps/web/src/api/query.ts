import { createApiContext, type ForgeloopApiOptions } from './common';
import type { CockpitResponse, TimelineEntry } from './types';

export function createForgeloopQueryApi(options: ForgeloopApiOptions = {}) {
  const { request } = createApiContext(options);

  return {
    getWorkItemCockpit: (workItemId: string) =>
      request<CockpitResponse>(`/query/work-item-cockpit/${encodeURIComponent(workItemId)}`),
    getWorkItemReplay: (workItemId: string) =>
      request<TimelineEntry[]>(`/query/replay/work_item/${encodeURIComponent(workItemId)}`),
  };
}

export type ForgeloopQueryApi = ReturnType<typeof createForgeloopQueryApi>;
