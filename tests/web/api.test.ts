import { afterEach, describe, expect, it, vi } from 'vitest';

import { createForgeloopCommandApi } from '../../apps/web/src/shared/api/commands';
import { ForgeloopApiError } from '../../apps/web/src/shared/api/common';
import { createForgeloopQueryApi } from '../../apps/web/src/shared/api/query';
import {
  executionPackage,
  plan,
  spec,
  workItem,
} from './fixtures/product-data';

describe('Forgeloop web API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends JSON bodies to normalized endpoint URLs', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'work-item-1', title: 'Ship release cockpit' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local/root/', fetch: fetchMock });

    const intakeContext = {
      type: 'bug',
      impact_summary: 'Checkout fails for signed-in users.',
      observed_behavior: 'Submit returns an error toast.',
      expected_behavior: 'Order is created or validation is shown.',
      reproduction_steps: ['Sign in', 'Add item to cart', 'Submit checkout'],
      affected_environment: 'Production web',
      verification_path: 'Regression test for checkout submit',
    } as const;

    const result = await api.createWorkItem({
      project_id: 'project-1',
      kind: 'bug',
      title: 'Checkout fails',
      goal: 'Checkout fails for signed-in users; expected order creation or validation.',
      success_criteria: ['Order is created or validation is shown', 'Regression test for checkout submit'],
      priority: 'P0',
      risk: 'high',
      driver_actor_id: 'actor-driver',
      intake_context: intakeContext,
    });

    expect(result).toMatchObject({ id: 'work-item-1' });
    expect(fetchMock).toHaveBeenCalledWith('http://api.local/root/work-items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project_id: 'project-1',
        kind: 'bug',
        title: 'Checkout fails',
        goal: 'Checkout fails for signed-in users; expected order creation or validation.',
        success_criteria: ['Order is created or validation is shown', 'Regression test for checkout submit'],
        priority: 'P0',
        risk: 'high',
        driver_actor_id: 'actor-driver',
        intake_context: intakeContext,
      }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty('owner_actor_id');
  });

  it('rejects Work Item create bodies with execution owner fields before POSTing', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'work-item-1' }), { status: 201 }));
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local/root/', fetch: fetchMock });

    const intakeContext = {
      type: 'bug',
      impact_summary: 'Checkout fails for signed-in users.',
      observed_behavior: 'Submit returns an error toast.',
      expected_behavior: 'Order is created or validation is shown.',
      reproduction_steps: ['Sign in', 'Add item to cart', 'Submit checkout'],
      affected_environment: 'Production web',
      verification_path: 'Regression test for checkout submit',
    } as const;

    await expect(
      api.createWorkItem({
        project_id: 'project-1',
        kind: 'bug',
        title: 'Checkout fails',
        goal: 'Checkout fails for signed-in users; expected order creation or validation.',
        success_criteria: ['Order is created or validation is shown', 'Regression test for checkout submit'],
        priority: 'P0',
        risk: 'high',
        driver_actor_id: 'actor-driver',
        owner_actor_id: 'actor-owner',
        intake_context: intakeContext,
      } as any),
    ).rejects.toThrow();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encodes query parameters and command request bodies', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await api.listReleases({ project_id: 'project with spaces' });
    await api.approveItemSpec('development-plan-1', 'development-plan-item-1', { actor_id: 'actor-reviewer' });

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://api.local/releases?project_id=project+with+spaces', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://api.local/development-plans/development-plan-1/items/development-plan-item-1/spec/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-reviewer', 'X-Forgeloop-Actor-Class': 'human_admin' },
      body: JSON.stringify({ actor_id: 'actor-reviewer' }),
    });
  });

  it('fetches evidence chains with an optional focused review packet', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          work_item_id: 'work item/1',
          generated_at: '2026-05-08T00:00:00.000Z',
          focus: { selection: 'explicit', review_packet_ids: ['review packet/1'] },
          projection: { source: 'trace_events', version: 1, partial: false, gaps: [] },
          summary: {
            total_items: 0,
            run_count: 0,
            review_packet_count: 0,
            decision_count: 0,
            artifact_count: 0,
            risk_flags: [],
            redacted_count: 0,
          },
          items: [],
        }),
        { status: 200 },
      ),
    );
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local/root/', fetch: fetchMock });

    const result = await api.getEvidenceChain('work item/1', 'review packet/1');

    expect(result.focus.selection).toBe('explicit');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.local/root/work-items/work%20item%2F1/evidence-chain?review_packet_id=review+packet%2F1',
      {
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      },
    );
  });

  it('patches execution package content without sending repo_id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'package-1' }), { status: 200 }));
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await api.patchExecutionPackage('package-1', {
      objective: 'Tighten package edit controls',
      owner_actor_id: 'actor-owner',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      required_checks: [
        {
          check_id: 'web-build',
          display_name: 'Web build',
          command: 'pnpm --filter @forgeloop/web build',
          timeout_seconds: 600,
          blocks_review: true,
        },
      ],
      required_artifact_kinds: ['diff', 'check_output'],
      allowed_paths: ['apps/web/**'],
      forbidden_paths: ['apps/control-plane-api/**'],
    });

    expect(fetchMock).toHaveBeenCalledWith('http://api.local/execution-packages/package-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        objective: 'Tighten package edit controls',
        owner_actor_id: 'actor-owner',
        reviewer_actor_id: 'actor-reviewer',
        qa_owner_actor_id: 'actor-qa',
        required_checks: [
          {
            check_id: 'web-build',
            display_name: 'Web build',
            command: 'pnpm --filter @forgeloop/web build',
            timeout_seconds: 600,
            blocks_review: true,
          },
        ],
        required_artifact_kinds: ['diff', 'check_output'],
        allowed_paths: ['apps/web/**'],
        forbidden_paths: ['apps/control-plane-api/**'],
      }),
    });
  });

  it('surfaces backend error messages from non-2xx responses', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: 'Spec is not awaiting approval', code: 'INVALID_TRANSITION' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await expect(api.approveItemSpec('development-plan-1', 'development-plan-item-1', {})).rejects.toMatchObject({
      name: 'ForgeloopApiError',
      message: 'Spec is not awaiting approval',
      status: 400,
      details: { code: 'INVALID_TRANSITION' },
    } satisfies Partial<ForgeloopApiError>);
  });

  it('propagates actor ids as headers to run event and operator command endpoints', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/events')) {
        return new Response(JSON.stringify({ events: [{ id: 'event-1', sequence: 1 }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    });
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await api.listRunEvents('run-1', { actorId: 'actor owner', after: '0000000001' });
    await api.sendRunInput('run-1', 'actor-owner', 'continue', 'turn-1');
    await api.cancelRun('run-1', 'actor-owner', 'operator requested stop');
    await api.resumeRun('run-1', 'actor-owner', 'operator requested resume');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://api.local/run-sessions/run-1/events?after=0000000001',
      {
        method: 'GET',
        headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor owner', 'X-Forgeloop-Actor-Class': 'human_admin' },
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://api.local/run-sessions/run-1/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-owner', 'X-Forgeloop-Actor-Class': 'human_admin' },
      body: JSON.stringify({ message: 'continue', target_turn_id: 'turn-1' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://api.local/run-sessions/run-1/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-owner', 'X-Forgeloop-Actor-Class': 'human_admin' },
      body: JSON.stringify({ reason: 'operator requested stop' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'http://api.local/run-sessions/run-1/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-owner', 'X-Forgeloop-Actor-Class': 'human_admin' },
      body: JSON.stringify({ reason: 'operator requested resume' }),
    });
  });

  it('includes explicit run event after cursors even for sentinel values', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ events: [], next_cursor: '0000000000', has_more: false }), { status: 200 }));
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await api.listRunEvents('run-1', { actorId: 'actor-owner', after: '0000000000' });

    expect(fetchMock).toHaveBeenCalledWith('http://api.local/run-sessions/run-1/events?after=0000000000', expect.any(Object));
  });

  it('propagates actor ids as headers to package run commands without body actor fields', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }));
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await api.runPackage('package-1', 'actor-owner', { workflow_only: true });

    expect(fetchMock).toHaveBeenCalledWith('http://api.local/execution-packages/package-1/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-owner', 'X-Forgeloop-Actor-Class': 'human_admin' },
      body: JSON.stringify({ workflow_only: true }),
    });
  });

  it('rejects run event helpers before sending requests without an actor id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await expect(api.listRunEvents('run-1', { actorId: '' })).rejects.toThrow('actorId is required');
    await expect(api.sendRunInput('run-1', '', 'continue')).rejects.toThrow('actorId is required');
    await expect(api.cancelRun('run-1', '   ')).rejects.toThrow('actorId is required');
    await expect(api.resumeRun('run-1', '')).rejects.toThrow('actorId is required');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens run event streams with stream tokens and parses incoming messages', async () => {
    const instances: Array<{ url: string; close: ReturnType<typeof vi.fn>; onmessage?: (event: MessageEvent) => void; onerror?: (error: Event) => void }> = [];
    class MockEventSource {
      readonly url: string;
      readonly close = vi.fn();
      onmessage?: (event: MessageEvent) => void;
      onerror?: (error: Event) => void;

      constructor(url: string) {
        this.url = url;
        instances.push(this);
      }
    }
    vi.stubGlobal('EventSource', MockEventSource);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ token: 'stream-token-1', expires_at: '2026-05-08T00:00:00.000Z' }), { status: 201 }),
    );
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });
    const onEvent = vi.fn();
    const onError = vi.fn();

    const stream = await api.openRunEventStream('run-1', { actorId: 'actor owner', after: '0000000001' }, { onEvent, onError });

    expect(fetchMock).toHaveBeenCalledWith('http://api.local/run-sessions/run-1/events/stream-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor owner', 'X-Forgeloop-Actor-Class': 'human_admin' },
    });
    expect(instances[0]?.url).toBe('http://api.local/run-sessions/run-1/events/stream?stream_token=stream-token-1&after=0000000001');
    instances[0]?.onmessage?.({ data: JSON.stringify({ id: 'event-1', sequence: 1 }) } as MessageEvent);
    const error = new Event('error');
    instances[0]?.onerror?.(error);
    stream.close();

    expect(onEvent).toHaveBeenCalledWith({ id: 'event-1', sequence: 1 });
    expect(onError).toHaveBeenCalledWith(error);
    expect(instances[0]?.close).toHaveBeenCalled();
  });

  it('routes malformed run event stream messages to the error handler', async () => {
    const instances: Array<{ url: string; close: ReturnType<typeof vi.fn>; onmessage?: (event: MessageEvent) => void; onerror?: (error: Event) => void }> = [];
    class MockEventSource {
      readonly url: string;
      readonly close = vi.fn();
      onmessage?: (event: MessageEvent) => void;
      onerror?: (error: Event) => void;

      constructor(url: string) {
        this.url = url;
        instances.push(this);
      }
    }
    vi.stubGlobal('EventSource', MockEventSource);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ token: 'stream-token-1', expires_at: '2026-05-08T00:00:00.000Z' }), { status: 201 }),
    );
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });
    const onEvent = vi.fn();
    const onError = vi.fn();

    await api.openRunEventStream('run-1', { actorId: 'actor-owner' }, { onEvent, onError });
    instances[0]?.onmessage?.({ data: '{not-json' } as MessageEvent);

    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(SyntaxError));
  });

  it('routes malformed stream token responses to the error handler', async () => {
    class MockEventSource {
      readonly close = vi.fn();

      constructor() {
        throw new Error('EventSource should not open without a stream token');
      }
    }
    vi.stubGlobal('EventSource', MockEventSource);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 123 }), { status: 201 }));
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });
    const onEvent = vi.fn();
    const onError = vi.fn();

    await expect(api.openRunEventStream('run-1', { actorId: 'actor-owner' }, { onEvent, onError })).rejects.toThrow(
      'Malformed run event stream token response',
    );

    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('routes typed product queries through the query client without raw runtime reads', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify({ items: [], degraded_sources: [] }), { status: 200 });
    });
    const queryApi = createForgeloopQueryApi({ baseUrl: 'http://api.local/root/', fetch: fetchMock });

    await queryApi.listRequirements({ project_id: 'project 1', limit: 25 });

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://api.local/root/query/requirements?project_id=project+1&limit=25', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('routes release command methods through the release API', async () => {
    const snapshot = {
      release_id: 'release/1',
      generated_at: '2026-05-11T00:00:00.000Z',
      blocker_fingerprint: 'fingerprint-1',
      blockers: [
        {
          code: 'missing_observation_plan',
          category: 'planning',
          overrideable: true,
          message: 'Observation plan is required.',
        },
      ],
    } as const;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ release: { id: 'release/1' } }), { status: 200 }));
    const api = createForgeloopCommandApi({ baseUrl: 'http://api.local/root/', fetch: fetchMock });

    await api.createRelease({
      actor_id: 'actor-owner',
      project_id: 'project-1',
      title: 'Release Radar',
    });
    await api.getRelease('release/1', 'project with spaces');
    await api.submitReleaseForApproval('release/1', { actor_id: 'actor-owner' });
    await api.acknowledgeReleaseTestAcceptance('release/1', {
      actor_id: 'actor-qa',
      summary: 'QA accepts the existing test evidence.',
    });
    await api.overrideApproveRelease('release/1', {
      actor_id: 'actor-owner',
      rationale: 'Accept planning blocker.',
      blocker_snapshot: snapshot,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://api.local/root/releases', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-owner', 'X-Forgeloop-Actor-Class': 'human_admin' },
      body: JSON.stringify({
        actor_id: 'actor-owner',
        project_id: 'project-1',
        title: 'Release Radar',
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://api.local/root/releases/release%2F1?project_id=project+with+spaces', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://api.local/root/releases/release%2F1/submit-for-approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-owner', 'X-Forgeloop-Actor-Class': 'human_admin' },
      body: JSON.stringify({ actor_id: 'actor-owner' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'http://api.local/root/releases/release%2F1/test-acceptance/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-qa', 'X-Forgeloop-Actor-Class': 'human_admin' },
      body: JSON.stringify({
        actor_id: 'actor-qa',
        summary: 'QA accepts the existing test evidence.',
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(5, 'http://api.local/root/releases/release%2F1/override-approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-owner', 'X-Forgeloop-Actor-Class': 'human_admin' },
      body: JSON.stringify({
        actor_id: 'actor-owner',
        rationale: 'Accept planning blocker.',
        blocker_snapshot: snapshot,
      }),
    });
  });

  it('routes release cockpit, Product Lane, and Work Item action reads through the query client', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/query/product-lanes/')) {
        return new Response(
          JSON.stringify({
            lane_id: 'execution-owner',
            label: 'Execution Owner',
            description: 'Execution packages that need owner attention.',
            items: [],
            unsupported_filters: [],
            summary: { total: 0, blocked: 0, high_risk: 0, stale: 0 },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const queryApi = createForgeloopQueryApi({ baseUrl: 'http://api.local/root/', fetch: fetchMock });

    await queryApi.getReleaseCockpit('release/1');
    await queryApi.getProductLane('execution-owner', {
      project_id: 'project 1',
      actor_id: 'actor-owner',
      limit: 25,
      blocked: true,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://api.local/root/query/release-cockpit/release%2F1', {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://api.local/root/query/product-lanes/execution-owner?project_id=project+1&actor_id=actor-owner&limit=25&blocked=true',
      {
        method: 'GET',
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches Product Lane projections with all supported filters', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          lane_id: 'qa-test-owner',
          label: 'QA / Test Owner',
          description: 'QA attention.',
          items: [],
          unsupported_filters: [],
          summary: { total: 0, blocked: 0, high_risk: 0, stale: 0 },
        }),
        { status: 200 },
      ),
    );
    const queryApi = createForgeloopQueryApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await queryApi.getProductLane('qa-test-owner', {
      project_id: 'project 1',
      actor_id: 'actor/owner',
      qa_owner_actor_id: 'actor/owner',
      kind: 'initiative',
      limit: 25,
      cursor: 'item 1',
      phase: 'triage',
      status: 'needs_review',
      gate_state: 'awaiting_test',
      resolution: 'none',
      risk: 'high risk',
      blocked: false,
      stale: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.local/query/product-lanes/qa-test-owner?project_id=project+1&actor_id=actor%2Fowner&qa_owner_actor_id=actor%2Fowner&kind=initiative&limit=25&cursor=item+1&phase=triage&status=needs_review&gate_state=awaiting_test&resolution=none&risk=high+risk&blocked=false&stale=true',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('whitelists document-workspace query filters before sending requests', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [],
          degraded_sources: [],
        }),
        { status: 200 },
      ),
    );
    const queryApi = createForgeloopQueryApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await queryApi.listRequirements({
      project_id: 'project-1',
      driver_actor_id: 'actor-driver',
      owner_actor_id: 'actor-owner',
    } as any);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.local/query/requirements?project_id=project-1&driver_actor_id=actor-driver',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('keeps command and query client method surfaces separate', () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const commandApi = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });
    const queryApi = createForgeloopQueryApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    const commandMethods = Object.keys(commandApi);
    const retiredReadMethods = ['Cockpit', 'Timeline'].map((suffix) => `get${suffix}`);
    for (const method of retiredReadMethods) {
      expect(commandMethods).not.toContain(method);
    }
    expect(commandMethods).not.toContain('getWorkItemCockpit');
    expect(commandMethods).not.toContain('getWorkItemReplay');
    expect(Object.keys(queryApi).sort()).toEqual(['getProductLane', 'getReleaseCockpit']);
  });
});
