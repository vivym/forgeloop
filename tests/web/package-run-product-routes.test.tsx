// @vitest-environment jsdom

import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderRoute } from './router-test-utils';
import type { RunEvent } from '../../apps/web/src/shared/api/types';
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
    worker_id: 'worker-web-product',
    worker_lease_status: 'active',
    codex_thread_id: 'thread-web-product',
    active_turn_id: 'turn-web-product',
    effective_dangerous_mode: 'confirmed',
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

  it('reports invalid package boolean filters without silently sending false', async () => {
    const screen = await renderRoute('/packages?blocked=nope', {
      apiOverrides: {
        [`GET /query/execution-packages?project_id=${projectId}&limit=100`]: packageListResponse,
      },
    });

    await waitFor(() => expect(screen.getByText(executionPackage.objective)).toBeTruthy());

    expect(screen.getByText(/blocked is not applied to the package inventory yet/i)).toBeTruthy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/execution-packages?project_id=${projectId}&limit=100`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('blocked=false'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('renders package detail actions from the resource endpoint without manual or Dev Tools copy', async () => {
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
    expect(screen.getAllByRole('button', { name: 'Create package' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/manual/i)).toBeNull();
    expect(screen.queryByText(/Dev Tools/i)).toBeNull();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/execution-packages/${executionPackage.id}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', true);
  });

  it('sends supported run filters and reports unsupported run filters', async () => {
    const screen = await renderRoute(
      `/runs?status=passed&execution_package_id=${executionPackage.id}&run_session_id=${runSession.id}&executor_type=mock&cursor=cursor-web&limit=25&work_item_id=${workItem.id}&risk=high`,
      {
        apiOverrides: {
          [`GET /query/runs?project_id=${projectId}&status=passed&executor_type=mock&execution_package_id=${executionPackage.id}&run_session_id=${runSession.id}&cursor=cursor-web&limit=25`]:
            runListResponse,
        },
      },
    );

    await waitFor(() => expect(screen.getByText(runSession.summary)).toBeTruthy());

    expect(screen.getByText(/work_item_id and risk are not applied to the run inventory yet/i)).toBeTruthy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/runs?project_id=${projectId}&status=passed&executor_type=mock&execution_package_id=${executionPackage.id}&run_session_id=${runSession.id}&cursor=cursor-web&limit=25`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining(`work_item_id=${workItem.id}`),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('risk=high'),
      expect.objectContaining({ method: 'GET' }),
    );
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
    expect(screen.getByText('Package')).toBeTruthy();
    expect(screen.getByText('Executor')).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('Stream')).toBeTruthy();
    expect(screen.getByText('Last event')).toBeTruthy();
    expect(screen.getByText('Current plan step')).toBeTruthy();
    expect(screen.queryByText('Thread')).toBeNull();
    expect(screen.queryByText('Turn')).toBeNull();
    expect(screen.queryByText('Danger mode')).toBeNull();
    expect(screen.queryByText('Worker lease')).toBeNull();
    expect(screen.queryByText(/thread-web-product/i)).toBeNull();
    expect(screen.queryByText(/turn-web-product/i)).toBeNull();
    expect(screen.queryByText(/worker-web-product/i)).toBeNull();
    expect(screen.queryByText(/confirmed/i)).toBeNull();
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

  it('keeps the live run event stream open after command-triggered backfill refreshes', async () => {
    const eventSources: MockEventSource[] = [];
    class MockEventSource {
      readonly url: string;
      readonly close = vi.fn(() => {
        this.closed = true;
      });
      onmessage?: (event: MessageEvent) => void;
      onerror?: (error: Event) => void;
      private closed = false;

      constructor(url: string) {
        this.url = url;
        eventSources.push(this);
      }

      emit(event: RunEvent) {
        if (!this.closed) {
          this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
        }
      }
    }
    vi.stubGlobal('EventSource', MockEventSource);
    const user = userEvent.setup();
    let backfillReadCount = 0;
    const screen = await renderRoute(`/runs/${runSession.id}`, {
      apiOverrides: {
        [`GET /run-sessions/${runSession.id}`]: runSession,
        [`GET /run-sessions/${runSession.id}/events`]: () => {
          backfillReadCount += 1;
          return backfillReadCount === 1
            ? runEventsResponse
            : {
                events: [
                  ...runEventsResponse.events,
                  {
                    id: 'event-backfill-after-command',
                    run_session_id: runSession.id,
                    sequence: 2,
                    cursor: '0000000002',
                    event_type: 'agent_message',
                    visibility: 'public',
                    summary: 'Backfilled event after command refresh.',
                    payload: { message: 'Backfilled event after command refresh.' },
                    created_at: '2026-05-18T00:24:34.000Z',
                  },
                ],
                next_cursor: '0000000002',
              };
        },
        [`POST /run-sessions/${runSession.id}/events/stream-token`]: {
          token: 'stream-token-route-test',
          expires_at: '2026-05-18T00:30:00.000Z',
        },
        [`POST /run-sessions/${runSession.id}/input`]: {
          accepted: true,
        },
      },
    });

    await waitFor(() => expect(screen.getByText('Applied package changes and started checks.')).toBeTruthy());
    await waitFor(() => expect(eventSources.length).toBe(1));

    await user.type(screen.getByTestId('run-console-input'), 'Continue with verification');
    await user.click(screen.getByTestId('run-console-send'));

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/run-sessions/${runSession.id}/input`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() => {
      const backfillReads = vi.mocked(globalThis.fetch).mock.calls.filter(([input, init]) => {
        const url = String(input);
        return url.endsWith(`/run-sessions/${runSession.id}/events`) && (init as RequestInit | undefined)?.method === 'GET';
      });
      expect(backfillReads.length).toBeGreaterThanOrEqual(2);
    });

    expect(eventSources[0]?.close).not.toHaveBeenCalled();

    eventSources[0]?.emit({
      id: 'event-live-after-command',
      run_session_id: runSession.id,
      sequence: 3,
      cursor: '0000000003',
      event_type: 'agent_message',
      visibility: 'public',
      summary: 'Live event after command refresh.',
      payload: { message: 'Live event after command refresh.' },
      created_at: '2026-05-18T00:24:35.000Z',
    });

    await waitFor(() => expect(screen.getByText('Live event after command refresh.')).toBeTruthy());
  });
});
