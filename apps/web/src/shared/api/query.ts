import { createApiContext, type ForgeloopApiOptions } from './common';
import type {
  CockpitResponse,
  ExecutionPackage,
  ProductListResponse,
  ReleaseCockpitResponse,
  ReleaseListResponse,
  ReviewPacket,
  RoleWorkbenchId,
  RoleWorkbenchQuery,
  RoleWorkbenchResponse,
  RunSession,
  TimelineEntry,
  WorkItem,
} from './types';

export interface ProjectQuery {
  project_id: string;
}

const queryString = (params: object = {}) => {
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

  const productMethods = {
    getPipeline: (query: ProjectQuery) => request<WorkItem[]>(`/query/pipeline${queryString(query)}`),
    listSpecs: (query: ProjectQuery) => request<ProductListResponse>(`/query/specs${queryString(query)}`),
    listPlans: (query: ProjectQuery) => request<ProductListResponse>(`/query/plans${queryString(query)}`),
    listPackages: (query: ProjectQuery) => request<ExecutionPackage[]>(`/query/packages${queryString(query)}`),
    getPackage: (packageId: string) => request<ExecutionPackage>(`/query/packages/${encodeURIComponent(packageId)}`),
    listRuns: (query: ProjectQuery) => request<RunSession[]>(`/query/runs${queryString(query)}`),
    getRun: (runSessionId: string) => request<RunSession>(`/query/runs/${encodeURIComponent(runSessionId)}`),
    listReviews: (query: ProjectQuery) => request<ReviewPacket[]>(`/query/reviews${queryString(query)}`),
    getReview: (reviewPacketId: string) => request<ReviewPacket>(`/query/reviews/${encodeURIComponent(reviewPacketId)}`),
    listReleases: (query: ProjectQuery) => request<ReleaseListResponse>(`/query/releases${queryString(query)}`),
  };

  const api = {
    getRoleWorkbench: (workbenchId: RoleWorkbenchId, query: RoleWorkbenchQuery = {}) =>
      request<RoleWorkbenchResponse>(`/query/workbenches/${encodeURIComponent(workbenchId)}${queryString(query)}`),
    getWorkItemCockpit: (workItemId: string) =>
      request<CockpitResponse>(`/query/work-item-cockpit/${encodeURIComponent(workItemId)}`),
    getWorkItemReplay: (workItemId: string) =>
      request<TimelineEntry[]>(`/query/replay/work_item/${encodeURIComponent(workItemId)}`),
    getSpecReplay: (specId: string) => request<TimelineEntry[]>(`/query/replay/spec/${encodeURIComponent(specId)}`),
    getPlanReplay: (planId: string) => request<TimelineEntry[]>(`/query/replay/plan/${encodeURIComponent(planId)}`),
    getExecutionPackageReplay: (executionPackageId: string) =>
      request<TimelineEntry[]>(`/query/replay/execution_package/${encodeURIComponent(executionPackageId)}`),
    getReviewPacketReplay: (reviewPacketId: string) =>
      request<TimelineEntry[]>(`/query/replay/review_packet/${encodeURIComponent(reviewPacketId)}`),
    getReleaseCockpit: (releaseId: string) =>
      request<ReleaseCockpitResponse>(`/query/release-cockpit/${encodeURIComponent(releaseId)}`),
    getReleaseReplay: (releaseId: string) =>
      request<TimelineEntry[]>(`/query/replay/release/${encodeURIComponent(releaseId)}`),
  };

  return Object.defineProperties(
    api,
    Object.fromEntries(Object.entries(productMethods).map(([key, value]) => [key, { value, enumerable: false }])),
  ) as typeof api & typeof productMethods;
}

export type ForgeloopQueryApi = ReturnType<typeof createForgeloopQueryApi>;
