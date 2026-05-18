import { vi } from 'vitest';

import {
  actorId,
  executionPackage,
  plan,
  planRevision,
  projectId,
  release,
  reviewPacket,
  runSession,
  spec,
  specRevision,
  timeline,
  workItem,
} from './product-data';

export type ProductApiResponseMap = Record<string, unknown>;

export const defaultProductApiResponses: ProductApiResponseMap = {
  [`GET /query/pipeline?project_id=${projectId}`]: [workItem],
  [`GET /query/workbenches/intake?project_id=${projectId}`]: {
    summary: { role: 'intake', project_id: projectId, actor_id: actorId, total: 1 },
    items: [{ ...workItem, actions: [{ id: 'open-work-item', label: 'Open work item', enabled: true }] }],
  },
  [`GET /query/specs?project_id=${projectId}`]: [spec],
  [`GET /query/specs/${spec.id}`]: spec,
  [`GET /query/specs/${spec.id}/history`]: [specRevision],
  [`GET /query/plans?project_id=${projectId}`]: [plan],
  [`GET /query/plans/${plan.id}`]: plan,
  [`GET /query/plans/${plan.id}/history`]: [planRevision],
  [`GET /query/packages?project_id=${projectId}`]: [executionPackage],
  [`GET /query/packages/${executionPackage.id}`]: executionPackage,
  [`GET /query/runs?project_id=${projectId}`]: [runSession],
  [`GET /query/runs/${runSession.id}`]: runSession,
  [`GET /query/reviews?project_id=${projectId}`]: [reviewPacket],
  [`GET /query/reviews/${reviewPacket.id}`]: reviewPacket,
  [`GET /query/releases?project_id=${projectId}`]: { releases: [release] },
  [`GET /query/work-item-cockpit/${workItem.id}`]: {
    work_item: workItem,
    current_spec: spec,
    current_plan: plan,
    packages: [executionPackage],
    run_sessions: [runSession],
    review_packets: [reviewPacket],
    next_actions: ['open_work_item'],
    completion_state: { fixture: true },
  },
  [`GET /query/release-cockpit/${release.id}`]: {
    release,
    work_items: [workItem],
    execution_packages: [executionPackage],
    latest_run_sessions: [runSession],
    current_review_packets: [reviewPacket],
    evidences: [],
    observations: [],
    decisions: [],
    blocker_snapshot: {
      release_id: release.id,
      generated_at: '2026-05-18T00:37:00.000Z',
      blocker_fingerprint: 'fixture-release-ready',
      blockers: [],
    },
    blockers: [],
    overridden_blockers: [],
    risk_summary: {
      structural_blocker_count: 0,
      risk_blocker_count: 0,
      evidence_blocker_count: 0,
      planning_blocker_count: 0,
      redacted_or_stale_evidence_count: 0,
      failed_or_missing_check_count: 0,
      packages_not_ready_count: 0,
      release_can_proceed_without_override: true,
      release_can_proceed_with_override: true,
      release_cannot_proceed: false,
    },
    checklist: [{ id: 'fixture-ready', label: 'Fixture release ready', status: 'passed', blocker_codes: [] }],
    next_actions: ['submit_for_approval'],
  },
  [`GET /query/replay/work_item/${workItem.id}`]: timeline,
  [`GET /query/replay/execution_package/${executionPackage.id}`]: timeline,
  [`GET /query/replay/review_packet/${reviewPacket.id}`]: timeline,
  [`GET /query/replay/release/${release.id}`]: timeline,
};

export function installProductApiMock(overrides: ProductApiResponseMap = {}) {
  const responses = { ...defaultProductApiResponses, ...overrides };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, 'http://localhost');
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const key = `${method} ${url.pathname}${url.search}`;

    if (Object.prototype.hasOwnProperty.call(responses, key)) {
      return jsonResponse(responses[key], 200);
    }

    return jsonResponse({ message: `Unhandled product API request: ${key}` }, 404);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
