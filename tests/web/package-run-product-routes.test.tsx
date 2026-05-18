// @vitest-environment jsdom

import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderRoute } from './router-test-utils';
import { executionPackage, planRevision, projectId, runSession, timeline, workItem } from './fixtures/product-data';

const packageListResponse = {
  items: [
    {
      id: executionPackage.id,
      object: {
        type: 'execution_package',
        id: executionPackage.id,
        title: executionPackage.objective,
      },
      title: executionPackage.objective,
      phase: executionPackage.phase,
      risk: workItem.risk,
      owner_actor_id: executionPackage.owner_actor_id,
      reviewer_actor_id: executionPackage.reviewer_actor_id,
      qa_owner_actor_id: executionPackage.qa_owner_actor_id,
      parent: {
        type: 'work_item',
        id: workItem.id,
        title: workItem.title,
      },
      related: [
        {
          type: 'run_session',
          id: runSession.id,
          title: runSession.summary,
        },
      ],
      revision_state: {
        current_revision_id: executionPackage.plan_revision_id,
      },
      counts: {},
      updated_at: executionPackage.updated_at,
      package_state: {
        work_item_id: workItem.id,
        plan_revision_id: executionPackage.plan_revision_id,
        surface_type: 'web',
        last_run_session_id: runSession.id,
      },
    },
  ],
  degraded_sources: [],
};

const runListResponse = {
  items: [
    {
      id: runSession.id,
      object: {
        type: 'run_session',
        id: runSession.id,
        title: runSession.summary,
      },
      title: runSession.summary,
      status: runSession.status,
      owner_actor_id: runSession.requested_by_actor_id,
      parent: {
        type: 'execution_package',
        id: executionPackage.id,
        title: executionPackage.objective,
      },
      related: [],
      revision_state: {},
      counts: {},
      updated_at: runSession.updated_at,
      run_state: {
        executor_type: runSession.executor_type,
        execution_package_id: executionPackage.id,
      },
    },
  ],
  degraded_sources: [],
};

const runEventsResponse = {
  events: [
    {
      id: 'event-1',
      run_session_id: runSession.id,
      sequence: '0000000001',
      event_type: 'agent_message',
      visibility: 'public',
      summary: 'Applied package changes and started checks.',
      created_at: '2026-05-18T00:24:30.000Z',
      payload: { raw_payload: 'debug-only-secret' },
    },
  ],
  next_cursor: '0000000001',
};

const runSessionWithDebugMetadata = {
  ...runSession,
  runtime_metadata: {
    worker_lease_id: 'lease-web-product',
    thread_id: 'thread-web-product',
    turn_id: 'turn-web-product',
    current_plan_step: 'Run verification',
    raw_payload: 'debug-only-secret',
  },
};

describe('package and run product routes', () => {
  it('uses the product Execution Package list endpoint with supported filters', async () => {
    const screen = await renderRoute(
      `/packages?work_item_id=${workItem.id}&plan_revision_id=${planRevision.id}&phase=ready&status=ready&gate_state=open&resolution=unresolved&blocked=true`,
      {
        apiOverrides: {
          [`GET /query/execution-packages?project_id=${projectId}&work_item_id=${workItem.id}&plan_revision_id=${planRevision.id}&phase=ready&status=ready&gate_state=open&resolution=unresolved&blocked=true&limit=100`]:
            packageListResponse,
        },
      },
    );

    await waitFor(() => expect(screen.getByText(executionPackage.objective)).toBeTruthy());

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/execution-packages?project_id=${projectId}&work_item_id=${workItem.id}&plan_revision_id=${planRevision.id}&phase=ready&status=ready&gate_state=open&resolution=unresolved&blocked=true&limit=100`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reports unsupported package filters without sending them to the product endpoint', async () => {
    const screen = await renderRoute('/packages?surface_type=web&risk=high', {
      apiOverrides: {
        [`GET /query/execution-packages?project_id=${projectId}&limit=100`]: packageListResponse,
      },
    });

    await waitFor(() => expect(screen.getByText(executionPackage.objective)).toBeTruthy());

    expect(screen.getByText(/surface_type and risk are not applied to the package inventory yet/i)).toBeTruthy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/execution-packages?project_id=${projectId}&limit=100`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('surface_type=web'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('risk=high'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('renders package detail actions outside Dev Tools from the resource endpoint', async () => {
    const screen = await renderRoute(`/packages/${executionPackage.id}?plan_revision_id=${planRevision.id}`, {
      apiOverrides: {
        [`GET /execution-packages/${executionPackage.id}`]: executionPackage,
        [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      },
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy());

    expect(screen.getByRole('button', { name: 'Force rerun' })).toBeTruthy();
    expect(screen.getByText('Timeline / Replay')).toBeTruthy();
    expect(screen.getByText('Generate packages from this PlanRevision')).toBeTruthy();
    expect(screen.getByText('Create manual package')).toBeTruthy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/execution-packages/${executionPackage.id}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', true);
  });

  it('uses the product Runs list endpoint and links rows to run detail pages', async () => {
    const screen = await renderRoute('/runs', {
      apiOverrides: {
        [`GET /query/runs?project_id=${projectId}&limit=100`]: runListResponse,
      },
    });

    await waitFor(() => expect(screen.getByText(runSession.summary)).toBeTruthy());

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/runs?project_id=${projectId}&limit=100`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByRole('link', { name: /Open run/i }).getAttribute('href')).toBe(`/runs/${runSession.id}`);
  });

  it('renders run command center without raw debug metadata by default', async () => {
    const screen = await renderRoute(`/runs/${runSession.id}`, {
      apiOverrides: {
        [`GET /run-sessions/${runSession.id}`]: runSessionWithDebugMetadata,
        [`GET /run-sessions/${runSession.id}/events`]: runEventsResponse,
      },
    });

    await waitFor(() => expect(screen.getByText('Applied package changes and started checks.')).toBeTruthy());

    expect(screen.getAllByText('Run Console').length).toBeGreaterThan(0);
    expect(screen.queryByText(/raw payload/i)).toBeNull();
    expect(screen.queryByText(/debug-only-secret/i)).toBeNull();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/run-sessions/${runSession.id}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/run-sessions/${runSession.id}/events`,
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
