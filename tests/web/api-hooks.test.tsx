// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import {
  useApprovePlanMutation,
  useApproveSpecMutation,
  useGeneratePlanDraftMutation,
  useGenerateSpecDraftMutation,
  usePipelineQuery,
  useProductActionCommandMutation,
  useProductLaneQuery,
  useRequestPlanChangesMutation,
  useRequestSpecChangesMutation,
  useSpecsQuery,
  useSubmitPlanForApprovalMutation,
  useSubmitSpecForApprovalMutation,
  useWorkItemActionsQuery,
  useWorkItemsQuery,
} from '../../apps/web/src/shared/api/hooks';
import { queryKeys } from '../../apps/web/src/shared/api/query-keys';
import { installProductApiMock } from './fixtures/product-api-mock';
import { projectId, workItem } from './fixtures/product-data';

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
    expect(queryKeys.workItemActions('wi_1', 'bugs')).toEqual(['work-item-actions', 'wi_1', { lane: 'bugs' }]);
    expect(queryKeys.specReplay('spec-1')).toEqual(['spec-replay', 'spec-1']);
    expect(queryKeys.planReplay('plan-1')).toEqual(['plan-replay', 'plan-1']);
  });

  it('includes response-affecting Spec registry filters in stable cache keys', () => {
    expect(
      queryKeys.specs({
        project_id: 'proj',
        status: 'approved',
        limit: 100,
        cursor: 'cursor-1',
      }),
    ).toEqual(['specs', { project_id: 'proj', status: 'approved', limit: 100, cursor: 'cursor-1' }]);
  });

  it('includes response-affecting Product Lane query inputs in stable cache keys', () => {
    const bugsLaneKey = queryKeys.productLane('bugs', {
      status: 'ready',
      project_id: 'proj',
      actor_id: 'actor-owner',
      owner_actor_id: 'actor-owner',
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
      owner_actor_id: 'actor-owner',
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
        owner_actor_id: 'actor-owner',
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
      'owner_actor_id',
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

  it('uses the command API work item list endpoint for work item list hooks', async () => {
    const fetchMock = installProductApiMock();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(() => useWorkItemsQuery(projectId), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]?.id).toBe(workItem.id);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/work-items?project_id=${projectId}`,
      expect.objectContaining({ method: 'GET' }),
    );

    unmount();
    queryClient.clear();
  });

  it('passes Spec registry filters through the product query endpoint', async () => {
    const fetchMock = installProductApiMock({
      [`GET /query/specs?project_id=${projectId}&status=approved&limit=100`]: {
        items: [],
        degraded_sources: [],
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(
      () => useSpecsQuery({ project_id: projectId, status: 'approved', limit: 100 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/specs?project_id=${projectId}&status=approved&limit=100`,
      expect.objectContaining({ method: 'GET' }),
    );

    unmount();
    queryClient.clear();
  });

  it('fetches Product Lane and Work Item actions through shared hooks', async () => {
    const fetchMock = installProductApiMock({
      [`GET /query/product-lanes/bugs?project_id=${projectId}&actor_id=actor-owner&blocked=true`]: {
        lane_id: 'bugs',
        label: 'Bugs',
        description: 'Bug work items that need attention.',
        items: [
          {
            id: workItem.id,
            title: workItem.title,
            object: { type: 'work_item', id: workItem.id },
            kind: 'bug',
            updated_at: workItem.updated_at,
            actions: [],
          },
        ],
        unsupported_filters: [],
        summary: { total: 1, blocked: 0, high_risk: 0, stale: 0 },
      },
      [`GET /query/work-items/${workItem.id}/actions?lane=bugs`]: {
        work_item_id: workItem.id,
        lane_id: 'bugs',
        default_lane_id: 'requirements',
        actions: [],
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
    const actions = renderHook(() => useWorkItemActionsQuery(workItem.id, 'bugs'), { wrapper });

    await waitFor(() => expect(lane.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(actions.result.current.isSuccess).toBe(true));

    expect(lane.result.current.data?.lane_id).toBe('bugs');
    expect(actions.result.current.data?.lane_id).toBe('bugs');
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/product-lanes/bugs?project_id=${projectId}&actor_id=actor-owner&blocked=true`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/query/work-items/${workItem.id}/actions?lane=bugs`,
      expect.objectContaining({ method: 'GET' }),
    );

    lane.unmount();
    actions.unmount();
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
        work_item_id: workItem.id,
        plan_revision_id: 'plan-rev-product-action',
      },
      target: {
        kind: 'object',
        object_type: 'plan_revision',
        object_id: 'plan-rev-product-action',
        href: '/plans/plan-1',
      },
    } as const;

    const mutation = renderHook(() => useProductActionCommandMutation({ projectId, action }), { wrapper });
    await mutation.result.current.mutateAsync();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/plan-revisions/plan-rev-product-action/generate-packages',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.workItemCockpit(workItem.id) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['work-item-actions', workItem.id] });
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
        work_item_id: workItem.id,
        plan_revision_id: 'plan-rev-product-action',
      },
      target: {
        kind: 'object',
        object_type: 'plan_revision',
        object_id: 'plan-rev-product-action',
        href: '/plans/plan-1',
      },
    } as const;

    const mutation = renderHook(() => useProductActionCommandMutation({ projectId, action }), { wrapper });
    await expect(mutation.result.current.mutateAsync()).rejects.toThrow('Package generation failed');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/plan-revisions/plan-rev-product-action/generate-packages',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.workItemCockpit(workItem.id) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['work-item-actions', workItem.id] });
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

  it('invalidates generated draft child lists for ProductAction draft commands', async () => {
    const fetchMock = installProductApiMock({
      'POST /specs/spec-product-action/generate-draft': {
        id: 'spec-rev-product-action',
        spec_id: 'spec-product-action',
        work_item_id: workItem.id,
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
      'POST /plans/plan-product-action/generate-draft': {
        id: 'plan-rev-product-action',
        plan_id: 'plan-product-action',
        work_item_id: workItem.id,
        revision_number: 2,
        summary: 'Generated plan draft',
        content: 'Plan draft',
        implementation_summary: 'Implementation',
        split_strategy: 'Single package',
        test_matrix: ['Vitest'],
        rollback_notes: 'Revert',
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const specAction = {
      id: 'generate-spec-draft',
      lane_id: 'requirements',
      priority: 'primary',
      label: 'Generate spec draft',
      enabled: true,
      kind: 'command',
      command: {
        type: 'generate_spec_draft',
        object_type: 'spec',
        object_id: 'spec-product-action',
        work_item_id: workItem.id,
        spec_id: 'spec-product-action',
      },
    } as const;
    const planAction = {
      id: 'generate-plan-draft',
      lane_id: 'requirements',
      priority: 'primary',
      label: 'Generate plan draft',
      enabled: true,
      kind: 'command',
      command: {
        type: 'generate_plan_draft',
        object_type: 'plan',
        object_id: 'plan-product-action',
        work_item_id: workItem.id,
        plan_id: 'plan-product-action',
      },
    } as const;

    const specMutation = renderHook(() => useProductActionCommandMutation({ projectId, action: specAction }), { wrapper });
    await specMutation.result.current.mutateAsync();
    const planMutation = renderHook(() => useProductActionCommandMutation({ projectId, action: planAction }), { wrapper });
    await planMutation.result.current.mutateAsync();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/specs/spec-product-action/generate-draft',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/plans/plan-product-action/generate-draft',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.specRevisions('spec-product-action') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.planRevisions('plan-product-action') });

    specMutation.unmount();
    planMutation.unmount();
    queryClient.clear();
  });

  it('invalidates generated draft child lists for standalone draft hooks', async () => {
    const fetchMock = installProductApiMock({
      'POST /specs/spec-product-action/generate-draft': {
        id: 'spec-rev-product-action',
        spec_id: 'spec-product-action',
        work_item_id: workItem.id,
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
      'POST /plans/plan-product-action/generate-draft': {
        id: 'plan-rev-product-action',
        plan_id: 'plan-product-action',
        work_item_id: workItem.id,
        revision_number: 2,
        summary: 'Generated plan draft',
        content: 'Plan draft',
        implementation_summary: 'Implementation',
        split_strategy: 'Single package',
        test_matrix: ['Vitest'],
        rollback_notes: 'Revert',
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const specMutation = renderHook(
      () => useGenerateSpecDraftMutation({ workItemId: workItem.id, specId: 'spec-product-action' }),
      { wrapper },
    );
    await specMutation.result.current.mutateAsync();
    const planMutation = renderHook(
      () => useGeneratePlanDraftMutation({ workItemId: workItem.id, planId: 'plan-product-action' }),
      { wrapper },
    );
    await planMutation.result.current.mutateAsync();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/specs/spec-product-action/generate-draft',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/plans/plan-product-action/generate-draft',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.workItemCockpit(workItem.id) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.specRevisions('spec-product-action') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.planRevisions('plan-product-action') });

    specMutation.unmount();
    planMutation.unmount();
    queryClient.clear();
  });

  it('submits, approves, and requests Spec changes through lifecycle hooks with actor headers', async () => {
    const fetchMock = installProductApiMock({
      'POST /specs/spec-1/submit-for-approval': {
        id: 'spec-1',
        entity_type: 'spec',
        work_item_id: workItem.id,
        status: 'in_review',
        editing_state: 'locked',
        gate_state: 'awaiting_approval',
        resolution: 'none',
        current_revision_id: 'spec-rev-1',
      },
      'POST /specs/spec-1/approve': {
        id: 'spec-1',
        entity_type: 'spec',
        work_item_id: workItem.id,
        status: 'approved',
        editing_state: 'locked',
        gate_state: 'approved',
        resolution: 'approved',
        current_revision_id: 'spec-rev-1',
        approved_revision_id: 'spec-rev-1',
      },
      'POST /specs/spec-1/request-changes': {
        id: 'spec-1',
        entity_type: 'spec',
        work_item_id: workItem.id,
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

    const submit = renderHook(() => useSubmitSpecForApprovalMutation({ specId: 'spec-1', workItemId: workItem.id }), {
      wrapper,
    });
    await submit.result.current.mutateAsync({ actor_id: 'actor-owner' });

    const approve = renderHook(() => useApproveSpecMutation({ specId: 'spec-1', workItemId: workItem.id }), { wrapper });
    await approve.result.current.mutateAsync({ actor_id: 'actor-reviewer', rationale: 'Spec approved for implementation.' });

    const requestChanges = renderHook(() => useRequestSpecChangesMutation({ specId: 'spec-1', workItemId: workItem.id }), {
      wrapper,
    });
    await requestChanges.result.current.mutateAsync({ actor_id: 'actor-reviewer', rationale: 'Clarify acceptance criteria.' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/specs/spec-1/submit-for-approval',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-owner' }),
        body: JSON.stringify({ actor_id: 'actor-owner' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/specs/spec-1/approve',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-reviewer' }),
        body: JSON.stringify({ actor_id: 'actor-reviewer', rationale: 'Spec approved for implementation.' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/specs/spec-1/request-changes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-reviewer' }),
        body: JSON.stringify({ actor_id: 'actor-reviewer', rationale: 'Clarify acceptance criteria.' }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.spec('spec-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.specRevisions('spec-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.specReplay('spec-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['specs'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.workItemCockpit(workItem.id) });

    queryClient.clear();
  });

  it('submits, approves, and requests Plan changes through lifecycle hooks and refreshes packages after approval', async () => {
    const fetchMock = installProductApiMock({
      'POST /plans/plan-1/submit-for-approval': {
        id: 'plan-1',
        entity_type: 'plan',
        work_item_id: workItem.id,
        status: 'in_review',
        editing_state: 'locked',
        gate_state: 'awaiting_approval',
        resolution: 'none',
        current_revision_id: 'plan-rev-1',
      },
      'POST /plans/plan-1/approve': {
        id: 'plan-1',
        entity_type: 'plan',
        work_item_id: workItem.id,
        status: 'approved',
        editing_state: 'locked',
        gate_state: 'approved',
        resolution: 'approved',
        current_revision_id: 'plan-rev-approved',
        approved_revision_id: 'plan-rev-approved',
        approved_at: '2026-05-19T08:00:00.000Z',
        approved_by_actor_id: 'actor-reviewer',
      },
      'POST /plans/plan-1/request-changes': {
        id: 'plan-1',
        entity_type: 'plan',
        work_item_id: workItem.id,
        status: 'changes_requested',
        editing_state: 'editable',
        gate_state: 'changes_requested',
        resolution: 'changes_requested',
        current_revision_id: 'plan-rev-approved',
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await queryClient.prefetchQuery({
      queryKey: queryKeys.packages({ project_id: projectId, plan_revision_id: 'plan-rev-approved' }),
      queryFn: async () => ({ items: [], degraded_sources: [] }),
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const submit = renderHook(() => useSubmitPlanForApprovalMutation({ planId: 'plan-1', workItemId: workItem.id }), {
      wrapper,
    });
    await submit.result.current.mutateAsync({ actor_id: 'actor-owner' });

    const approve = renderHook(() => useApprovePlanMutation({ planId: 'plan-1', workItemId: workItem.id }), { wrapper });
    await approve.result.current.mutateAsync({ actor_id: 'actor-reviewer', rationale: 'Plan approved for execution.' });

    const requestChanges = renderHook(() => useRequestPlanChangesMutation({ planId: 'plan-1', workItemId: workItem.id }), {
      wrapper,
    });
    await requestChanges.result.current.mutateAsync({ actor_id: 'actor-reviewer', rationale: 'Split rollout checks.' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/plans/plan-1/submit-for-approval',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-owner' }),
        body: JSON.stringify({ actor_id: 'actor-owner' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/plans/plan-1/approve',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-reviewer' }),
        body: JSON.stringify({ actor_id: 'actor-reviewer', rationale: 'Plan approved for execution.' }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/plans/plan-1/request-changes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-reviewer' }),
        body: JSON.stringify({ actor_id: 'actor-reviewer', rationale: 'Split rollout checks.' }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.plan('plan-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.planRevisions('plan-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.planReplay('plan-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['plans'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.workItemCockpit(workItem.id) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['packages'] });

    queryClient.clear();
  });
});
