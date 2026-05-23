import { createApiContext, type ForgeloopApiOptions } from './common';
import { normalizeProductWorkItemRegistryQuery } from './query-keys';
import { z } from 'zod';
import {
  boardCardSchema,
  bugDetailSchema,
  bugListItemSchema,
  initiativeDetailSchema,
  initiativeListItemSchema,
  myWorkQueueItemSchema,
  pipelineResponseSchema,
  productLaneResponseSchema,
  productListResponseSchema,
  deliveryRunReadinessResponseSchema,
  releaseReadinessDetailSchema,
  requirementDetailSchema,
  requirementListItemSchema,
  taskDetailSchema,
  taskListItemSchema,
  techDebtDetailSchema,
  techDebtListItemSchema,
  workItemCockpitResponseSchema,
} from '@forgeloop/contracts';
import type {
  CockpitResponse,
  DeliveryRunReadiness,
  ListProductQuery,
  PipelineResponse,
  ProductLaneId,
  ProductLaneQuery,
  ProductLaneResponse,
  ProductListResponse,
  ReleaseCockpitResponse,
  ReviewPacket,
  TaskPackageEvidence,
  TaskReviewEvidence,
  TaskRunEvidence,
  TimelineEntry,
} from './types';

export interface ProjectQuery {
  project_id: string;
}

export type ProductRegistryQuery = ListProductQuery;
export type MyWorkQuery = Pick<ListProductQuery, 'project_id' | 'actor_id' | 'cursor' | 'limit'>;
export type ProjectManagementListQuery = Pick<ListProductQuery, 'project_id' | 'status' | 'risk' | 'driver_actor_id' | 'cursor' | 'limit'>;
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

const projectManagementQueueResponseSchema = z
  .object({
    items: z.array(myWorkQueueItemSchema),
    degraded_sources: z.array(z.string()).default([]),
  })
  .passthrough();

const requirementListResponseSchema = z.object({ items: z.array(requirementListItemSchema) }).passthrough();
const initiativeListResponseSchema = z.object({ items: z.array(initiativeListItemSchema) }).passthrough();
const techDebtListResponseSchema = z.object({ items: z.array(techDebtListItemSchema) }).passthrough();
const taskListResponseSchema = z.object({ items: z.array(taskListItemSchema) }).passthrough();
const bugListResponseSchema = z.object({ items: z.array(bugListItemSchema) }).passthrough();
const boardResponseSchema = z.object({ items: z.array(boardCardSchema) }).passthrough();
const reportResponseSchema = z
  .object({
    id: z.string(),
    project_id: z.string(),
    generated_at: z.string().optional(),
    degraded_sources: z.array(z.string()).default([]),
  })
  .passthrough();

export function createForgeloopQueryApi(options: ForgeloopApiOptions = {}) {
  const { request } = createApiContext(options);

  const productMethods = {
    listMyWork: async (query: MyWorkQuery) =>
      projectManagementQueueResponseSchema.parse(
        await request<unknown>(`/query/my-work${queryString(query)}`),
      ),
    listRequirements: async (query: ProjectManagementListQuery) =>
      requirementListResponseSchema.parse(
        await request<unknown>(`/query/requirements${queryString(query)}`),
      ),
    getRequirement: async (requirementId: string) =>
      requirementDetailSchema.parse(
        await request<unknown>(`/query/requirements/${encodeURIComponent(requirementId)}`),
      ),
    listInitiatives: async (query: ProjectManagementListQuery) =>
      initiativeListResponseSchema.parse(
        await request<unknown>(`/query/initiatives${queryString(query)}`),
      ),
    getInitiative: async (initiativeId: string) =>
      initiativeDetailSchema.parse(
        await request<unknown>(`/query/initiatives/${encodeURIComponent(initiativeId)}`),
      ),
    listTechDebt: async (query: ProjectManagementListQuery) =>
      techDebtListResponseSchema.parse(
        await request<unknown>(`/query/tech-debt${queryString(query)}`),
      ),
    getTechDebt: async (techDebtId: string) =>
      techDebtDetailSchema.parse(
        await request<unknown>(`/query/tech-debt/${encodeURIComponent(techDebtId)}`),
      ),
    listTasks: async (query: ProjectManagementListQuery) =>
      taskListResponseSchema.parse(await request<unknown>(`/query/tasks${queryString(query)}`)),
    getTask: async (taskId: string) =>
      taskDetailSchema.parse(await request<unknown>(`/query/tasks/${encodeURIComponent(taskId)}`)),
    getTaskPackageEvidence: (taskId: string, packageId: string) =>
      request<TaskPackageEvidence>(
        `/query/tasks/${encodeURIComponent(taskId)}/packages/${encodeURIComponent(packageId)}`,
      ),
    getTaskRunEvidence: (taskId: string, runSessionId: string) =>
      request<TaskRunEvidence>(
        `/query/tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runSessionId)}`,
      ),
    getTaskReviewEvidence: (taskId: string, reviewPacketId: string) =>
      request<TaskReviewEvidence>(
        `/query/tasks/${encodeURIComponent(taskId)}/reviews/${encodeURIComponent(reviewPacketId)}`,
      ),
    listBugs: async (query: ProjectManagementListQuery) =>
      bugListResponseSchema.parse(await request<unknown>(`/query/bugs${queryString(query)}`)),
    getBug: async (bugId: string) =>
      bugDetailSchema.parse(await request<unknown>(`/query/bugs/${encodeURIComponent(bugId)}`)),
    listBoardCards: async (query: ProductRegistryQuery) =>
      boardResponseSchema.parse(await request<unknown>(`/query/board${queryString(query)}`)),
    getReport: async (reportId: string, query: ProductRegistryQuery) =>
      reportResponseSchema.parse(await request<unknown>(`/query/reports/${encodeURIComponent(reportId)}${queryString(query)}`)),
    getReleaseReadiness: async (releaseId: string, query: ProjectQuery) =>
      releaseReadinessDetailSchema.parse(
        await request<unknown>(`/query/releases/${encodeURIComponent(releaseId)}/readiness${queryString(query)}`),
      ),
    getPipeline: async (query: ProjectQuery) =>
      pipelineResponseSchema.parse(await request<unknown>(`/query/pipeline${queryString(query)}`)) as PipelineResponse,
    listWorkItems: async (query: ProductWorkItemRegistryQuery) =>
      productListResponseSchema.parse(
        await request<unknown>(`/query/work-items${queryString(normalizeProductWorkItemRegistryQuery(query))}`),
      ) as ProductListResponse,
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
    getExecutionPackageRuntimeReadiness: async (executionPackageId: string) =>
      deliveryRunReadinessResponseSchema.parse(
        await request<unknown>(`/query/execution-packages/${encodeURIComponent(executionPackageId)}/runtime-readiness`),
      ) as DeliveryRunReadiness,
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
    case 'initiative':
    case 'requirement':
    case 'bug':
    case 'tech_debt':
    case 'task':
      return 'Open item';
    default:
      return 'Open detail';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
