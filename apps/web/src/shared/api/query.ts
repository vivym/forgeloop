import { createApiContext, type ForgeloopApiOptions } from './common';
import type {
  CockpitResponse,
  ExecutionPackage,
  PlanRevision,
  ReleaseCockpitResponse,
  ReleaseListResponse,
  ReviewPacket,
  RoleWorkbenchId,
  RoleWorkbenchQuery,
  RoleWorkbenchResponse,
  RunSession,
  SpecPlan,
  SpecRevision,
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
    listSpecs: (query: ProjectQuery) => request<SpecPlan[]>(`/query/specs${queryString(query)}`),
    getSpec: (specId: string) => request<SpecPlan>(`/query/specs/${encodeURIComponent(specId)}`),
    getSpecHistory: (specId: string) => request<SpecRevision[]>(`/query/specs/${encodeURIComponent(specId)}/history`),
    listPlans: (query: ProjectQuery) => request<SpecPlan[]>(`/query/plans${queryString(query)}`),
    getPlan: (planId: string) => request<SpecPlan>(`/query/plans/${encodeURIComponent(planId)}`),
    getPlanHistory: (planId: string) => request<PlanRevision[]>(`/query/plans/${encodeURIComponent(planId)}/history`),
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
