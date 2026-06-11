import { describe, expect, it, vi } from 'vitest';

import { createForgeloopCommandApi } from '../../apps/web/src/shared/api/commands';
import { createForgeloopQueryApi } from '../../apps/web/src/shared/api/query';
import { queryKeys } from '../../apps/web/src/shared/api/query-keys';
import { productLaneQueryFromSearchParams } from '../../apps/web/src/shared/api/types';
import {
  parseRoleLens,
  roleLensActorFilter,
  roleLensValues,
} from '../../apps/web/src/features/product-surfaces/role-lens';

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

describe('AI-native web API client contract', () => {
  it('exposes AI-native workflow commands without product Task or direct Spec/Plan commands', () => {
    const commands = createForgeloopCommandApi();
    const query = createForgeloopQueryApi();

    for (const method of [
      'generateDevelopmentPlanDraft',
      'regenerateDevelopmentPlanDraft',
      'linkPlanningInputToDevelopmentPlan',
      'startPlanItemWorkflowBrainstorming',
      'recordWorkflowMessage',
      'runWorkflowQueuedAction',
      'approveWorkflowArtifactRevision',
      'requestWorkflowArtifactChanges',
      'evaluateWorkflowExecutionReadiness',
      'markExecutionReadyForCodeReview',
      'acceptQaHandoff',
    ]) {
      expect(commands, `commands.${method}`).toHaveProperty(method);
    }

    for (const method of [
      'getDashboard',
      'listDevelopmentPlans',
      'getDevelopmentPlanItem',
      'listDocumentReviewQueue',
      'listExecutions',
      'listCodeReviewHandoffs',
      'listQaHandoffs',
    ]) {
      expect(query, `query.${method}`).toHaveProperty(method);
    }

    expect(commands).not.toHaveProperty('createTask');
    expect(commands).not.toHaveProperty('createSpec');
    expect(commands).not.toHaveProperty('createPlan');
    expect(commands).not.toHaveProperty('generateItemSpecDraft');
    expect(commands).not.toHaveProperty('regenerateItemSpecDraft');
    expect(commands).not.toHaveProperty('generateItemImplementationPlanDraft');
    expect(commands).not.toHaveProperty('regenerateItemImplementationPlanDraft');
    expect(commands).not.toHaveProperty('startItemExecution');
    expect(commands).not.toHaveProperty('startBrainstormingSession');
    expect(commands).not.toHaveProperty('answerBrainstormingQuestion');
    expect(commands).not.toHaveProperty('recordBrainstormingDecision');
    expect(commands).not.toHaveProperty('approveBoundary');
  });

  it('strictly parses typed Requirement projections without client-side business fallbacks', async () => {
    const query = createForgeloopQueryApi({
      fetch: async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'req-missing-projection-fields',
                ref: { type: 'requirement', id: 'req-missing-projection-fields', title: 'Missing projection fields' },
                title: 'Missing projection fields',
                status: 'ready_for_planning',
                priority: 'high',
                risk: 'high',
                driver_actor_id: 'actor-product',
                updated_at: '2026-05-27T08:00:00.000Z',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    await expect(query.listRequirements({ project_id: 'project-1' })).rejects.toThrow();
  });

  it('maps role lenses onto explicit actor filters without owner fallbacks', () => {
    expect(roleLensValues).toEqual(['all', 'product', 'tech-lead', 'developer', 'reviewer', 'qa', 'release', 'manager']);
    expect(parseRoleLens('developer')).toBe('developer');
    expect(parseRoleLens('unknown')).toBe('all');

    expect(roleLensActorFilter('product', 'actor-product')).toEqual({ driver_actor_id: 'actor-product' });
    expect(roleLensActorFilter('developer', 'actor-dev')).toEqual({ execution_owner_actor_id: 'actor-dev' });
    expect(roleLensActorFilter('reviewer', 'actor-reviewer')).toEqual({ reviewer_actor_id: 'actor-reviewer' });
    expect(roleLensActorFilter('qa', 'actor-qa')).toEqual({ qa_owner_actor_id: 'actor-qa' });
    expect(roleLensActorFilter('release', 'actor-release')).toEqual({ release_owner_actor_id: 'actor-release' });
    expect(roleLensActorFilter('manager', 'actor-manager')).toEqual({});
    expect(roleLensActorFilter('tech-lead', 'actor-tech')).toEqual({ reviewer_actor_id: 'actor-tech' });
    expect(roleLensActorFilter('developer', undefined)).toEqual({});
  });

  it('preserves actor filters in typed document and Development Plan query keys and URLs', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [], degraded_sources: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const query = createForgeloopQueryApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await query.listRequirements({
      project_id: 'project-1',
      driver_actor_id: 'actor-product',
      execution_owner_actor_id: 'actor-dev',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      release_owner_actor_id: 'actor-release',
    });
    await query.listDevelopmentPlans({
      project_id: 'project-1',
      driver_actor_id: 'actor-product',
      execution_owner_actor_id: 'actor-dev',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      release_owner_actor_id: 'actor-release',
    });

    expect(queryKeys.requirements({
      project_id: 'project-1',
      execution_owner_actor_id: 'actor-dev',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      release_owner_actor_id: 'actor-release',
    })).toEqual([
      'requirements',
      {
        project_id: 'project-1',
        execution_owner_actor_id: 'actor-dev',
        reviewer_actor_id: 'actor-reviewer',
        qa_owner_actor_id: 'actor-qa',
        release_owner_actor_id: 'actor-release',
      },
    ]);
    expect(queryKeys.developmentPlans({
      project_id: 'project-1',
      execution_owner_actor_id: 'actor-dev',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      release_owner_actor_id: 'actor-release',
    })[1]).toMatchObject({
      execution_owner_actor_id: 'actor-dev',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      release_owner_actor_id: 'actor-release',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://api.local/query/requirements?project_id=project-1&driver_actor_id=actor-product&execution_owner_actor_id=actor-dev&reviewer_actor_id=actor-reviewer&qa_owner_actor_id=actor-qa&release_owner_actor_id=actor-release',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://api.local/query/development-plans?project_id=project-1&driver_actor_id=actor-product&execution_owner_actor_id=actor-dev&reviewer_actor_id=actor-reviewer&qa_owner_actor_id=actor-qa&release_owner_actor_id=actor-release',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('calls product-level session operations routes', async () => {
    const responses = [
      { items: [], filters: { state: 'blocked_stale_lease' } },
      {
        plan_item_id: 'item-1',
        workflow_resolution: 'active_workflow',
        summary: 'Worker lease expired.',
        operator_intervention_required: true,
        normal_workflow_actions_available: false,
        recovery_request_available: true,
      },
      { record: { id: 'recovery-1' }, before: {}, after: {}, replayed: false },
      { mode: 'dry_run', candidates: [] },
    ];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const queryApi = createForgeloopQueryApi({ baseUrl: 'http://api.local', fetch: fetchMock });
    const commandApi = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await queryApi.listSessionOperationsHealth({ state: 'blocked_stale_lease' });
    await queryApi.getPlanItemSessionDiagnostics('item-1');
    await commandApi.recoverSession('session-1', {
      operation_idempotency_key: 'recover-session-1-stale-lease',
      operation: 'recover',
      reason: 'Release stale worker lease.',
      candidate_predicate: recoverPredicateFixture(),
    });
    await commandApi.scavengeSessionOperations({ mode: 'dry_run' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://api.local/session-operations/health?state=blocked_stale_lease',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://api.local/plan-items/item-1/session-diagnostics',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://api.local/session-operations/session-1/recover',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://api.local/session-operations/scavenge',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      operation: 'recover',
      operation_idempotency_key: 'recover-session-1-stale-lease',
      candidate_predicate: {
        codex_session_id: 'session-1',
        workflow: { checked: true, state: 'present', value: { id: 'workflow-1' } },
        active_lease: { checked: true, state: 'present', value: { worker_id: 'worker-1' } },
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).not.toHaveProperty('actor_id');
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({ mode: 'dry_run' });
  });

  it('keeps execution owner filters in Product Lane URL state for Plan Item execution views', () => {
    expect(
      productLaneQueryFromSearchParams(
        'requirements',
        new URLSearchParams('execution_owner_actor_id=actor-dev&driver_actor_id=actor-product'),
        'project-1',
      ),
    ).toMatchObject({
      project_id: 'project-1',
      driver_actor_id: 'actor-product',
      execution_owner_actor_id: 'actor-dev',
    });
  });

  it('returns the queued-action workflow run envelope', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          workflow: { id: 'workflow-1', status: 'spec_review' },
          queued_action: { id: 'action-1', workflow_id: 'workflow-1', status: 'running' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const commands = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await expect(
      commands.runWorkflowQueuedAction('workflow-1', 'action-1', { actor_id: 'actor-tech' }),
    ).resolves.toMatchObject({
      workflow: { id: 'workflow-1', status: 'spec_review' },
      queued_action: { id: 'action-1', workflow_id: 'workflow-1', status: 'running' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.local/plan-item-workflows/workflow-1/actions/action-1/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ actor_id: 'actor-tech' }),
        headers: expect.objectContaining({
          'X-Forgeloop-Actor-Id': 'actor-tech',
        }),
      }),
    );
  });

  it('sends Wave 7 Plan Item Workflow commands with product-safe bodies only', async () => {
    const responses = [
      { status: 'execution_running' },
      { status: 'code_review' },
      { status: 'execution_running' },
      { status: 'code_review' },
    ];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'workflow-1', ...responses.shift() }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const commands = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });
    const digest = `sha256:${'a'.repeat(64)}`;

    await commands.continuePlanItemWorkflowExecution('workflow-1', {
      actor_id: 'actor-dev',
      idempotency_key: 'continue-key',
      input_markdown: 'Continue the interrupted execution.',
    });
    await commands.respondToPlanItemWorkflowReview('workflow-1', {
      actor_id: 'actor-reviewer',
      expected_review_packet_id: 'review-packet-1',
      expected_review_packet_digest: digest,
      response_prompt_markdown: 'Explain why this change is safe.',
    });
    await commands.requestPlanItemWorkflowReviewFix('workflow-1', {
      actor_id: 'actor-reviewer',
      expected_review_packet_id: 'review-packet-1',
      expected_review_packet_digest: digest,
      fix_instruction_markdown: 'Apply the requested changes.',
    });
    await commands.abandonPlanItemWorkflowSession('workflow-1', {
      actor_id: 'actor-tech',
      next_action: 'request_fix',
      confirmation_phrase: 'abandon current session and start new session',
      reason: 'The current writer can no longer terminalize safely.',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://api.local/plan-item-workflows/workflow-1/execution/continue',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-dev' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://api.local/plan-item-workflows/workflow-1/code-review/respond',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-reviewer' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://api.local/plan-item-workflows/workflow-1/code-review/request-fix',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-reviewer' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://api.local/plan-item-workflows/workflow-1/recovery/abandon-and-new-session',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Forgeloop-Actor-Id': 'actor-tech' }),
      }),
    );

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies).toEqual([
      {
        actor_id: 'actor-dev',
        idempotency_key: 'continue-key',
        input_markdown: 'Continue the interrupted execution.',
      },
      {
        actor_id: 'actor-reviewer',
        expected_review_packet_id: 'review-packet-1',
        expected_review_packet_digest: digest,
        response_prompt_markdown: 'Explain why this change is safe.',
      },
      {
        actor_id: 'actor-reviewer',
        expected_review_packet_id: 'review-packet-1',
        expected_review_packet_digest: digest,
        fix_instruction_markdown: 'Apply the requested changes.',
      },
      {
        actor_id: 'actor-tech',
        next_action: 'request_fix',
        confirmation_phrase: 'abandon current session and start new session',
        reason: 'The current writer can no longer terminalize safely.',
      },
    ]);
    for (const body of bodies) {
      expect(JSON.stringify(body)).not.toMatch(
        /codex_thread_id|codex_session_id|capsule_ref|memory_bundle_ref|environment_manifest_ref|lease_token|worker_id|credential|\/Users\//i,
      );
    }
  });
});
