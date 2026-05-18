// @vitest-environment jsdom

import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderRoute } from './router-test-utils';
import type { RunEvent } from '../../apps/web/src/shared/api/types';
import { actorId, executionPackage, planRevision, projectId, runSession, timeline, workItem } from './fixtures/product-data';

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
    {
      id: 'event-thread',
      run_session_id: runSession.id,
      sequence: '0000000002',
      cursor: '0000000002',
      event_type: 'thread_started',
      visibility: 'public',
      summary: 'thread raw event should not render',
      created_at: '2026-05-18T00:24:31.000Z',
      payload: { thread_id: 'thread-web-product' },
    },
    {
      id: 'event-turn',
      run_session_id: runSession.id,
      sequence: '0000000003',
      cursor: '0000000003',
      event_type: 'turn_started',
      visibility: 'public',
      summary: 'turn raw event should not render',
      created_at: '2026-05-18T00:24:32.000Z',
      payload: { turn_id: 'turn-web-product' },
    },
  ],
  next_cursor: '0000000003',
};

const executionPackageWithoutRun = {
  ...executionPackage,
  last_run_session_id: undefined,
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

  it('passes supported package cursor and limit filters to the product endpoint', async () => {
    const screen = await renderRoute(`/packages?cursor=cursor-web&limit=25`, {
      apiOverrides: {
        [`GET /query/execution-packages?project_id=${projectId}&cursor=cursor-web&limit=25`]: packageListResponse,
      },
    });

    await waitFor(() => expect(screen.getByText(executionPackage.objective)).toBeTruthy());

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/execution-packages?project_id=${projectId}&cursor=cursor-web&limit=25`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reports invalid package limits without sending the invalid value', async () => {
    const screen = await renderRoute('/packages?cursor=cursor-web&limit=200', {
      apiOverrides: {
        [`GET /query/execution-packages?project_id=${projectId}&cursor=cursor-web&limit=100`]: packageListResponse,
      },
    });

    await waitFor(() => expect(screen.getByText(executionPackage.objective)).toBeTruthy());

    expect(screen.getByText(/limit is not applied to the package inventory yet/i)).toBeTruthy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/execution-packages?project_id=${projectId}&cursor=cursor-web&limit=100`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('limit=200'),
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

  it('generates packages from PlanRevision context through the product action', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/packages?plan_revision_id=${planRevision.id}`, {
      apiOverrides: {
        [`GET /query/execution-packages?project_id=${projectId}&plan_revision_id=${planRevision.id}&limit=100`]: packageListResponse,
        [`POST /plan-revisions/${planRevision.id}/generate-packages`]: [executionPackage],
      },
    });

    const generate = await screen.findByRole('button', { name: 'Generate packages' });
    expect(generate).toHaveProperty('disabled', false);

    await user.click(generate);

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/plan-revisions/${planRevision.id}/generate-packages`,
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('creates a package from PlanRevision context with product form fields', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/packages?plan_revision_id=${planRevision.id}`, {
      apiOverrides: {
        [`GET /query/execution-packages?project_id=${projectId}&plan_revision_id=${planRevision.id}&limit=100`]: packageListResponse,
        [`POST /plan-revisions/${planRevision.id}/execution-packages`]: executionPackage,
      },
    });

    const create = await screen.findByRole('button', { name: 'Create package' });
    expect(create).toHaveProperty('disabled', false);

    await user.click(create);
    await user.type(screen.getByLabelText('Repository'), 'forgeloop');
    await user.type(screen.getByLabelText('Objective'), 'Ship product package actions');
    await user.type(screen.getByLabelText('Owner'), 'actor-execution-owner');
    await user.type(screen.getByLabelText('Reviewer'), 'actor-reviewer');
    await user.type(screen.getByLabelText('QA owner'), 'actor-qa');
    await user.type(screen.getByLabelText('Check id'), 'web-typecheck');
    await user.type(screen.getByLabelText('Check name'), 'Web typecheck');
    await user.type(screen.getByLabelText('Check command'), 'pnpm --filter @forgeloop/web typecheck');
    await user.clear(screen.getByLabelText('Timeout seconds'));
    await user.type(screen.getByLabelText('Timeout seconds'), '600');
    await user.type(screen.getByLabelText('Required artifacts'), 'diff\ncheck_output');
    await user.type(screen.getByLabelText('Allowed paths'), 'apps/web/**\ntests/web/**');
    await user.type(screen.getByLabelText('Forbidden paths'), 'apps/control-plane-api/**');
    await user.click(screen.getByRole('button', { name: 'Create execution package' }));

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/plan-revisions/${planRevision.id}/execution-packages`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            repo_id: 'forgeloop',
            objective: 'Ship product package actions',
            owner_actor_id: 'actor-execution-owner',
            reviewer_actor_id: 'actor-reviewer',
            qa_owner_actor_id: 'actor-qa',
            required_checks: [
              {
                check_id: 'web-typecheck',
                display_name: 'Web typecheck',
                command: 'pnpm --filter @forgeloop/web typecheck',
                timeout_seconds: 600,
                blocks_review: true,
              },
            ],
            required_artifact_kinds: ['diff', 'check_output'],
            allowed_paths: ['apps/web/**', 'tests/web/**'],
            forbidden_paths: ['apps/control-plane-api/**'],
          }),
        }),
      ),
    );
  });

  it('renders package detail actions from the resource endpoint without internal copy', async () => {
    const productCopyPackage = {
      ...executionPackage,
      objective: 'Add product API foundation',
    };
    const screen = await renderRoute(`/packages/${executionPackage.id}?plan_revision_id=${planRevision.id}`, {
      apiOverrides: {
        [`GET /execution-packages/${executionPackage.id}`]: productCopyPackage,
        [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      },
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy());

    expect(screen.getByRole('button', { name: 'Force rerun' })).toBeTruthy();
    expect(screen.getByText('Timeline')).toBeTruthy();
    expect(screen.getByText('Generate packages')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create package' })).toBeTruthy();
    expect(screen.queryByText(/manual/i)).toBeNull();
    expect(screen.queryByText(/Dev Tools/i)).toBeNull();
    expect(screen.queryByText(/route-backed/i)).toBeNull();
    expect(screen.queryByText(/replay endpoint/i)).toBeNull();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/execution-packages/${executionPackage.id}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', true);
  });

  it('runs a package without sending workflow-only mode from the product route', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/packages/${executionPackage.id}`, {
      apiOverrides: {
        [`GET /execution-packages/${executionPackage.id}`]: executionPackage,
        [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
        [`POST /execution-packages/${executionPackage.id}/run`]: { run_session_id: runSession.id },
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Run' }));

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/execution-packages/${executionPackage.id}/run`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ execution_package_id: executionPackage.id }),
        }),
      ),
    );
    const runRequest = vi.mocked(globalThis.fetch).mock.calls.find(([input]) =>
      String(input).endsWith(`/execution-packages/${executionPackage.id}/run`),
    );
    expect(String((runRequest?.[1] as RequestInit | undefined)?.body)).not.toContain('workflow_only');
  });

  it('requires a previous run before force rerun is available', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/packages/${executionPackage.id}`, {
      apiOverrides: {
        [`GET /execution-packages/${executionPackage.id}`]: executionPackageWithoutRun,
        [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
      },
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Force rerun' })).toBeTruthy());
    await user.type(screen.getByLabelText('Force rerun reason'), 'Retry after infrastructure issue');

    expect(screen.getByText(/Force rerun is available after this package has a previous run/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Force rerun' })).toHaveProperty('disabled', true);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      `http://localhost:3000/execution-packages/${executionPackage.id}/force-rerun`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('force reruns with the previous run session id when reason and history are present', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/packages/${executionPackage.id}`, {
      apiOverrides: {
        [`GET /execution-packages/${executionPackage.id}`]: executionPackage,
        [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
        [`POST /execution-packages/${executionPackage.id}/force-rerun`]: { run_session_id: 'run-force-rerun' },
      },
    });

    await user.type(await screen.findByLabelText('Force rerun reason'), 'Retry after dependency recovery');
    const force = screen.getByRole('button', { name: 'Force rerun' });
    expect(force).toHaveProperty('disabled', false);
    await user.click(force);

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/execution-packages/${executionPackage.id}/force-rerun`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            execution_package_id: executionPackage.id,
            force: true,
            force_reason: 'Retry after dependency recovery',
            previous_run_session_id: executionPackage.last_run_session_id,
          }),
        }),
      ),
    );
  });

  it('edits package details through the package patch action', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/packages/${executionPackage.id}`, {
      apiOverrides: {
        [`GET /execution-packages/${executionPackage.id}`]: executionPackage,
        [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
        [`PATCH /execution-packages/${executionPackage.id}`]: {
          ...executionPackage,
          objective: 'Updated package objective',
        },
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Edit package details' }));
    await user.clear(screen.getByLabelText('Objective'));
    await user.type(screen.getByLabelText('Objective'), 'Updated package objective');
    await user.clear(screen.getByLabelText('Owner'));
    await user.type(screen.getByLabelText('Owner'), actorId);
    await user.click(screen.getByRole('button', { name: 'Save package details' }));

    await waitFor(() =>
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/execution-packages/${executionPackage.id}`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"objective":"Updated package objective"'),
        }),
      ),
    );
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
    expect(screen.getByText('Run update')).toBeTruthy();
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
    expect(screen.queryByText('agent_message')).toBeNull();
    expect(screen.queryByText('thread_started')).toBeNull();
    expect(screen.queryByText('turn_started')).toBeNull();
    expect(screen.queryByText(/thread raw event should not render/i)).toBeNull();
    expect(screen.queryByText(/turn raw event should not render/i)).toBeNull();
    expect(screen.getByTestId('run-console-events').innerHTML).not.toContain('agent_message');
    expect(screen.getByTestId('run-console-events').innerHTML).not.toContain('thread_started');
    expect(screen.getByTestId('run-console-events').innerHTML).not.toContain('turn_started');
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
