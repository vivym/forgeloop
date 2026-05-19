// @vitest-environment jsdom

import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderRoute } from './router-test-utils';
import { actorId, executionPackage, projectId, release, reviewPacket, runSession, timeline, workItem } from './fixtures/product-data';

const reviewListResponse = {
  items: [
    {
      id: reviewPacket.id,
      object: {
        type: 'review_packet',
        id: reviewPacket.id,
        title: reviewPacket.summary,
      },
      title: reviewPacket.summary,
      status: reviewPacket.status,
      risk: workItem.risk,
      reviewer_actor_id: reviewPacket.reviewer_actor_id,
      parent: {
        type: 'execution_package',
        id: executionPackage.id,
        title: executionPackage.objective,
      },
      related: [
        {
          type: 'run_session',
          id: runSession.id,
          title: runSession.summary,
        },
      ],
      revision_state: {},
      review_state: {
        execution_package_id: executionPackage.id,
        run_session_id: runSession.id,
        decision: reviewPacket.decision,
        changed_file_count: 1,
      },
      counts: {},
      updated_at: reviewPacket.updated_at,
    },
  ],
  degraded_sources: [],
};

const reviewWithRequestedChanges = {
  ...reviewPacket,
  requested_changes: [
    {
      title: 'Clarify fallback state',
      description: 'Explain how the route behaves when product list data is partial.',
      file_path: 'apps/web/src/app/routes/releases/index.tsx',
      severity: 'major',
      suggested_validation: 'Route test covers the fallback copy.',
    },
  ],
};

const releaseWithKey = {
  ...release,
  key: 'REL-WEB-1',
};

const releaseListResponse = {
  releases: [releaseWithKey],
};

const releaseCockpitResponse = {
  release: releaseWithKey,
  work_items: [
    {
      id: workItem.id,
      title: workItem.title,
      phase: workItem.phase,
      gate_state: workItem.gate_state,
      resolution: workItem.resolution,
      risk: workItem.risk,
      owner_actor_id: workItem.owner_actor_id,
      updated_at: workItem.updated_at,
    },
  ],
  execution_packages: [
    {
      id: executionPackage.id,
      objective: executionPackage.objective,
      phase: executionPackage.phase,
      gate_state: executionPackage.gate_state,
      resolution: executionPackage.resolution,
      owner_actor_id: executionPackage.owner_actor_id,
      reviewer_actor_id: executionPackage.reviewer_actor_id,
      qa_owner_actor_id: executionPackage.qa_owner_actor_id,
      updated_at: executionPackage.updated_at,
    },
  ],
  latest_run_sessions: [
    {
      id: runSession.id,
      execution_package_id: executionPackage.id,
      status: runSession.status,
      summary: runSession.summary,
      check_results: [{ check_id: 'web-typecheck', status: 'passed', blocks_review: true }],
      artifacts: runSession.artifacts,
      created_at: runSession.created_at,
      updated_at: runSession.updated_at,
      started_at: runSession.started_at,
      finished_at: runSession.finished_at,
    },
  ],
  current_review_packets: [
    {
      id: reviewPacket.id,
      execution_package_id: executionPackage.id,
      run_session_id: runSession.id,
      status: reviewPacket.status,
      decision: reviewPacket.decision,
      summary: reviewPacket.summary,
      check_result_summary: reviewPacket.check_result_summary,
      risk_notes: reviewPacket.risk_notes,
      created_at: reviewPacket.created_at,
      updated_at: reviewPacket.updated_at,
    },
  ],
  evidences: [
    {
      id: 'release-evidence-1',
      release_id: release.id,
      evidence_type: 'release_note',
      summary: 'Release notes are attached.',
      artifact: { name: 'release-notes.md', local_ref: 'artifacts/release-notes.md' },
      extra: {},
      redacted: false,
      status: 'active',
      created_at: '2026-05-18T00:38:00.000Z',
      created_by_actor_id: actorId,
    },
  ],
  observations: [
    {
      id: 'release-observation-1',
      release_id: release.id,
      evidence_type: 'observation',
      summary: 'No regressions observed during smoke checks.',
      extra: { observation: { observed_at: '2026-05-18T00:40:00.000Z' } },
      redacted: false,
      status: 'active',
      created_at: '2026-05-18T00:40:00.000Z',
      created_by_actor_id: actorId,
    },
  ],
  decisions: [
    {
      id: 'release-decision-1',
      object_type: 'release',
      object_id: release.id,
      actor_id: actorId,
      decision_type: 'release_approval',
      outcome: 'approved',
      decision: 'approved',
      summary: 'Release owner approved readiness.',
      rationale: 'All gates are ready.',
      created_at: '2026-05-18T00:41:00.000Z',
    },
  ],
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
};

