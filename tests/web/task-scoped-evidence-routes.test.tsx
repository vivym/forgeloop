// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from './router-test-utils';

const packageEvidence = {
  object_ref: { type: 'execution_package', id: 'pkg-1' },
  task_ref: { type: 'task', id: 'task-1' },
  href: '/tasks/task-1/packages/pkg-1',
  package: {
    id: 'pkg-1',
    objective: 'Implement checkout guard',
    phase: 'ready',
    activity_state: 'active',
    gate_state: 'open',
    resolution: 'unresolved',
    repo_id: 'forgeloop',
    required_checks: [{ check_id: 'web-routes', display_name: 'Web routes', command: 'pnpm vitest run tests/web', blocks_review: true }],
    required_artifact_kinds: ['diff'],
    allowed_paths: ['apps/web/**'],
    forbidden_paths: ['apps/control-plane-api/**'],
    version: 1,
    last_run_session_id: 'run-1',
  },
};

const runEvidence = {
  object_ref: { type: 'run_session', id: 'run-1' },
  task_ref: { type: 'task', id: 'task-1' },
  package_ref: { type: 'execution_package', id: 'pkg-1' },
  href: '/tasks/task-1/runs/run-1',
  run_session: {
    id: 'run-1',
    execution_package_id: 'pkg-1',
    requested_by_actor_id: 'actor-dev',
    status: 'succeeded',
    executor_type: 'local_codex',
    changed_files: [{ repo_id: 'forgeloop', path: 'apps/web/src/features/tasks/task-evidence-routes.tsx', change_kind: 'modified' }],
    check_results: [{ check_id: 'web-routes', command: 'pnpm vitest run tests/web', status: 'succeeded', exit_code: 0, blocks_review: true }],
    artifacts: [{ kind: 'diff', name: 'task-evidence.diff', content_type: 'text/x-diff', storage_uri: 'fixture://diff' }],
    summary: 'Task-scoped evidence route checks passed.',
  },
};

const reviewEvidence = {
  object_ref: { type: 'review_packet', id: 'review-1' },
  task_ref: { type: 'task', id: 'task-1' },
  package_ref: { type: 'execution_package', id: 'pkg-1' },
  href: '/tasks/task-1/reviews/review-1',
  review_packet: {
    id: 'review-1',
    run_session_id: 'run-1',
    execution_package_id: 'pkg-1',
    reviewer_actor_id: 'actor-reviewer',
    status: 'completed',
    decision: 'approved',
    summary: 'Task evidence is ready.',
    changed_files: [{ repo_id: 'forgeloop', path: 'tests/web/task-scoped-evidence-routes.test.tsx', change_kind: 'added' }],
    check_result_summary: 'Required checks passed.',
    risk_notes: ['Keep evidence routes under task scope.'],
  },
};

describe('task-scoped evidence routes', () => {
  it('renders package evidence under task scope and not as a registry', async () => {
    const screen = await renderRoute('/tasks/task-1/packages/pkg-1', {
      apiOverrides: {
        'GET /query/tasks/task-1/packages/pkg-1': packageEvidence,
        'GET /query/execution-packages/pkg-1/runtime-readiness': {
          executor_type: 'local_codex',
          target_kind: 'run_execution',
          state: 'ready',
          blockers: [],
          generated_at: '2026-05-23T00:00:00.000Z',
        },
      },
    });
    expect(await screen.findByRole('heading', { name: /package evidence/i })).toBeTruthy();
    expect(screen.getByText(/Task task-1/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Packages/i })).toBeNull();
  });

  it('renders product-safe not found for mismatched task and evidence ids', async () => {
    const screen = await renderRoute('/tasks/task-other/packages/pkg-1', {
      apiOverrides: {
        'GET /query/tasks/task-other/packages/pkg-1': new Response(JSON.stringify({ message: 'Not found' }), { status: 404 }),
      },
    });
    expect(await screen.findByText(/not found|access denied/i)).toBeTruthy();
  });

  it('runs ready package evidence through the command API instead of rendering a no-op action', async () => {
    const screen = await renderRoute('/tasks/task-1/packages/pkg-1', {
      apiOverrides: {
        'GET /query/tasks/task-1/packages/pkg-1': packageEvidence,
        'GET /query/execution-packages/pkg-1/runtime-readiness': {
          executor_type: 'local_codex',
          target_kind: 'run_execution',
          state: 'ready',
          blockers: [],
          generated_at: '2026-05-23T00:00:00.000Z',
        },
        'POST /execution-packages/pkg-1/run': {
          run_session_id: 'run-queued',
          execution_package_id: 'pkg-1',
        },
      },
    });
    const user = userEvent.setup();
    const fetchMock = vi.mocked(globalThis.fetch);

    await user.click(await screen.findByRole('button', { name: /run package/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/execution-packages/pkg-1/run',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(screen.getByRole('button', { name: /force rerun/i })).toHaveProperty('disabled', true);
  });

  it('renders run evidence under task scope', async () => {
    const screen = await renderRoute('/tasks/task-1/runs/run-1', {
      apiOverrides: {
        'GET /query/tasks/task-1/runs/run-1': runEvidence,
      },
    });
    expect(await screen.findByRole('heading', { name: /run evidence/i })).toBeTruthy();
    expect(screen.getByText(/Task task-1/i)).toBeTruthy();
    expect(screen.getByText(/Task-scoped evidence route checks passed/i)).toBeTruthy();
  });

  it('renders review evidence under task scope', async () => {
    const screen = await renderRoute('/tasks/task-1/reviews/review-1', {
      apiOverrides: {
        'GET /query/tasks/task-1/reviews/review-1': reviewEvidence,
      },
    });
    expect(await screen.findByRole('heading', { name: /review evidence/i })).toBeTruthy();
    expect(screen.getByText(/Task task-1/i)).toBeTruthy();
    expect(screen.getByText(/Task evidence is ready/i)).toBeTruthy();
  });
});
