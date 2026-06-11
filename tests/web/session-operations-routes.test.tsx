// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SessionOperationsDashboardRoute,
  SessionOperationsDashboardView,
} from '../../apps/web/src/features/session-operations/session-operations-dashboard-route';

const recoverPredicateFixture = () => ({
  codex_session_id: 'session-1',
  workflow_id: 'workflow-1',
  expected_health_state: 'blocked_stale_lease',
  operation_idempotency_key: 'recover-session-1-stale-lease',
  projection_digest: `sha256:${'a'.repeat(64)}`,
  workflow: {
    checked: true,
    state: 'present',
    value: {
      id: 'workflow-1',
      development_plan_id: 'development-plan-1',
      development_plan_item_id: 'item-1',
      status: 'execution_running',
      updated_at: '2026-06-09T00:00:00.000Z',
      active_codex_session_id: 'session-1',
      active_boundary_summary_revision_id: null,
      active_spec_doc_revision_id: null,
      active_implementation_plan_doc_revision_id: null,
      execution_package_id: null,
    },
  },
  session: {
    checked: true,
    state: 'present',
    value: {
      id: 'session-1',
      workflow_id: 'workflow-1',
      status: 'running',
      role: 'active',
      updated_at: '2026-06-09T00:00:00.000Z',
      active_lease_id: 'lease-1',
      lease_epoch: 3,
      runner_worker_id: null,
      runner_launch_lease_id: null,
      runner_runtime_job_id: null,
      runner_expires_at: null,
      latest_turn_id: null,
      latest_capsule_id: null,
      latest_capsule_digest: null,
    },
  },
  active_lease: {
    checked: true,
    state: 'present',
    value: {
      id: 'lease-1',
      session_id: 'session-1',
      status: 'active',
      lease_epoch: 3,
      worker_id: 'worker-1',
      worker_session_digest: `sha256:${'b'.repeat(64)}`,
      heartbeat_at: '2026-06-09T00:01:00.000Z',
      expires_at: '2026-06-09T00:02:00.000Z',
      updated_at: '2026-06-09T00:01:00.000Z',
    },
  },
  pending_queued_action: { checked: true, state: 'absent' },
  latest_turn: { checked: true, state: 'absent' },
  runtime_job: { checked: true, state: 'absent' },
  run_session: { checked: true, state: 'absent' },
  latest_capsule: { checked: true, state: 'absent' },
  observed_at: '2026-06-09T00:03:00.000Z',
});

