// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { productRoleToWorkbenchId } from '../../apps/web/src/features/role-workbench/role-labels';
import { usePipelineQuery, useSpecsQuery, useWorkItemsQuery } from '../../apps/web/src/shared/api/hooks';
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

  it('maps product role labels to backend workbench ids without leaking Intake', () => {
    expect(productRoleToWorkbenchId('Work Item Owner')).toBe('intake');
  });
});
