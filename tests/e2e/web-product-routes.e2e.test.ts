// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderRoute } from '../web/router-test-utils';

const activeRoutes = [
  ['/my-work', /my work/i],
  ['/requirements', /^Requirements$/],
  ['/requirements/req-1', /^Requirement$/],
  ['/initiatives', /^Initiatives$/],
  ['/initiatives/init-1', /^Initiative$/],
  ['/tech-debt', /^Tech Debt$/],
  ['/tech-debt/td-1', /^Tech Debt$/],
  ['/specs-plans', /^Specs & Plans$/],
  ['/specs/spec-1', /spec/i],
  ['/plans/plan-1', /plan/i],
  ['/tasks', /^Tasks$/],
  ['/tasks/task-1', /^Task$/],
  ['/tasks/task-1/packages/pkg-1', /^Package Evidence$/],
  ['/tasks/task-1/runs/run-1', /^Run Evidence$/],
  ['/tasks/task-1/reviews/review-1', /^Review Evidence$/],
  ['/bugs', /^Bugs$/],
  ['/bugs/bug-1', /^Bug$/],
  ['/board', /^Board$/],
  ['/releases', /^Releases$/],
  ['/releases/release-web-product', /^Typed scope$/],
  ['/reports', /^Reports$/],
] as const;

const removedRoutes = [
  '/lanes',
  '/pipeline',
  '/work-items',
  '/packages',
  '/runs',
  '/reviews',
  '/specs',
  '/plans',
] as const;

describe('web product route smoke', () => {
  it.each(activeRoutes)('visits active product route %s', async (route, heading) => {
    const screen = await renderRoute(route, {
      apiOverrides: routeScopedOverrides,
    });

    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /not found|404/i })).toBeNull();
    cleanup();
  });

  it.each(removedRoutes)('does not resolve removed product route %s', async (route) => {
    const screen = await renderRoute(route);

    expect(screen.getByRole('heading', { name: /not found/i })).toBeTruthy();
    cleanup();
  });
});

const routeScopedOverrides = {
  'GET /query/tasks/task-1/packages/pkg-1': {
    object_ref: { type: 'execution_package', id: 'pkg-1' },
    task_ref: { type: 'task', id: 'task-1' },
    href: '/tasks/task-1/packages/pkg-1',
    package: {
      id: 'pkg-1',
      task_id: 'task-1',
      scope_ref: { type: 'task', id: 'task-1' },
      spec_revision_id: 'spec-rev-1',
      plan_revision_id: 'plan-rev-1',
      project_id: 'project-web-product',
      repo_id: 'forgeloop',
      objective: 'Implement task-scoped package evidence',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      phase: 'ready',
      gate_state: 'open',
      version: 1,
    },
  },
  'GET /query/tasks/task-1/runs/run-1': {
    object_ref: { type: 'run_session', id: 'run-1' },
    task_ref: { type: 'task', id: 'task-1' },
    package_ref: { type: 'execution_package', id: 'pkg-1' },
    href: '/tasks/task-1/runs/run-1',
    run_session: {
      id: 'run-1',
      execution_package_id: 'pkg-1',
      requested_by_actor_id: 'actor-execution-owner',
      status: 'succeeded',
      executor_type: 'mock',
      changed_files: [],
      check_results: [],
      artifacts: [],
      summary: 'Task-scoped run evidence passed.',
      created_at: '2026-05-18T00:00:00.000Z',
      updated_at: '2026-05-18T00:00:00.000Z',
    },
  },
  'GET /query/tasks/task-1/reviews/review-1': {
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
      summary: 'Task-scoped review evidence approved.',
      changed_files: [],
      check_result_summary: 'Checks passed.',
      risk_notes: [],
      created_at: '2026-05-18T00:00:00.000Z',
      updated_at: '2026-05-18T00:00:00.000Z',
    },
  },
};
