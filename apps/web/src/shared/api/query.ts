import { createApiContext, type ForgeloopApiOptions } from './common';
import {
  pipelineResponseSchema,
  productLaneResponseSchema,
  productListResponseSchema,
  workItemCockpitResponseSchema,
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
} from './types';

export interface ProjectQuery {
  project_id: string;
}

export type ProductRegistryQuery = ListProductQuery;
export type ProductWorkItemRegistryQuery = Pick<
  ListProductQuery,
  'project_id' | 'actor_id' | 'status' | 'phase' | 'gate_state' | 'resolution' | 'risk' | 'driver_actor_id' | 'blocked' | 'stale' | 'cursor' | 'limit'
>;

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
    listWorkItems: async (query: ProductWorkItemRegistryQuery) =>
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
        hardenManagerProductLaneActions(
          await request<unknown>(`/query/product-lanes/${encodeURIComponent(laneId)}${queryString(query)}`),
        ),
      ) as ProductLaneResponse,
    getWorkItemCockpit: async (workItemId: string, options: { lane?: ProductLaneId } = {}) =>
      workItemCockpitResponseSchema.parse(
        hardenManagerCockpitActions(
          await request<unknown>(`/query/work-item-cockpit/${encodeURIComponent(workItemId)}${queryString(options)}`),
        ),
      ) as CockpitResponse,
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

function hardenManagerCockpitActions(response: unknown): unknown {
  if (!isRecord(response) || !isRecord(response.delivery_readiness) || response.delivery_readiness.active_lane !== 'manager') {
    return response;
  }

  const rawActions = response.delivery_readiness.next_actions;
  if (!Array.isArray(rawActions)) return response;

  return {
    ...response,
    delivery_readiness: {
      ...response.delivery_readiness,
      next_actions: rawActions.flatMap((action) => hardenManagerAction(action)),
    },
  };
}

function hardenManagerProductLaneActions(response: unknown): unknown {
  if (!isRecord(response) || response.lane_id !== 'manager' || !Array.isArray(response.items)) {
    return response;
  }

  return {
    ...response,
    items: response.items.map((item) => {
      if (!isRecord(item) || !Array.isArray(item.actions)) return item;

      return {
        ...item,
        actions: item.actions.flatMap((action) => hardenManagerAction(action)),
      };
    }),
  };
}

function hardenManagerAction(action: unknown): unknown[] {
  if (!isRecord(action)) return [];

  if (action.kind === 'navigate') {
    return [{ ...action, lane_id: 'manager' }];
  }

  if (action.kind !== 'command' || !isRecord(action.target) || action.target.kind !== 'object') {
    return [];
  }

  return [
    {
      id: `${String(action.id)}-drill-down`,
      lane_id: 'manager',
      priority: 'secondary',
      label: managerObjectActionLabel(action.target.object_type),
      ...(typeof action.description === 'string' ? { description: action.description } : {}),
      enabled: true,
      kind: 'navigate',
      target: action.target,
    },
  ];
}

function managerObjectActionLabel(objectType: unknown) {
  switch (objectType) {
    case 'execution_package':
      return 'Open package';
    case 'run_session':
      return 'Open run';
    case 'review_packet':
      return 'Open review';
    case 'work_item':
      return 'Open work item';
    default:
      return 'Open detail';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
