// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  actorId,
  boardCards,
  myWorkQueueResponse,
  projectId,
  requirementDetail,
} from './fixtures/product-data';
import { renderRoute } from './router-test-utils';
import type { ProductApiResponseMap } from './fixtures/product-api-mock';

type SurfaceState = 'loading' | 'empty' | 'error' | 'stale' | 'blocked' | 'approved' | 'running' | 'resumable';

describe('AI-native surface states', () => {
  it.each([
    ['/requirements/req-1', 'Source Object Workspace'],
    ['/dashboard', 'Dashboard'],
    ['/my-work', 'My Work'],
    ['/board', 'Board'],
    ['/reports', 'Reports'],
  ] as const)('renders loading, empty, error, stale, blocked, approved, running, and resumable states for %s', async (route) => {
    for (const state of ['loading', 'empty', 'error', 'stale', 'blocked', 'approved', 'running', 'resumable'] as const) {
      const screen = await renderRoute(route, { apiOverrides: overridesFor(route, state) });
      const indicator = await screen.findByTestId(`surface-state-${state}`);
      expect(indicator).toBeTruthy();
      expect(indicator.getAttribute('aria-label')).toBeTruthy();
      expect(indicator.textContent).toMatch(new RegExp(state === 'resumable' ? 'resumable' : state, 'i'));
      expect(document.body.textContent).not.toMatch(/color only status/i);
      cleanup();
    }
  });
});

function overridesFor(route: string, state: SurfaceState): ProductApiResponseMap {
  if (route === '/requirements/req-1') return sourceObjectOverrides(state);
  if (route === '/dashboard') return dashboardOverrides(state);
  if (route === '/my-work') return myWorkOverrides(state);
  if (route === '/board') return boardOverrides(state);
  return reportOverrides(state);
}

function sourceObjectOverrides(state: SurfaceState): ProductApiResponseMap {
  const key = 'GET /query/requirements/req-1';
  if (state === 'loading') return { [key]: () => new Promise(() => undefined) };
  if (state === 'error') return { [key]: () => new Response(JSON.stringify({ message: 'failed' }), { status: 500 }) };
  if (state === 'empty') return { [key]: { ...requirementDetail, relationship_refs: [] } };
  return { [key]: { ...requirementDetail, status: state } };
}

function dashboardOverrides(state: SurfaceState): ProductApiResponseMap {
  const key = `GET /query/dashboard?project_id=${projectId}`;
  if (state === 'loading') return { [key]: () => new Promise(() => undefined) };
  if (state === 'error') return { [key]: () => new Response(JSON.stringify({ message: 'failed' }), { status: 500 }) };
  const base = {
    project_id: projectId,
    sections: [
      { id: 'flow-health', label: 'Flow Health', value: 1 },
      { id: 'blocked-work', label: 'Blocked Work', value: state === 'blocked' ? 2 : 0 },
      { id: 'aging', label: 'Aging', value: 0 },
      { id: 'risk-concentration', label: 'Risk Concentration', value: 1 },
      { id: 'role-load', label: 'Role Load', value: 1 },
      { id: 'release-confidence', label: 'Release Confidence', value: state === 'approved' ? 1 : 0 },
    ],
    next_actions: state === 'running' ? [{ id: 'running', label: 'Running execution' }] : state === 'resumable' ? [{ id: 'resumable', label: 'Resumable execution' }] : [],
    report_links: [],
    degraded_sources: state === 'stale' ? ['stale_dashboard_projection'] : [],
  };
  if (state === 'empty') return { [key]: { ...base, sections: [] } };
  return { [key]: base };
}

function myWorkOverrides(state: SurfaceState): ProductApiResponseMap {
  const key = `GET /query/my-work?project_id=${projectId}&actor_id=${actorId}`;
  if (state === 'loading') return { [key]: () => new Promise(() => undefined) };
  if (state === 'error') return { [key]: () => new Response(JSON.stringify({ message: 'failed' }), { status: 500 }) };
  if (state === 'empty') return { [key]: { items: [], degraded_sources: [] } };
  return {
    [key]: {
      ...myWorkQueueResponse,
      degraded_sources: state === 'stale' ? ['stale_my_work_projection'] : [],
      items: [
        {
          ...myWorkQueueResponse.items[2],
          attention_reason: state === 'blocked' ? 'blocked_boundary' : myWorkQueueResponse.items[2].attention_reason,
          expected_action:
            state === 'approved'
              ? 'Approved for next gate'
              : state === 'running'
                ? 'Running execution'
                : state === 'resumable'
                  ? 'Resumable execution'
                  : myWorkQueueResponse.items[2].expected_action,
        },
      ],
    },
  };
}

function boardOverrides(state: SurfaceState): ProductApiResponseMap {
  const key = `GET /query/board?project_id=${projectId}&limit=100`;
  if (state === 'loading') return { [key]: () => new Promise(() => undefined) };
  if (state === 'error') return { [key]: () => new Response(JSON.stringify({ message: 'failed' }), { status: 500 }) };
  if (state === 'empty') return { [key]: { items: [], degraded_sources: [] } };
  return {
    [key]: {
      degraded_sources: state === 'stale' ? ['stale_board_projection'] : [],
      items: [
        {
          ...boardCards[3],
          blocked: state === 'blocked',
          status: state === 'approved' ? 'approved' : state === 'running' ? 'running' : state === 'resumable' ? 'interrupted' : boardCards[3].status,
        },
      ],
    },
  };
}

function reportOverrides(state: SurfaceState): ProductApiResponseMap {
  const key = `GET /query/reports/delivery?project_id=${projectId}&limit=100`;
  if (state === 'loading') return { [key]: () => new Promise(() => undefined) };
  if (state === 'error') return { [key]: () => new Response(JSON.stringify({ message: 'failed' }), { status: 500 }) };
  if (state === 'empty') return { [key]: { id: 'delivery', project_id: projectId, degraded_sources: [] } };
  return {
    [key]: {
      id: 'delivery',
      project_id: projectId,
      generated_at: '2026-05-18T01:05:00.000Z',
      degraded_sources: state === 'stale' ? ['stale_report_projection'] : [],
      groups: [{ id: state === 'resumable' ? 'resumable' : state }],
    },
  };
}