describe('review and release product routes', () => {
  it('uses the Review Packets product endpoint with supported filters and reports unsupported filters', async () => {
    const screen = await renderRoute(
      `/reviews?reviewer_actor_id=${reviewPacket.reviewer_actor_id}&decision=approved&execution_package_id=${executionPackage.id}&risk=high&stale=true&limit=25`,
      {
        apiOverrides: {
          [`GET /query/review-packets?project_id=${projectId}&reviewer_actor_id=${reviewPacket.reviewer_actor_id}&execution_package_id=${executionPackage.id}&decision=approved&limit=25`]:
            reviewListResponse,
        },
      },
    );

    expect(await screen.findByRole('heading', { name: 'Reviews' })).toBeTruthy();
    expect(await screen.findByText(reviewPacket.summary)).toBeTruthy();
    expect(screen.getByText(/risk and stale are not applied to the review packet inventory yet/i)).toBeTruthy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/review-packets?project_id=${projectId}&reviewer_actor_id=${reviewPacket.reviewer_actor_id}&execution_package_id=${executionPackage.id}&decision=approved&limit=25`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('risk=high'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('stale=true'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('renders Review Packet detail with replay timeline and real decision actions', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/reviews/${reviewPacket.id}`, {
      apiOverrides: {
        [`GET /query/reviews/${reviewPacket.id}`]: reviewWithRequestedChanges,
        [`GET /query/replay/review_packet/${reviewPacket.id}`]: timeline,
        [`POST /review-packets/${reviewPacket.id}/approve`]: { review_packet_id: reviewPacket.id, status: 'completed', decision: 'approved' },
      },
    });

    expect(await screen.findByRole('heading', { name: reviewPacket.summary })).toBeTruthy();
    expect(screen.getByText('approved')).toBeTruthy();
    expect(screen.getByText('apps/web/src/shared/api/hooks.ts')).toBeTruthy();
    expect(screen.getByText(reviewPacket.check_result_summary)).toBeTruthy();
    expect(screen.getByText(reviewPacket.self_review.summary)).toBeTruthy();
    expect(screen.getByText(reviewPacket.risk_notes[0])).toBeTruthy();
    expect(screen.getByText('Clarify fallback state')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open run' }).getAttribute('href')).toBe(`/runs/${runSession.id}`);
    expect(screen.getByRole('link', { name: 'Open package' }).getAttribute('href')).toBe(`/packages/${executionPackage.id}`);
    expect(screen.getByText('Timeline / Replay')).toBeTruthy();
    expect(screen.getByText(timeline[0].summary)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeTruthy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/reviews/${reviewPacket.id}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining(`/review-packets/${reviewPacket.id}`),
      expect.objectContaining({ method: 'GET' }),
    );

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      const [, init] =
        vi.mocked(globalThis.fetch).mock.calls.find(([input]) =>
          String(input).includes(`/review-packets/${reviewPacket.id}/approve`),
        ) ?? [];
      expect(init).toBeDefined();
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual(
        expect.objectContaining({
          summary: 'Approved from Reviews route.',
          reviewed_by_actor_id: actorId,
        }),
      );
      expect(body).not.toHaveProperty('mutation');
    });
  });

  it('renders release list from listReleases without manual release id loading', async () => {
    const screen = await renderRoute(
      `/releases?project_id=${projectId}&release_owner_actor_id=${release.release_owner_actor_id}&phase=approval&gate_state=open&resolution=unresolved&release_type=standard&updated_age=7d&limit=25`,
      {
        apiOverrides: {
          [`GET /query/releases?project_id=${projectId}&release_owner_actor_id=${release.release_owner_actor_id}&phase=approval&gate_state=open&resolution=unresolved&limit=25`]:
            releaseListResponse,
        },
      },
    );

    expect(await screen.findByRole('heading', { name: 'Releases' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create release' })).toBeTruthy();
    expect(await screen.findByText('REL-WEB-1')).toBeTruthy();
    expect(screen.getByText(release.title)).toBeTruthy();
    expect(screen.getByText('approval')).toBeTruthy();
    expect(screen.getByText('open')).toBeTruthy();
    expect(screen.getByText('unresolved')).toBeTruthy();
    expect(screen.getByText(release.release_owner_actor_id)).toBeTruthy();
    expect(screen.getByText('Work Items: 1')).toBeTruthy();
    expect(screen.getByText('Packages: 1')).toBeTruthy();
    expect(screen.getByText('Acceptance summary unavailable from release list API.')).toBeTruthy();
    expect(screen.getByText(/release_type and updated_age are not applied to the release inventory yet/i)).toBeTruthy();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      `http://localhost:3000/query/releases?project_id=${projectId}&release_owner_actor_id=${release.release_owner_actor_id}&phase=approval&gate_state=open&resolution=unresolved&limit=25`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('release_type=standard'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
      expect.stringContaining('updated_age=7d'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('creates a release through product labels instead of the old raw form', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/releases', {
      apiOverrides: {
        'POST /releases': {
          release: releaseWithKey,
          blocker_snapshot: releaseCockpitResponse.blocker_snapshot,
          blockers: [],
          overridden_blockers: [],
          decision_intents: [],
          next_actions: [],
        },
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Create release' }));
    expect(screen.getByRole('dialog', { name: 'Create release' })).toBeTruthy();
    await user.type(screen.getByLabelText('Release title'), 'Release cockpit rollout');
    await user.type(screen.getByLabelText('Scope summary'), 'Route-backed release cockpit rollout.');
    await user.type(screen.getByLabelText('Release owner'), release.release_owner_actor_id);
    await user.click(screen.getByRole('button', { name: 'Submit release' }));

    await waitFor(() => {
      const [, init] = vi.mocked(globalThis.fetch).mock.calls.find(([input]) => String(input).endsWith('/releases')) ?? [];
      expect(init).toBeDefined();
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual(
        expect.objectContaining({
          actor_id: actorId,
          project_id: projectId,
          title: 'Release cockpit rollout',
          scope_summary: 'Route-backed release cockpit rollout.',
          release_owner_actor_id: release.release_owner_actor_id,
        }),
      );
      expect(body).not.toHaveProperty('release_id');
    });
  });

  it('renders Release Cockpit product governance actions', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/releases/${release.id}`, {
      apiOverrides: {
        [`GET /query/release-cockpit/${release.id}`]: releaseCockpitResponse,
        [`GET /query/replay/release/${release.id}`]: timeline,
        [`PATCH /releases/${release.id}`]: {
          release: { ...releaseWithKey, title: 'Edited release cockpit' },
          blocker_snapshot: releaseCockpitResponse.blocker_snapshot,
          blockers: [],
          overridden_blockers: [],
          decision_intents: [],
          next_actions: [],
        },
        [`POST /releases/${release.id}/test-acceptance/acknowledge`]: {
          release: releaseWithKey,
          blocker_snapshot: releaseCockpitResponse.blocker_snapshot,
          blockers: [],
          overridden_blockers: [],
          decision_intents: [],
          next_actions: [],
        },
      },
    });

    expect(await screen.findByRole('heading', { name: release.title })).toBeTruthy();
    expect(screen.getByText('fixture-release-ready')).toBeTruthy();
    expect(screen.getByText(release.scope_summary)).toBeTruthy();
    expect(screen.getByText(workItem.title)).toBeTruthy();
    expect(screen.getByText(executionPackage.objective)).toBeTruthy();
    expect(screen.getByText('Blockers')).toBeTruthy();
    expect(screen.getByText('Fixture release ready')).toBeTruthy();
    expect(screen.getByText('Risk summary')).toBeTruthy();
    expect(screen.getByText('Release notes are attached.')).toBeTruthy();
    expect(screen.getByText('No regressions observed during smoke checks.')).toBeTruthy();
    expect(screen.getByText('Release owner approved readiness.')).toBeTruthy();
    expect(screen.getByText('Timeline / Replay')).toBeTruthy();
    expect(screen.getByText(timeline[0].summary)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit release' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Acknowledge test acceptance' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Override approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start observing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close release' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit observation evidence' })).toBeTruthy();
    expect(screen.getByLabelText('Override rationale')).toBeTruthy();
    expect(screen.getByLabelText('Close confirmation')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Edit release' }));
    const editDialog = screen.getByRole('dialog', { name: 'Edit release details' });
    const titleInput = within(editDialog).getByLabelText('Release title');
    await user.clear(titleInput);
    await user.type(titleInput, 'Edited release cockpit');
    await user.click(within(editDialog).getByRole('button', { name: 'Save release' }));

    await waitFor(() => {
      const [, init] =
        vi.mocked(globalThis.fetch).mock.calls.find(
          ([input, requestInit]) => String(input).includes(`/releases/${release.id}`) && requestInit?.method === 'PATCH',
        ) ??
        [];
      expect(init).toBeDefined();
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual(expect.objectContaining({ actor_id: actorId, title: 'Edited release cockpit' }));
      expect(body).not.toHaveProperty('release_id');
    });

    await user.type(screen.getByLabelText('Test acceptance summary'), 'QA accepted route-backed release controls.');
    await user.type(screen.getByLabelText('Acceptance evidence reference'), 'artifacts/test-acceptance.md');
    await user.click(screen.getByRole('button', { name: 'Acknowledge test acceptance' }));

    await waitFor(() => {
      const [, init] =
        vi.mocked(globalThis.fetch).mock.calls.find(([input]) =>
          String(input).includes(`/releases/${release.id}/test-acceptance/acknowledge`),
        ) ?? [];
      expect(init).toBeDefined();
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        actor_id: actorId,
        summary: 'QA accepted route-backed release controls.',
        evidence_refs: [
          {
            kind: 'check_output',
            name: 'Test acceptance evidence',
            content_type: 'text/markdown',
            local_ref: 'artifacts/test-acceptance.md',
          },
        ],
      });
      expect(body).not.toHaveProperty('risk_notes');
      expect(body.evidence_refs[0]).not.toHaveProperty('ref');
    });
  });

  it('links release scope through project-scoped object pickers instead of raw ids', async () => {
    const user = userEvent.setup();
    const candidateWorkItem = {
      ...workItem,
      id: 'work-item-release-candidate',
      title: 'Release picker candidate work item',
    };
    const candidatePackage = {
      ...executionPackage,
      id: 'package-release-candidate',
      objective: 'Release picker candidate package',
      work_item_id: candidateWorkItem.id,
    };
    const screen = await renderRoute(`/releases/${release.id}`, {
      apiOverrides: {
        [`GET /query/release-cockpit/${release.id}`]: releaseCockpitResponse,
        [`GET /query/work-items?project_id=${projectId}&limit=100`]: {
          items: [workItem, candidateWorkItem].map((item) => ({
            id: item.id,
            object: {
              type: 'work_item',
              id: item.id,
              title: item.title,
            },
            title: item.title,
            status: item.activity_state,
            phase: item.phase,
            gate_state: item.gate_state,
            resolution: item.resolution,
            risk: item.risk,
            owner_actor_id: item.owner_actor_id,
            related: [],
            counts: {},
            updated_at: item.updated_at,
          })),
          degraded_sources: [],
        },
        [`GET /query/execution-packages?project_id=${projectId}&limit=100`]: {
          items: [
            {
              id: candidatePackage.id,
              object: {
                type: 'execution_package',
                id: candidatePackage.id,
                title: candidatePackage.objective,
              },
              title: candidatePackage.objective,
              phase: candidatePackage.phase,
              risk: workItem.risk,
              owner_actor_id: candidatePackage.owner_actor_id,
              reviewer_actor_id: candidatePackage.reviewer_actor_id,
              qa_owner_actor_id: candidatePackage.qa_owner_actor_id,
              parent: {
                type: 'work_item',
                id: candidateWorkItem.id,
                title: candidateWorkItem.title,
              },
              related: [],
              revision_state: {
                current_revision_id: candidatePackage.plan_revision_id,
              },
              package_state: {
                work_item_id: candidatePackage.work_item_id,
                spec_revision_id: candidatePackage.spec_revision_id,
                plan_revision_id: candidatePackage.plan_revision_id,
                surface_type: 'web',
                last_run_session_id: candidatePackage.last_run_session_id,
              },
              counts: {},
              updated_at: candidatePackage.updated_at,
            },
          ],
          degraded_sources: [],
        },
        [`POST /releases/${release.id}/work-items/${candidateWorkItem.id}`]: {
          release_id: release.id,
          object_type: 'work_item',
          object_id: candidateWorkItem.id,
          linked: true,
        },
        [`POST /releases/${release.id}/execution-packages/${candidatePackage.id}`]: {
          release_id: release.id,
          object_type: 'execution_package',
          object_id: candidatePackage.id,
          linked: true,
        },
      },
    });

    expect(await screen.findByRole('combobox', { name: 'Work Item' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: candidateWorkItem.title })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Execution Package' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: candidatePackage.objective })).toBeTruthy();
    expect(screen.queryByPlaceholderText(/id from scoped search/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/work item id/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/package id/i)).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Work Item' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Execution Package' })).toBeNull();
    expect(screen.getByText('Add Work Item')).toBeTruthy();
    expect(screen.getByText('Add Execution Package')).toBeTruthy();
    expect(screen.queryByText('Link WorkItem')).toBeNull();
    expect(screen.queryByText('Unlink WorkItem')).toBeNull();
    expect(screen.queryByText('Link ExecutionPackage')).toBeNull();
    expect(screen.queryByText('Unlink ExecutionPackage')).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Work Item' }), candidateWorkItem.id);
    await user.click(screen.getByRole('button', { name: 'Add Work Item' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Execution Package' }), candidatePackage.id);
    await user.click(screen.getByRole('button', { name: 'Add Execution Package' }));

    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/query/work-items?project_id=${projectId}&limit=100`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalledWith(
        `http://localhost:3000/work-items?project_id=${projectId}`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/query/execution-packages?project_id=${projectId}&limit=100`,
        expect.objectContaining({ method: 'GET' }),
      );
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/releases/${release.id}/work-items/${candidateWorkItem.id}`,
        expect.objectContaining({ method: 'POST' }),
      );
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        `http://localhost:3000/releases/${release.id}/execution-packages/${candidatePackage.id}`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
