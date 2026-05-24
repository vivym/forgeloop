// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import {
  useCreateExecutionPackageMutation,
  useApproveItemExecutionPlanMutation,
  useApproveItemSpecMutation,
  useCodeReviewHandoffsQuery,
  useDashboardQuery,
  useDevelopmentPlanItemQuery,
  useDevelopmentPlanItemRevisionsQuery,
  useDevelopmentPlanQuery,
  useDevelopmentPlansQuery,
  useExecutionQuery,
  useExecutionsQuery,
  useGeneratePackagesMutation,
  useGenerateItemExecutionPlanDraftMutation,
  useGenerateItemSpecDraftMutation,
  useLinkReleaseExecutionPackageMutation,
  useLinkReleaseWorkItemMutation,
  useMarkPackageReadyMutation,
  useMyWorkQuery,
  usePipelineQuery,
  useQaHandoffsQuery,
  useRunPackageMutation,
  useProductActionCommandMutation,
  useProductLaneQuery,
  useRequirementQuery,
  useRequirementsQuery,
  useRequestItemExecutionPlanChangesMutation,
  useRequestItemSpecChangesMutation,
  useSpecExecutionPlanQueueQuery,
  useSubmitItemExecutionPlanForApprovalMutation,
  useSubmitItemSpecForApprovalMutation,
  useUnlinkReleaseExecutionPackageMutation,
  useUnlinkReleaseWorkItemMutation,
  useWorkItemCockpitQuery,
} from '../../apps/web/src/shared/api/hooks';
import { createForgeloopCommandApi } from '../../apps/web/src/shared/api/commands';
import { createForgeloopQueryApi } from '../../apps/web/src/shared/api/query';
import { queryKeys } from '../../apps/web/src/shared/api/query-keys';
import { installProductApiMock } from './fixtures/product-api-mock';
import {
  actorId,
  bugDetail,
  bugListResponse,
  boundarySummary,
  codeReviewHandoff,
  developmentPlan,
  developmentPlanItem,
  execution,
  executionPackage,
  initiativeDetail,
  initiativeListResponse,
  myWorkQueueResponse,
  planRevision,
  projectId,
  qaHandoff,
  release,
  requirementDetail,
  requirementListResponse,
  techDebtDetail,
  techDebtListResponse,
  workItem,
} from './fixtures/product-data';

const workItemScopeRef = { type: 'requirement', id: workItem.id, title: workItem.title } as const;

type InvalidationInput = {
  predicate?: (query: { queryKey: readonly unknown[] }) => boolean;
  queryKey?: readonly unknown[];
};

const expectWorkItemCockpitInvalidation = (
  calls: readonly (readonly [unknown, ...unknown[]])[],
  workItemId: string,
) => {
  const input = calls
    .map(([candidate]) => candidate as InvalidationInput)
    .find((candidate) => {
      if (typeof candidate.predicate !== 'function') {
        return false;
      }
      return (
        candidate.predicate({ queryKey: queryKeys.workItemCockpit(workItemId) }) === true &&
        candidate.predicate({ queryKey: queryKeys.workItemCockpit(workItemId, 'reviewer') }) === true
      );
    });

  expect(input).toBeDefined();
  expect(input?.predicate?.({ queryKey: queryKeys.workItemCockpit('other-work-item', 'reviewer') })).toBe(false);
  expect(input?.predicate?.({ queryKey: queryKeys.productLane('requirements', { project_id: projectId }) })).toBe(false);
};

const expectDeliverySurfaceInvalidation = (invalidateSpy: ReturnType<typeof vi.spyOn<QueryClient, 'invalidateQueries'>>) => {
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['product-lanes'] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['work-item-cockpit'] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['runs'] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['review-packets'] });
};

