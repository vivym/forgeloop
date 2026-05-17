import { createApiContext, type ForgeloopApiOptions } from './common';
import type {
  CockpitResponse,
  ReleaseCockpitResponse,
  RoleWorkbenchId,
  RoleWorkbenchQuery,
  RoleWorkbenchResponse,
  TimelineEntry,
} from './types';

const queryString = (params: RoleWorkbenchQuery = {}) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number') {
      searchParams.set(key, String(value));
    }
  }
  const encoded = searchParams.toString();
  return encoded ? `?${encoded}` : '';
};

export function createForgeloopQueryApi(options: ForgeloopApiOptions = {}) {
  const { request } = createApiContext(options);

  return {
    getRoleWorkbench: (workbenchId: RoleWorkbenchId, query: RoleWorkbenchQuery = {}) =>
      request<RoleWorkbenchResponse>(`/query/workbenches/${encodeURIComponent(workbenchId)}${queryString(query)}`),
    getWorkItemCockpit: (workItemId: string) =>
      request<CockpitResponse>(`/query/work-item-cockpit/${encodeURIComponent(workItemId)}`),
    getWorkItemReplay: (workItemId: string) =>
      request<TimelineEntry[]>(`/query/replay/work_item/${encodeURIComponent(workItemId)}`),
    getReleaseCockpit: (releaseId: string) =>
      request<ReleaseCockpitResponse>(`/query/release-cockpit/${encodeURIComponent(releaseId)}`),
    getReleaseReplay: (releaseId: string) =>
      request<TimelineEntry[]>(`/query/replay/release/${encodeURIComponent(releaseId)}`),
  };
}

export type ForgeloopQueryApi = ReturnType<typeof createForgeloopQueryApi>;
