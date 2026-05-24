import { createApiContext, type ForgeloopApiOptions } from './common';
import { z } from 'zod';
import {
  boardCardSchema,
  bugDetailSchema,
  bugListItemSchema,
  executionSchema,
  initiativeDetailSchema,
  initiativeListItemSchema,
  myWorkQueueItemSchema,
  pipelineResponseSchema,
  productLaneResponseSchema,
  deliveryRunReadinessResponseSchema,
  releaseReadinessDetailSchema,
  requirementDetailSchema,
  requirementListItemSchema,
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
  ReleaseCockpitResponse,
  ReviewPacket,
  TimelineEntry,
} from './types';

export interface ProjectQuery {
  project_id: string;
}

export type ProductRegistryQuery = ListProductQuery;
export type MyWorkQuery = Pick<ListProductQuery, 'project_id' | 'actor_id' | 'cursor' | 'limit'>;
export type ProjectManagementListQuery = Pick<ListProductQuery, 'project_id' | 'status' | 'risk' | 'driver_actor_id' | 'cursor' | 'limit'>;

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
const bugListResponseSchema = z.object({ items: z.array(bugListItemSchema) }).passthrough();
const boardResponseSchema = z
  .object({
    items: z.array(boardCardSchema),
    degraded_sources: z.array(z.string()).default([]),
  })
  .passthrough();
const dashboardResponseSchema = z
  .object({
    project_id: z.string(),
    sections: z.array(z.record(z.string(), z.unknown())).default([]),
    next_actions: z.array(z.record(z.string(), z.unknown())).default([]),
    report_links: z.array(z.record(z.string(), z.unknown())).default([]),
    degraded_sources: z.array(z.string()).default([]),
  })
  .passthrough();
const developmentPlanListResponseSchema = z
  .object({
    items: z.array(z.record(z.string(), z.unknown())),
    degraded_sources: z.array(z.string()).default([]),
  })
  .passthrough();
const developmentPlanProjectionSchema = z.record(z.string(), z.unknown());
const developmentPlanItemProjectionSchema = z.record(z.string(), z.unknown());
const developmentPlanItemRevisionListSchema = z.array(
  z
    .object({
      id: z.string(),
      development_plan_item_id: z.string(),
      revision_number: z.number().int().positive(),
    })
    .passthrough(),
);
const boundarySummaryRevisionListSchema = z.array(
  z
    .object({
      id: z.string(),
      boundary_summary_id: z.string(),
      revision_number: z.number().int().positive(),
    })
    .passthrough(),
);
const specExecutionPlanQueueResponseSchema = z.object({ items: z.array(z.record(z.string(), z.unknown())) }).passthrough();
const aiNativeQueueResponseSchema = z
  .object({
    items: z.array(z.record(z.string(), z.unknown())),
    degraded_sources: z.array(z.string()).default([]),
  })
  .passthrough();
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
    getDashboard: async (query: ProductRegistryQuery) =>
      dashboardResponseSchema.parse(await request<unknown>(`/query/dashboard${queryString(query)}`)),
    listDevelopmentPlans: async (query: ProductRegistryQuery) =>
      developmentPlanListResponseSchema.parse(await request<unknown>(`/query/development-plans${queryString(query)}`)),
    getDevelopmentPlan: async (developmentPlanId: string) =>
      developmentPlanProjectionSchema.parse(await request<unknown>(`/query/development-plans/${encodeURIComponent(developmentPlanId)}`)),
    getDevelopmentPlanItem: async (developmentPlanId: string, itemId: string) =>
      developmentPlanItemProjectionSchema.parse(
        await request<unknown>(
          `/query/development-plans/${encodeURIComponent(developmentPlanId)}/items/${encodeURIComponent(itemId)}`,
        ),
      ),
    listDevelopmentPlanItemRevisions: async (developmentPlanId: string, itemId: string) =>
      developmentPlanItemRevisionListSchema.parse(
        await request<unknown>(
          `/development-plans/${encodeURIComponent(developmentPlanId)}/items/${encodeURIComponent(itemId)}/revisions`,
        ),
      ),
    compareDevelopmentPlanItemRevisions: async (developmentPlanId: string, itemId: string, query: { base_revision_id: string; compare_revision_id: string }) =>
      developmentPlanItemProjectionSchema.parse(
        await request<unknown>(
          `/development-plans/${encodeURIComponent(developmentPlanId)}/items/${encodeURIComponent(itemId)}/revisions/compare${queryString(query)}`,
        ),
      ),
    listBoundarySummaryRevisions: async (boundarySummaryId: string) =>
      boundarySummaryRevisionListSchema.parse(
        await request<unknown>(`/boundary-summaries/${encodeURIComponent(boundarySummaryId)}/revisions`),
      ),
    compareBoundarySummaryRevisions: async (boundarySummaryId: string, query: { base_revision_id: string; compare_revision_id: string }) =>
      developmentPlanItemProjectionSchema.parse(
        await request<unknown>(`/boundary-summaries/${encodeURIComponent(boundarySummaryId)}/revisions/compare${queryString(query)}`),
      ),
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
    listSpecExecutionPlanQueue: async (query: ProductRegistryQuery) =>
      specExecutionPlanQueueResponseSchema.parse(await request<unknown>(`/query/specs-execution-plans${queryString(query)}`)),
    listExecutions: async (query: ProductRegistryQuery) =>
      aiNativeQueueResponseSchema.parse(await request<unknown>(`/query/executions${queryString(query)}`)),
    getExecution: async (executionId: string) =>
      executionSchema.parse(await request<unknown>(`/query/executions/${encodeURIComponent(executionId)}`)),
    listCodeReviewHandoffs: async (query: ProductRegistryQuery) =>
      aiNativeQueueResponseSchema.parse(await request<unknown>(`/query/code-review-handoffs${queryString(query)}`)),
    listQaHandoffs: async (query: ProductRegistryQuery) =>
      aiNativeQueueResponseSchema.parse(await request<unknown>(`/query/qa-handoffs${queryString(query)}`)),
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
      return 'Open item';
    default:
      return 'Open detail';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