describe('Web product API hooks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses stable query keys for route-backed product data', () => {
    expect(queryKeys.productLane('bugs', { project_id: 'proj', blocked: true })).toEqual([
      'product-lanes',
      'bugs',
      { project_id: 'proj', blocked: true },
    ]);
    expect(queryKeys.specReplay('spec-1')).toEqual(['spec-replay', 'spec-1']);
    expect(queryKeys.planReplay('plan-1')).toEqual(['plan-replay', 'plan-1']);
    expect(queryKeys.workItemCockpit('wi-1')).toEqual(['work-item-cockpit', 'wi-1']);
    expect(queryKeys.workItemCockpit('wi-1', 'reviewer')).toEqual(['work-item-cockpit', 'wi-1', { lane: 'reviewer' }]);
  });

  it('includes response-affecting Spec and Execution Plan queue filters in stable cache keys', () => {
    expect(
      queryKeys.specExecutionPlanQueue({
        project_id: 'proj',
        limit: 100,
        cursor: 'cursor-1',
      }),
    ).toEqual(['spec-execution-plan-queue', { project_id: 'proj', limit: 100, cursor: 'cursor-1' }]);
  });

  it('uses stable query keys for My Work and typed object pages', () => {
    expect(queryKeys.myWork({ project_id: 'proj', actor_id: 'actor-product' })).toEqual([
      'my-work',
      { project_id: 'proj', actor_id: 'actor-product' },
    ]);
    expect(queryKeys.requirements({ project_id: 'proj', limit: 25 })).toEqual([
      'requirements',
      { project_id: 'proj', limit: 25 },
    ]);
    expect(queryKeys.requirement('req-1')).toEqual(['requirement', 'req-1']);
    expect(queryKeys.developmentPlan('development-plan-1')).toEqual(['development-plan', 'development-plan-1']);
    expect(queryKeys.developmentPlanItem('development-plan-1', 'item-1')).toEqual([
      'development-plan-item',
      'development-plan-1',
      'item-1',
    ]);
    expect(queryKeys.execution('execution-1')).toEqual(['execution', 'execution-1']);
  });

  it('omits owner filters from Development Plan registry query keys', () => {
    const staleOwnerFilterKey = ['owner', 'actor', 'id'].join('_');
    expect(
      queryKeys.developmentPlans({
        project_id: 'proj',
        driver_actor_id: 'driver',
        [staleOwnerFilterKey]: 'owner',
      } as any),
    ).toEqual(['development-plans', { project_id: 'proj', driver_actor_id: 'driver' }]);
  });

  it('includes response-affecting Product Lane query inputs in stable cache keys', () => {
    const bugsLaneKey = queryKeys.productLane('bugs', {
      status: 'ready',
      project_id: 'proj',
      actor_id: 'actor-owner',
      driver_actor_id: 'actor-driver',
      kind: 'bug',
      limit: 25,
      cursor: 'cursor-1',
      phase: 'triage',
      gate_state: 'awaiting_review',
      resolution: 'none',
      risk: 'high',
      blocked: false,
      stale: true,
    });
    const sameQueryDifferentPropertyOrder = queryKeys.productLane('bugs', {
      stale: true,
      blocked: false,
      risk: 'high',
      resolution: 'none',
      gate_state: 'awaiting_review',
      phase: 'triage',
      cursor: 'cursor-1',
      limit: 25,
      kind: 'bug',
      driver_actor_id: 'actor-driver',
      actor_id: 'actor-owner',
      project_id: 'proj',
      status: 'ready',
    });
    const changedActorKey = queryKeys.productLane('bugs', {
      project_id: 'proj',
      actor_id: 'actor-reviewer',
      kind: 'bug',
      limit: 25,
      cursor: 'cursor-1',
      phase: 'triage',
      status: 'ready',
      risk: 'high',
    });

    expect(bugsLaneKey).toEqual(sameQueryDifferentPropertyOrder);
    expect(bugsLaneKey).not.toEqual(changedActorKey);
    expect(bugsLaneKey).toEqual([
      'product-lanes',
      'bugs',
      {
        project_id: 'proj',
        actor_id: 'actor-owner',
        driver_actor_id: 'actor-driver',
        kind: 'bug',
        phase: 'triage',
        status: 'ready',
        gate_state: 'awaiting_review',
        resolution: 'none',
        risk: 'high',
        blocked: false,
        stale: true,
        cursor: 'cursor-1',
        limit: 25,
      },
    ]);
    expect(Object.keys(bugsLaneKey[2] as Record<string, unknown>)).toEqual([
      'project_id',
      'actor_id',
      'driver_actor_id',
      'kind',
      'phase',
      'status',
      'gate_state',
      'resolution',
      'risk',
      'blocked',
      'stale',
      'cursor',
      'limit',
    ]);
  });

  it('fetches Development Plans with driver_actor_id in the query key and URL', async () => {
    const fetchMock = installProductApiMock({
      [`GET /query/development-plans?project_id=${projectId}&driver_actor_id=actor-driver&limit=25`]: {
        items: [],
        degraded_sources: [],
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(
      () => useDevelopmentPlansQuery({ project_id: projectId, driver_actor_id: 'actor-driver', limit: 25 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/development-plans?project_id=${projectId}&driver_actor_id=actor-driver&limit=25`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(queryClient.getQueryData(queryKeys.developmentPlans({ project_id: projectId, driver_actor_id: 'actor-driver', limit: 25 }))).toEqual({
      items: [],
      degraded_sources: [],
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('owner_actor_id');

    unmount();
    queryClient.clear();
  });

  it('keeps execution owner filters in Execution query keys and request URLs', async () => {
    const fetchMock = installProductApiMock({
      [`GET /query/executions?project_id=${projectId}&execution_owner_actor_id=actor-execution-owner&limit=25`]: {
        items: [],
        degraded_sources: [],
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(
      () =>
        useExecutionsQuery({
          project_id: projectId,
          execution_owner_actor_id: 'actor-execution-owner',
          limit: 25,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/executions?project_id=${projectId}&execution_owner_actor_id=actor-execution-owner&limit=25`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(
      queryClient.getQueryData(
        queryKeys.executions({
          project_id: projectId,
          execution_owner_actor_id: 'actor-execution-owner',
          limit: 25,
        }),
      ),
    ).toEqual({ items: [], degraded_sources: [] });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.has(['owner', 'actor', 'id'].join('_'))).toBe(false);

    unmount();
    queryClient.clear();
  });

  it('uses the installed product API mock when hooks were imported before fetch was stubbed', async () => {
    const fetchMock = installProductApiMock();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(() => usePipelineQuery(projectId), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.stages.map((stage) => stage.id)).toEqual([
      'intake',
      'spec_plan',
      'execution',
      'review',
      'integration_validation',
      'test_acceptance',
      'release',
      'observation',
    ]);
    expect(result.current.data?.stages[0]?.representative_items[0]?.id).toBe(workItem.id);
    expect(result.current.data?.stages.find((stage) => stage.id === 'integration_validation')?.integration_readiness).toEqual(
      expect.objectContaining({
        readiness_status: expect.any(String),
        dependency_blockers: expect.any(Array),
        contract_mock_readiness: expect.any(Array),
        environment_requirements: expect.any(Array),
        waiting_package_refs: expect.any(Array),
      }),
    );
    expect(result.current.data?.stages.find((stage) => stage.id === 'test_acceptance')?.test_acceptance).toEqual(
      expect.objectContaining({
        qa_owner_queues: expect.any(Array),
        test_strategy_gaps: expect.any(Array),
        acceptance_criteria_state: expect.any(String),
        quality_gates: expect.any(Array),
        regression_coverage_gaps: expect.any(Array),
        release_blocking_issues: expect.any(Array),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/pipeline?project_id=${projectId}`,
      expect.objectContaining({ method: 'GET' }),
    );

    unmount();
    queryClient.clear();
  });

  it('fetches Development Plan and Development Plan Item detail through query hooks', async () => {
    const fetchMock = installProductApiMock();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const plan = renderHook(() => useDevelopmentPlanQuery(developmentPlan.id), { wrapper });
    await waitFor(() => expect(plan.result.current.isSuccess).toBe(true));
    expect(plan.result.current.data).toEqual(expect.objectContaining({ id: developmentPlan.id, title: developmentPlan.title }));

    const item = renderHook(() => useDevelopmentPlanItemQuery(developmentPlan.id, developmentPlanItem.id), { wrapper });
    await waitFor(() => expect(item.result.current.isSuccess).toBe(true));
    expect(item.result.current.data).toEqual(expect.objectContaining({ id: developmentPlanItem.id, title: developmentPlanItem.title }));

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/development-plans/${developmentPlan.id}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
      expect.objectContaining({ method: 'GET' }),
    );

    plan.unmount();
    item.unmount();
    queryClient.clear();
  });

  it('passes Spec and Execution Plan queue filters through the product query endpoint', async () => {
    const fetchMock = installProductApiMock({
      [`GET /query/specs-execution-plans?project_id=${projectId}&limit=100`]: {
        items: [],
        degraded_sources: [],
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(
      () => useSpecExecutionPlanQueueQuery({ project_id: projectId, limit: 100 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/specs-execution-plans?project_id=${projectId}&limit=100`,
      expect.objectContaining({ method: 'GET' }),
    );

    unmount();
    queryClient.clear();
  });

  it('fetches AI-native dashboard, revisions, execution, and handoff queues through shared hooks', async () => {
    const fetchMock = installProductApiMock();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const dashboard = renderHook(() => useDashboardQuery({ project_id: projectId }), { wrapper });
    await waitFor(() => expect(dashboard.result.current.isSuccess).toBe(true));
    expect(dashboard.result.current.data).toEqual(expect.objectContaining({ project_id: projectId }));

    const revisions = renderHook(() => useDevelopmentPlanItemRevisionsQuery(developmentPlan.id, developmentPlanItem.id), {
      wrapper,
    });
    await waitFor(() => expect(revisions.result.current.isSuccess).toBe(true));
    expect(revisions.result.current.data?.[0]).toEqual(expect.objectContaining({ id: developmentPlanItem.revision_id }));

    const executionDetail = renderHook(() => useExecutionQuery(execution.id), { wrapper });
    await waitFor(() => expect(executionDetail.result.current.isSuccess).toBe(true));
    expect(executionDetail.result.current.data?.id).toBe(execution.id);

    const codeReview = renderHook(() => useCodeReviewHandoffsQuery({ project_id: projectId }), { wrapper });
    await waitFor(() => expect(codeReview.result.current.isSuccess).toBe(true));
    expect(codeReview.result.current.data?.items[0]).toEqual(expect.objectContaining({ id: codeReviewHandoff.id }));

    const qa = renderHook(() => useQaHandoffsQuery({ project_id: projectId }), { wrapper });
    await waitFor(() => expect(qa.result.current.isSuccess).toBe(true));
    expect(qa.result.current.data?.items[0]).toEqual(expect.objectContaining({ id: qaHandoff.id }));

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/dashboard?project_id=${projectId}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/revisions`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/executions/${execution.id}`,
      expect.objectContaining({ method: 'GET' }),
    );

    dashboard.unmount();
    revisions.unmount();
    executionDetail.unmount();
    codeReview.unmount();
    qa.unmount();
    queryClient.clear();
  });

  it('fetches My Work and typed object pages through query hooks', async () => {
    const fetchMock = installProductApiMock();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const myWork = renderHook(() => useMyWorkQuery({ project_id: projectId, actor_id: actorId }), { wrapper });
    await waitFor(() => expect(myWork.result.current.isSuccess).toBe(true));
    expect(myWork.result.current.data?.items.map((item) => item.href)).toEqual(
      expect.arrayContaining([
        '/requirements/req-1',
        `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
      ]),
    );

    const requirements = renderHook(() => useRequirementsQuery({ project_id: projectId, limit: 100 }), { wrapper });
    await waitFor(() => expect(requirements.result.current.isSuccess).toBe(true));
    expect(requirements.result.current.data?.items[0]?.ref).toEqual({ type: 'requirement', id: 'req-1' });

    const requirement = renderHook(() => useRequirementQuery('req-1'), { wrapper });
    await waitFor(() => expect(requirement.result.current.isSuccess).toBe(true));
    expect(requirement.result.current.data?.ref).toEqual({ type: 'requirement', id: 'req-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/my-work?project_id=${projectId}&actor_id=${actorId}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/requirements?project_id=${projectId}&limit=100`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/query/requirements/req-1',
      expect.objectContaining({ method: 'GET' }),
    );

    myWork.unmount();
    requirements.unmount();
    requirement.unmount();
    queryClient.clear();
  });

  it('exposes typed query client methods for all Task 7 object types', async () => {
    const fetchMock = installProductApiMock();
    const api = createForgeloopQueryApi();

    await expect(api.listMyWork({ project_id: projectId, actor_id: actorId })).resolves.toEqual(myWorkQueueResponse);
    await expect(api.getDashboard({ project_id: projectId })).resolves.toEqual(
      expect.objectContaining({ project_id: projectId }),
    );
    await expect(api.listDevelopmentPlans({ project_id: projectId })).resolves.toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ id: developmentPlan.id })]),
        degraded_sources: [],
      }),
    );
    await expect(api.getDevelopmentPlan(developmentPlan.id)).resolves.toEqual(
      expect.objectContaining({ id: developmentPlan.id, title: developmentPlan.title }),
    );
    await expect(api.getDevelopmentPlanItem(developmentPlan.id, developmentPlanItem.id)).resolves.toEqual(
      expect.objectContaining({ id: developmentPlanItem.id, title: developmentPlanItem.title }),
    );
    await expect(api.listDevelopmentPlanItemRevisions(developmentPlan.id, developmentPlanItem.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: developmentPlanItem.revision_id })]),
    );
    await expect(api.listBoundarySummaryRevisions(boundarySummary.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: boundarySummary.id, boundary_summary_id: boundarySummary.id })]),
    );
    await expect(api.listSpecExecutionPlanQueue({ project_id: projectId })).resolves.toEqual(
      expect.objectContaining({ items: expect.any(Array) }),
    );
    await expect(api.listExecutions({ project_id: projectId })).resolves.toEqual(
      expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ id: execution.id })]) }),
    );
    await expect(api.getExecution(execution.id)).resolves.toEqual(execution);
    await expect(api.listCodeReviewHandoffs({ project_id: projectId })).resolves.toEqual(
      expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ id: codeReviewHandoff.id })]) }),
    );
    await expect(api.listQaHandoffs({ project_id: projectId })).resolves.toEqual(
      expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ id: qaHandoff.id })]) }),
    );
    await expect(api.listRequirements({ project_id: projectId, limit: 100 })).resolves.toEqual(requirementListResponse);
    await expect(api.getRequirement('req-1')).resolves.toEqual(requirementDetail);
    await expect(api.listInitiatives({ project_id: projectId, limit: 100 })).resolves.toEqual(initiativeListResponse);
    await expect(api.getInitiative('init-1')).resolves.toEqual(initiativeDetail);
    await expect(api.listTechDebt({ project_id: projectId, limit: 100 })).resolves.toEqual(techDebtListResponse);
    await expect(api.getTechDebt('td-1')).resolves.toEqual(techDebtDetail);
    await expect(api.listBugs({ project_id: projectId, limit: 100 })).resolves.toEqual(bugListResponse);
    await expect(api.getBug('bug-1')).resolves.toEqual(bugDetail);

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/executions/${execution.id}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock.mock.calls.map(([input]) => String(input)).some((url) => url.includes('/query/tasks'))).toBe(false);
  });

  it('uses typed create wrappers without public Task routes', async () => {
    const fetchMock = installProductApiMock({
      'POST /work-items': { ...workItem, id: 'req-created', kind: 'requirement' },
      'POST /development-plans': { ...developmentPlan, id: 'development-plan-created' },
      [`POST /development-plans/${developmentPlan.id}/items`]: { ...developmentPlanItem, id: 'development-plan-item-created' },
      'POST /development-plans/generate-draft': {
        development_plan: developmentPlan,
        revision: { id: developmentPlan.revision_id, development_plan_id: developmentPlan.id, revision_number: 1 },
      },
    });
    const api = createForgeloopCommandApi();

    await api.createRequirement({
      project_id: projectId,
      title: 'Checkout requirement',
      goal: 'Keep checkout valid.',
      success_criteria: ['Invalid payment states are blocked'],
      priority: 'P1',
      risk: 'medium',
      driver_actor_id: actorId,
      intake_context: {
        type: 'requirement',
        stakeholder_problem: 'Checkout accepts invalid payment state.',
        desired_outcome: 'Checkout validation blocks invalid payment state.',
        acceptance_criteria: ['Invalid state cannot continue'],
        in_scope: ['Checkout validation'],
      },
    });
    await api.createDevelopmentPlan({
      project_id: projectId,
      source_ref: { type: 'requirement', id: 'req-1', title: 'Checkout requirement' },
      title: 'Checkout validation development plan',
      actor_id: actorId,
    });
    await api.createDevelopmentPlanItem(developmentPlan.id, {
      title: 'Implement checkout validation',
      summary: 'Implement the scoped checkout validation behavior.',
      responsible_role: 'developer',
      driver_actor_id: actorId,
      reviewer_actor_id: 'actor-reviewer',
      risk: 'medium',
      release_impact: 'release_scoped',
    });
    await api.generateDevelopmentPlanDraft({
      project_id: projectId,
      source_ref: { type: 'requirement', id: 'req-1', title: 'Checkout requirement' },
      guidance: 'Split into developer-owned items.',
      actor_id: actorId,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/work-items',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"kind":"requirement"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/development-plans',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"source_ref":{"type":"requirement","id":"req-1","title":"Checkout requirement"}'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/development-plans/${developmentPlan.id}/items`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"responsible_role":"developer"'),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/development-plans/generate-draft',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(api).not.toHaveProperty('createTask');
    expect(fetchMock.mock.calls.map(([input]) => String(input)).some((url) => url.endsWith('/tasks'))).toBe(false);
  });

  it('fetches Product Lane projections through shared hooks', async () => {
    const fetchMock = installProductApiMock({
      [`GET /query/product-lanes/bugs?project_id=${projectId}&actor_id=actor-owner&blocked=true`]: {
        lane_id: 'bugs',
        label: 'Bugs',
        description: 'Bug work items that need attention.',
        items: [
          {
            id: workItem.id,
            title: workItem.title,
            object: { type: 'bug', id: workItem.id },
            kind: 'bug',
            updated_at: workItem.updated_at,
            actions: [],
          },
        ],
        unsupported_filters: [],
        summary: { total: 1, blocked: 0, high_risk: 0, stale: 0 },
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const lane = renderHook(
      () => useProductLaneQuery('bugs', { project_id: projectId, actor_id: 'actor-owner', blocked: true }),
      { wrapper },
    );

    await waitFor(() => expect(lane.result.current.isSuccess).toBe(true));

    expect(lane.result.current.data?.lane_id).toBe('bugs');
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/product-lanes/bugs?project_id=${projectId}&actor_id=actor-owner&blocked=true`,
      expect.objectContaining({ method: 'GET' }),
    );

    lane.unmount();
    queryClient.clear();
  });

  it('fetches Work Item cockpit data with lane-aware query keys', async () => {
    const fetchMock = installProductApiMock();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const cockpit = renderHook(() => useWorkItemCockpitQuery(workItem.id, 'reviewer'), { wrapper });

    await waitFor(() => expect(cockpit.result.current.isSuccess).toBe(true));

    expect(cockpit.result.current.data?.delivery_readiness.active_lane).toBe('reviewer');
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/work-item-cockpit/${workItem.id}?lane=reviewer`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(queryClient.getQueryData(queryKeys.workItemCockpit(workItem.id, 'reviewer'))).toBeDefined();
    expect(queryClient.getQueryData(queryKeys.workItemCockpit(workItem.id))).toBeUndefined();

    cockpit.unmount();
    queryClient.clear();
  });

  it('executes ProductAction command mutations and invalidates related product caches', async () => {
    const fetchMock = installProductApiMock({
      'POST /plan-revisions/plan-rev-product-action/generate-packages': [],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const action = {
      id: 'generate-packages-plan-rev-product-action',
      lane_id: 'requirements',
      priority: 'primary',
      label: 'Generate packages',
      enabled: true,
      kind: 'command',
      command: {
        type: 'generate_packages',
        object_type: 'plan_revision',
        object_id: 'plan-rev-product-action',
        scope_ref: { type: 'requirement', id: workItem.id },
        plan_revision_id: 'plan-rev-product-action',
      },
      target: {
        kind: 'object',
        object_type: 'plan_revision',
        object_id: 'plan-rev-product-action',
        href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
      },
    } as const;

    const mutation = renderHook(() => useProductActionCommandMutation({ projectId, action }), { wrapper });
    await mutation.result.current.mutateAsync();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/plan-revisions/plan-rev-product-action/generate-packages',
      expect.objectContaining({ method: 'POST' }),
    );
    expectWorkItemCockpitInvalidation(invalidateSpy.mock.calls, workItem.id);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.planRevision('plan-rev-product-action') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['packages'] });

    const productLanePredicateCall = invalidateSpy.mock.calls.find(
      ([input]) => typeof input.predicate === 'function',
    )?.[0] as { predicate?: (query: { queryKey: readonly unknown[] }) => boolean } | undefined;
    expect(productLanePredicateCall?.predicate?.({ queryKey: queryKeys.productLane('requirements', { project_id: projectId }) })).toBe(
      true,
    );
    expect(productLanePredicateCall?.predicate?.({ queryKey: queryKeys.productLane('requirements', { project_id: 'other' }) })).toBe(
      false,
    );

    mutation.unmount();
    queryClient.clear();
  });

  it('invalidates delivery surfaces after package lifecycle hooks change package state', async () => {
    const fetchMock = installProductApiMock({
      [`POST /plan-revisions/${planRevision.id}/generate-packages`]: [],
      [`POST /plan-revisions/${planRevision.id}/execution-packages`]: {
        ...executionPackage,
        id: 'package-created-cache-refresh',
      },
      [`POST /execution-packages/${executionPackage.id}/mark-ready`]: {
        ...executionPackage,
        phase: 'ready',
        gate_state: 'not_submitted',
        version: executionPackage.version + 1,
      },
      [`POST /execution-packages/${executionPackage.id}/run`]: { run_session_id: 'run-cache-refresh' },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const generatePackages = renderHook(() => useGeneratePackagesMutation(planRevision.id), { wrapper });
    await generatePackages.result.current.mutateAsync();
    const createPackage = renderHook(() => useCreateExecutionPackageMutation(planRevision.id), { wrapper });
    await createPackage.result.current.mutateAsync({
      repo_id: executionPackage.repo_id,
      objective: executionPackage.objective,
      owner_actor_id: executionPackage.owner_actor_id,
      reviewer_actor_id: executionPackage.reviewer_actor_id,
      qa_owner_actor_id: executionPackage.qa_owner_actor_id,
      required_checks: executionPackage.required_checks,
      required_artifact_kinds: executionPackage.required_artifact_kinds,
      allowed_paths: executionPackage.allowed_paths,
      forbidden_paths: executionPackage.forbidden_paths,
    });
    const markReady = renderHook(() => useMarkPackageReadyMutation(executionPackage.id), { wrapper });
    await markReady.result.current.mutateAsync({ actor_id: actorId, expected_package_version: executionPackage.version });
    const runPackage = renderHook(() => useRunPackageMutation(executionPackage.id), { wrapper });
    await runPackage.result.current.mutateAsync({ actorId });

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/plan-revisions/${planRevision.id}/generate-packages`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/plan-revisions/${planRevision.id}/execution-packages`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/execution-packages/${executionPackage.id}/mark-ready`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/execution-packages/${executionPackage.id}/run`,
      expect.objectContaining({ method: 'POST' }),
    );
    expectDeliverySurfaceInvalidation(invalidateSpy);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.package(executionPackage.id) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.packageRuntimeReadiness(executionPackage.id) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.executionPackageReplay(executionPackage.id) });

    generatePackages.unmount();
    createPackage.unmount();
    markReady.unmount();
    runPackage.unmount();
    queryClient.clear();
  });

  it('invalidates release delivery surfaces after release scope links change', async () => {
    const fetchMock = installProductApiMock({
      [`POST /releases/${release.id}/work-items/${workItem.id}`]: {
        release_id: release.id,
        object_type: 'work_item',
        object_id: workItem.id,
        linked: true,
      },
      [`DELETE /releases/${release.id}/work-items/${workItem.id}`]: {
        release_id: release.id,
        object_type: 'work_item',
        object_id: workItem.id,
        linked: false,
      },
      [`POST /releases/${release.id}/execution-packages/${executionPackage.id}`]: {
        release_id: release.id,
        object_type: 'execution_package',
        object_id: executionPackage.id,
        linked: true,
      },
      [`DELETE /releases/${release.id}/execution-packages/${executionPackage.id}`]: {
        release_id: release.id,
        object_type: 'execution_package',
        object_id: executionPackage.id,
        linked: false,
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const linkWorkItem = renderHook(() => useLinkReleaseWorkItemMutation(release.id), { wrapper });
    await linkWorkItem.result.current.mutateAsync({ workItemId: workItem.id, body: { actor_id: actorId } });
    const unlinkWorkItem = renderHook(() => useUnlinkReleaseWorkItemMutation(release.id), { wrapper });
    await unlinkWorkItem.result.current.mutateAsync({ workItemId: workItem.id, body: { actor_id: actorId } });
    const linkPackage = renderHook(() => useLinkReleaseExecutionPackageMutation(release.id), { wrapper });
    await linkPackage.result.current.mutateAsync({ packageId: executionPackage.id, body: { actor_id: actorId } });
    const unlinkPackage = renderHook(() => useUnlinkReleaseExecutionPackageMutation(release.id), { wrapper });
    await unlinkPackage.result.current.mutateAsync({ packageId: executionPackage.id, body: { actor_id: actorId } });

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/releases/${release.id}/work-items/${workItem.id}`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/releases/${release.id}/work-items/${workItem.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/releases/${release.id}/execution-packages/${executionPackage.id}`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/releases/${release.id}/execution-packages/${executionPackage.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.releaseCockpit(release.id) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.releaseReplay(release.id) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['releases'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['packages'] });
    expectDeliverySurfaceInvalidation(invalidateSpy);

    linkWorkItem.unmount();
    unlinkWorkItem.unmount();
    linkPackage.unmount();
    unlinkPackage.unmount();
    queryClient.clear();
  });

  it('invalidates related product caches when ProductAction command mutations fail', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Package generation failed' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const action = {
      id: 'generate-packages-plan-rev-product-action',
      lane_id: 'requirements',
      priority: 'primary',
      label: 'Generate packages',
      enabled: true,
      kind: 'command',
      command: {
        type: 'generate_packages',
        object_type: 'plan_revision',
        object_id: 'plan-rev-product-action',
        scope_ref: { type: 'requirement', id: workItem.id },
        plan_revision_id: 'plan-rev-product-action',
      },
      target: {
        kind: 'object',
        object_type: 'plan_revision',
        object_id: 'plan-rev-product-action',
        href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
      },
    } as const;

    const mutation = renderHook(() => useProductActionCommandMutation({ projectId, action }), { wrapper });
    await expect(mutation.result.current.mutateAsync()).rejects.toThrow('Package generation failed');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/plan-revisions/plan-rev-product-action/generate-packages',
      expect.objectContaining({ method: 'POST' }),
    );
    expectWorkItemCockpitInvalidation(invalidateSpy.mock.calls, workItem.id);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.planRevision('plan-rev-product-action') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['packages'] });

    const productLanePredicateCall = invalidateSpy.mock.calls.find(
      ([input]) => typeof input.predicate === 'function',
    )?.[0] as { predicate?: (query: { queryKey: readonly unknown[] }) => boolean } | undefined;
    expect(productLanePredicateCall?.predicate?.({ queryKey: queryKeys.productLane('requirements', { project_id: projectId }) })).toBe(
      true,
    );

    mutation.unmount();
    queryClient.clear();
  });

  it('invalidates item-scoped draft resources for standalone draft hooks', async () => {
    const developmentPlanId = 'development-plan-web-product';
    const itemId = 'development-plan-item-web-product';
    const fetchMock = installProductApiMock({
      [`POST /development-plans/${developmentPlanId}/items/${itemId}/spec/generate-draft`]: {
        id: 'spec-rev-product-action',
        spec_id: 'spec-product-action',
        development_plan_item_id: itemId,
        revision_number: 2,
        summary: 'Generated spec draft',
        content: 'Spec draft',
        background: 'Background',
        goals: ['Goal'],
        scope_in: ['Scope'],
        scope_out: [],
        acceptance_criteria: ['Criteria'],
        test_strategy_summary: 'Test strategy',
      },
      [`POST /development-plans/${developmentPlanId}/items/${itemId}/execution-plan/generate-draft`]: {
        id: 'execution-plan-rev-product-action',
        execution_plan_id: 'execution-plan-product-action',
        development_plan_item_id: itemId,
        based_on_spec_revision_id: 'spec-rev-product-action',
        revision_number: 2,
        summary: 'Generated execution plan draft',
        content: 'Execution plan draft',
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const specMutation = renderHook(() => useGenerateItemSpecDraftMutation({ developmentPlanId, itemId }), { wrapper });
    await specMutation.result.current.mutateAsync();
    const planMutation = renderHook(() => useGenerateItemExecutionPlanDraftMutation({ developmentPlanId, itemId }), { wrapper });
    await planMutation.result.current.mutateAsync();

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/development-plans/${developmentPlanId}/items/${itemId}/spec/generate-draft`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/development-plans/${developmentPlanId}/items/${itemId}/execution-plan/generate-draft`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['development-plans'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['development-plan', developmentPlanId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['development-plan-item', developmentPlanId, itemId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['development-plan-item-revisions', developmentPlanId, itemId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['spec-execution-plan-queue'] });

    specMutation.unmount();
    planMutation.unmount();
    queryClient.clear();
  });

  it('submits, approves, and requests Spec changes through item-scoped lifecycle hooks with actor headers', async () => {
    const developmentPlanId = 'development-plan-web-product';
    const itemId = 'development-plan-item-web-product';
    const fetchMock = installProductApiMock({
      [`POST /development-plans/${developmentPlanId}/items/${itemId}/spec/submit-for-approval`]: {
        id: 'spec-1',
        entity_type: 'spec',
        scope_ref: workItemScopeRef,
        status: 'in_review',
        editing_state: 'locked',
        gate_state: 'awaiting_approval',
        resolution: 'none',
        current_revision_id: 'spec-rev-1',
      },
      [`POST /development-plans/${developmentPlanId}/items/${itemId}/spec/approve`]: {
        id: 'spec-1',
        entity_type: 'spec',
        scope_ref: workItemScopeRef,
        status: 'approved',
        editing_state: 'locked',
        gate_state: 'approved',
        resolution: 'approved',
        current_revision_id: 'spec-rev-1',
        approved_revision_id: 'spec-rev-1',
      },
      [`POST /development-plans/${developmentPlanId}/items/${itemId}/spec/request-changes`]: {
        id: 'spec-1',
        entity_type: 'spec',
        scope_ref: workItemScopeRef,
        status: 'changes_requested',
        editing_state: 'editable',
        gate_state: 'changes_requested',
        resolution: 'changes_requested',
        current_revision_id: 'spec-rev-1',
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const submit = renderHook(() => useSubmitItemSpecForApprovalMutation({ developmentPlanId, itemId }), { wrapper });
    await submit.result.current.mutateAsync({ actor_id: 'actor-owner' });

    const approve = renderHook(() => useApproveItemSpecMutation({ developmentPlanId, itemId }), { wrapper });
    await approve.result.current.mutateAsync({ actor_id: 'actor-reviewer', rationale: 'Spec approved for implementation.' });

    const requestChanges = renderHook(() => useRequestItemSpecChangesMutation({ developmentPlanId, itemId }), { wrapper });
    await requestChanges.result.current.mutateAsync({ actor_id: 'actor-reviewer', rationale: 'Clarify acceptance criteria.' });

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/development-plans/${developmentPlanId}/items/${itemId}/spec/submit-for-approval`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-owner' }),
        body: JSON.stringify({ actor_id: 'actor-owner' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/development-plans/${developmentPlanId}/items/${itemId}/spec/approve`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-reviewer' }),
        body: JSON.stringify({ actor_id: 'actor-reviewer', rationale: 'Spec approved for implementation.' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/development-plans/${developmentPlanId}/items/${itemId}/spec/request-changes`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-reviewer' }),
        body: JSON.stringify({ actor_id: 'actor-reviewer', rationale: 'Clarify acceptance criteria.' }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['development-plan', developmentPlanId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['development-plan-item', developmentPlanId, itemId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['development-plan-item-revisions', developmentPlanId, itemId] });

    queryClient.clear();
  });

  it('submits, approves, and requests Execution Plan changes through item-scoped lifecycle hooks', async () => {
    const developmentPlanId = 'development-plan-web-product';
    const itemId = 'development-plan-item-web-product';
    const fetchMock = installProductApiMock({
      [`POST /development-plans/${developmentPlanId}/items/${itemId}/execution-plan/submit-for-approval`]: {
        id: 'execution-plan-1',
        development_plan_item_id: itemId,
        status: 'in_review',
        current_revision_id: 'execution-plan-rev-1',
      },
      [`POST /development-plans/${developmentPlanId}/items/${itemId}/execution-plan/approve`]: {
        id: 'execution-plan-1',
        development_plan_item_id: itemId,
        status: 'approved',
        current_revision_id: 'execution-plan-rev-approved',
        approved_revision_id: 'execution-plan-rev-approved',
        approved_at: '2026-05-19T08:00:00.000Z',
        approved_by_actor_id: 'actor-reviewer',
      },
      [`POST /development-plans/${developmentPlanId}/items/${itemId}/execution-plan/request-changes`]: {
        id: 'execution-plan-1',
        development_plan_item_id: itemId,
        status: 'changes_requested',
        current_revision_id: 'execution-plan-rev-approved',
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await queryClient.prefetchQuery({
      queryKey: ['packages', { project_id: projectId, plan_revision_id: 'plan-rev-approved' }],
      queryFn: async () => ({ items: [], degraded_sources: [] }),
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const submit = renderHook(() => useSubmitItemExecutionPlanForApprovalMutation({ developmentPlanId, itemId }), { wrapper });
    await submit.result.current.mutateAsync({ actor_id: 'actor-owner' });

    const approve = renderHook(() => useApproveItemExecutionPlanMutation({ developmentPlanId, itemId }), { wrapper });
    await approve.result.current.mutateAsync({ actor_id: 'actor-reviewer', rationale: 'Plan approved for execution.' });

    const requestChanges = renderHook(() => useRequestItemExecutionPlanChangesMutation({ developmentPlanId, itemId }), { wrapper });
    await requestChanges.result.current.mutateAsync({ actor_id: 'actor-reviewer', rationale: 'Split rollout checks.' });

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/development-plans/${developmentPlanId}/items/${itemId}/execution-plan/submit-for-approval`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-owner' }),
        body: JSON.stringify({ actor_id: 'actor-owner' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/development-plans/${developmentPlanId}/items/${itemId}/execution-plan/approve`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-reviewer' }),
        body: JSON.stringify({ actor_id: 'actor-reviewer', rationale: 'Plan approved for execution.' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/development-plans/${developmentPlanId}/items/${itemId}/execution-plan/request-changes`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-reviewer' }),
        body: JSON.stringify({ actor_id: 'actor-reviewer', rationale: 'Split rollout checks.' }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['development-plan', developmentPlanId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['development-plan-item', developmentPlanId, itemId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['development-plan-item-revisions', developmentPlanId, itemId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['packages'] });

    queryClient.clear();
  });
});
