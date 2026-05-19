// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { productRoleToWorkbenchId } from '../../apps/web/src/features/role-workbench/role-labels';
import {
  useApprovePlanMutation,
  useApproveSpecMutation,
  usePipelineQuery,
  useRequestPlanChangesMutation,
  useRequestSpecChangesMutation,
  useSpecsQuery,
  useSubmitPlanForApprovalMutation,
  useSubmitSpecForApprovalMutation,
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
    expect(queryKeys.workbench({ role: 'work-item-owner', projectId: 'proj' })).toEqual([
      'workbench',
      'intake',
      { project_id: 'proj' },
    ]);
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

  it('includes response-affecting workbench query inputs in stable cache keys', () => {
    const workItemOwnerKey = queryKeys.workbench({
      role: 'work-item-owner',
      query: {
        status: 'ready',
        project_id: 'proj',
        actor_id: 'actor-owner',
        kind: 'bug',
        limit: 25,
        cursor: 'cursor-1',
        phase: 'triage',
        risk: 'high',
      },
    });
    const sameQueryDifferentPropertyOrder = queryKeys.workbench({
      role: 'work-item-owner',
      query: {
        risk: 'high',
        phase: 'triage',
        cursor: 'cursor-1',
        limit: 25,
        kind: 'bug',
        actor_id: 'actor-owner',
        project_id: 'proj',
        status: 'ready',
      },
    });
    const changedActorKey = queryKeys.workbench({
      role: 'work-item-owner',
      query: {
        project_id: 'proj',
        actor_id: 'actor-reviewer',
        kind: 'bug',
        limit: 25,
        cursor: 'cursor-1',
        phase: 'triage',
        status: 'ready',
        risk: 'high',
      },
    });

    expect(workItemOwnerKey).toEqual(sameQueryDifferentPropertyOrder);
    expect(workItemOwnerKey).not.toEqual(changedActorKey);
    expect(workItemOwnerKey).toEqual([
      'workbench',
      'intake',
      {
        project_id: 'proj',
        actor_id: 'actor-owner',
        kind: 'bug',
        limit: 25,
        cursor: 'cursor-1',
        phase: 'triage',
        status: 'ready',
        risk: 'high',
      },
    ]);
    expect(Object.keys(workItemOwnerKey[2] as Record<string, unknown>)).toEqual([
      'project_id',
      'actor_id',
      'kind',
      'limit',
      'cursor',
      'phase',
      'status',
      'risk',
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

  it('maps product role labels to backend workbench ids without leaking Intake', () => {
    expect(productRoleToWorkbenchId('Work Item Owner')).toBe('intake');
  });
});