const blockedHealth = {
  codex_session_id: 'session-1',
  workflow_id: 'workflow-1',
  project_id: 'project-1',
  development_plan_item_id: 'item-1',
  state: 'blocked_stale_lease',
  severity: 'blocked',
  projection_digest: `sha256:${'a'.repeat(64)}`,
  summary: 'Worker lease expired.',
  recovery_available: true,
  recovery_operation_labels: ['recover'],
  operator_intervention_required: true,
  normal_workflow_actions_available: false,
  retention_risk: false,
  lineage_risk: false,
  retention_pins: [],
  checked_at: '2026-06-09T00:00:00.000Z',
  candidate_predicate: recoverPredicateFixture(),
} as const;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('session operations dashboard route', () => {
  it('renders blocked sessions without raw runtime internals', async () => {
    render(<SessionOperationsDashboardRoute initialHealth={[blockedHealth]} />);

    expect(screen.getByText('Session Operations')).toBeTruthy();
    expect(screen.getByText('Worker lease expired.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^recover$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /mark unrecoverable/i })).toBeTruthy();
    expect(screen.queryByText(/worker_session_digest/i)).toBeNull();
    expect(screen.queryByText(/codex_thread_id/i)).toBeNull();
  });

  it('requires operator reason and idempotency prefix before executing selected scavenge candidates', async () => {
    render(<SessionOperationsDashboardRoute initialHealth={[blockedHealth]} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /select session-1/i }));
    const execute = screen.getByRole('button', { name: /execute selected scavenge/i }) as HTMLButtonElement;
    expect(execute.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(/scavenge reason/i), 'Operator-reviewed stale lease cleanup.');
    expect(execute.disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(/idempotency prefix/i), 'scavenge-session-1');
    await userEvent.click(screen.getByRole('checkbox', { name: /confirm execute/i }));
    expect(execute.disabled).toBe(false);
  });

  it('sends scoped dry-run filters and selected candidate predicates for scavenge execute', async () => {
    const dryRunScavenge = vi.fn(async () => undefined);
    const executeScavenge = vi.fn(async () => undefined);
    render(
      <SessionOperationsDashboardView
        auditResponse={{ items: [] }}
        health={[blockedHealth]}
        onDryRunScavenge={dryRunScavenge}
        onRecoverSession={async () => undefined}
        onScavenge={executeScavenge}
      />,
    );

    await userEvent.type(screen.getByLabelText(/project id/i), 'project-1');
    await userEvent.type(screen.getByLabelText(/worker id/i), 'worker-1');
    await userEvent.click(screen.getByRole('button', { name: /dry-run scavenge/i }));

    expect(dryRunScavenge).toHaveBeenCalledWith({
      mode: 'dry_run',
      filters: {
        project_id: 'project-1',
        worker_id: 'worker-1',
        candidate_only: true,
      },
    });

    await userEvent.click(screen.getByRole('checkbox', { name: /select session-1/i }));
    await userEvent.type(screen.getByLabelText(/scavenge reason/i), 'Operator-reviewed stale lease cleanup.');
    await userEvent.type(screen.getByLabelText(/idempotency prefix/i), 'scavenge-session-1');
    await userEvent.click(screen.getByRole('checkbox', { name: /confirm execute/i }));
    await userEvent.click(screen.getByRole('button', { name: /execute selected scavenge/i }));

    expect(executeScavenge).toHaveBeenCalledWith({
      mode: 'execute',
      reason: 'Operator-reviewed stale lease cleanup.',
      operation_idempotency_key_prefix: 'scavenge-session-1',
      confirm_execute: true,
      candidates: [
        {
          codex_session_id: 'session-1',
          candidate_predicate: recoverPredicateFixture(),
        },
      ],
    });
  });

  it('posts recovery to the selected session instead of a stale audit selection', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/session-operations/health') {
        return new Response(JSON.stringify({ items: [blockedHealth], filters: { candidate_only: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.pathname === '/session-operations/session-1/recover') {
        return new Response(
          JSON.stringify({
            record: recoveryRecordFixture(),
            before: blockedHealth,
            after: { ...blockedHealth, state: 'recovered', severity: 'info' },
            replayed: false,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    render(<SessionOperationsDashboardRoute />, { wrapper });

    await screen.findByText('Worker lease expired.');
    await userEvent.type(screen.getByLabelText(/operator reason/i), 'Release stale worker lease.');
    await userEvent.click(screen.getByRole('button', { name: /^recover$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/session-operations/session-1/recover',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(
      'http://localhost:3000/session-operations/undefined/recover',
    );

    queryClient.clear();
  });
});

function recoveryRecordFixture() {
  return {
    id: 'recovery-1',
    codex_session_id: 'session-1',
    operation: 'recover',
    result: 'applied',
    result_code: 'recovered',
    reason: 'Release stale worker lease.',
    actor_id: 'actor-operator',
    operation_idempotency_key: 'recover-session-1-stale-lease',
    before_state: 'blocked_stale_lease',
    after_state: 'recovered',
    before_projection_digest: `sha256:${'a'.repeat(64)}`,
    after_projection_digest: `sha256:${'c'.repeat(64)}`,
    affected_lease_ids: ['lease-1'],
    affected_queued_action_ids: [],
    affected_turn_ids: [],
    affected_runtime_job_ids: [],
    affected_run_session_ids: [],
    affected_capsule_ids: [],
    predicate_summary: {
      operation_idempotency_key: 'recover-session-1-stale-lease',
      projection_digest: `sha256:${'a'.repeat(64)}`,
      expected_health_state: 'blocked_stale_lease',
      observed_at: '2026-06-09T00:03:00.000Z',
      workflow_state: 'present',
      session_state: 'present',
      active_lease_state: 'present',
      pending_queued_action_state: 'absent',
      latest_turn_state: 'absent',
      runtime_job_state: 'absent',
      run_session_state: 'absent',
      latest_capsule_state: 'absent',
    },
    created_at: '2026-06-09T00:04:00.000Z',
  };
}
