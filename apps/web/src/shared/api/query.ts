import { createApiContext, type ForgeloopApiOptions } from './common';
import {
  pipelineResponseSchema,
  productLaneResponseSchema,
  productListResponseSchema,
  workItemActionsResponseSchema,
} from '@forgeloop/contracts';
import type {
  CockpitResponse,
  ListProductQuery,
  PipelineResponse,
  ProductLaneId,
  ProductLaneQuery,
  ProductLaneResponse,
  ProductListResponse,
  ReleaseCockpitResponse,
  ReleaseListResponse,
  ReviewPacket,
  TimelineEntry,
  WorkItemActionsQuery,
  WorkItemActionsResponse,
} from './types';

export interface ProjectQuery {
  project_id: string;
}

export type ProductRegistryQuery = ListProductQuery;

const queryString = (params: object = {}) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      searchParams.set(key, String(value));
    }
  }
  const encoded = searchParams.toString();
  return encoded ? `?${encoded}` : '';
};

export function createForgeloopQueryApi(options: ForgeloopApiOptions = {}) {
  const { request } = createApiContext(options);

  const productMethods = {
    getPipeline: async (query: ProjectQuery) =>
      pipelineResponseSchema.parse(await request<unknown>(`/query/pipeline${queryString(query)}`)) as PipelineResponse,
    listWorkItems: async (query: ProductRegistryQuery) =>
      productListResponseSchema.parse(await request<unknown>(`/query/work-items${queryString(query)}`)) as ProductListResponse,
    listSpecs: async (query: ProductRegistryQuery) =>
      productListResponseSchema.parse(await request<unknown>(`/query/specs${queryString(query)}`)) as ProductListResponse,
    listPlans: async (query: ProductRegistryQuery) =>
      productListResponseSchema.parse(await request<unknown>(`/query/plans${queryString(query)}`)) as ProductListResponse,
    listPackages: async (query: ProductRegistryQuery) =>
      productListResponseSchema.parse(
        await request<unknown>(`/query/execution-packages${queryString(query)}`),
      ) as ProductListResponse,
    listRuns: async (query: ProductRegistryQuery) =>
      productListResponseSchema.parse(await request<unknown>(`/query/runs${queryString(query)}`)) as ProductListResponse,
    listReviewPackets: async (query: ProductRegistryQuery) =>
      productListResponseSchema.parse(await request<unknown>(`/query/review-packets${queryString(query)}`)) as ProductListResponse,
    listReviews: (query: ProjectQuery) => request<ReviewPacket[]>(`/query/reviews${queryString(query)}`),
    getReview: (reviewPacketId: string) => request<ReviewPacket>(`/query/reviews/${encodeURIComponent(reviewPacketId)}`),
    listReleases: (query: ProjectQuery) => request<ReleaseListResponse>(`/query/releases${queryString(query)}`),
  };

  const api = {
    getProductLane: async (laneId: ProductLaneId, query: ProductLaneQuery) =>
      productLaneResponseSchema.parse(
        await request<unknown>(`/query/product-lanes/${encodeURIComponent(laneId)}${queryString(query)}`),
      ) as ProductLaneResponse,
    getWorkItemActions: async (workItemId: string, query: WorkItemActionsQuery = {}) =>
      workItemActionsResponseSchema.parse(
        await request<unknown>(`/query/work-items/${encodeURIComponent(workItemId)}/actions${queryString(query)}`),
      ) as WorkItemActionsResponse,
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
