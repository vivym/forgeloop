import { describe, expect, it, vi } from 'vitest';

import {
  buildDurableDogfoodSeed,
  buildRunControlRequest,
  buildRunEventListRequest,
  buildRunEventStreamRequest,
  buildRunEventStreamTokenRequest,
  buildRunInputRequest,
  buildRunPackageRequest,
  deliveryDogfoodStatus,
  dogfoodChildEnv,
  publicApiAuthChecks,
  renderReport,
  requestRunEventStreamToken,
} from '../../scripts/delivery-dogfood';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('delivery dogfood script helpers', () => {
  it('builds durable seed data with UUID-backed actor and delivery ids', () => {
    const seed = buildDurableDogfoodSeed({
      prefix: 'durable-test',
      repoId: 'forgeloop',
      repoPath: '/repo/forgeloop',
      now: '2026-05-08T03:00:00.000Z',
    });

    const uuidValues = [
      seed.organization.id,
      seed.actors.owner.id,
      seed.actors.reviewer.id,
      seed.actors.qa.id,
      seed.records.project.id,
      seed.records.workItem.id,
      seed.records.spec.id,
      seed.records.specRevision.id,
      seed.records.plan.id,
      seed.records.planRevision.id,
      seed.records.executionPackage.id,
      seed.records.runSession.id,
    ];
    for (const value of uuidValues) {
      expect(value).toMatch(uuidPattern);
    }
    expect(seed.actors.owner.org_id).toBe(seed.organization.id);
    expect(seed.actors.reviewer.org_id).toBe(seed.organization.id);
    expect(seed.actors.qa.org_id).toBe(seed.organization.id);
    expect(seed.records.project.org_id).toBe(seed.organization.id);
    expect(seed.records.project.owner_actor_id).toBe(seed.actors.owner.id);
    expect(seed.records.workItem.project_id).toBe(seed.records.project.id);
    expect(seed.records.workItem.driver_actor_id).toBe(seed.actors.owner.id);
    expect(seed.records.workItem.current_spec_id).toBe(seed.records.spec.id);
    expect(seed.records.workItem.current_plan_id).toBe(seed.records.plan.id);
    expect(seed.records.spec.work_item_id).toBe(seed.records.workItem.id);
    expect(seed.records.spec.current_revision_id).toBe(seed.records.specRevision.id);
    expect(seed.records.specRevision.spec_id).toBe(seed.records.spec.id);
    expect(seed.records.plan.work_item_id).toBe(seed.records.workItem.id);
    expect(seed.records.plan.current_revision_id).toBe(seed.records.planRevision.id);
    expect(seed.records.planRevision.plan_id).toBe(seed.records.plan.id);
    expect(seed.records.planRevision.dependency_order).toEqual([seed.records.executionPackage.id]);
    expect(seed.records.executionPackage.work_item_id).toBe(seed.records.workItem.id);
    expect(seed.records.executionPackage.spec_id).toBe(seed.records.spec.id);
    expect(seed.records.executionPackage.spec_revision_id).toBe(seed.records.specRevision.id);
    expect(seed.records.executionPackage.plan_id).toBe(seed.records.plan.id);
    expect(seed.records.executionPackage.plan_revision_id).toBe(seed.records.planRevision.id);
    expect(seed.records.executionPackage.project_id).toBe(seed.records.project.id);
    expect(seed.records.executionPackage.owner_actor_id).toBe(seed.actors.owner.id);
    expect(seed.records.executionPackage.reviewer_actor_id).toBe(seed.actors.reviewer.id);
    expect(seed.records.executionPackage.qa_owner_actor_id).toBe(seed.actors.qa.id);
    expect(seed.records.executionPackage.required_test_gates).toEqual([]);
    expect(seed.records.executionPackage.last_run_session_id).toBe(seed.records.runSession.id);
    expect(seed.records.runSession.execution_package_id).toBe(seed.records.executionPackage.id);
    expect(seed.records.runSession.requested_by_actor_id).toBe(seed.actors.owner.id);
  });

  it('sends durable public run API actor identity as X-Forgeloop-Actor-Id headers', () => {
    expect(buildRunPackageRequest('package-1', { mode: 'durable', actorId: 'actor-owner' })).toMatchObject({
      path: '/execution-packages/package-1/run',
      init: {
        method: 'POST',
        headers: { 'X-Forgeloop-Actor-Id': 'actor-owner' },
        body: { workflow_only: true, executor_type: 'mock' },
      },
    });
    expect(buildRunEventListRequest('run-1', { mode: 'durable', actorId: 'actor-owner', after: '0001' })).toMatchObject({
      path: '/run-sessions/run-1/events?after=0001',
      init: { headers: { 'X-Forgeloop-Actor-Id': 'actor-owner' } },
    });
    expect(buildRunInputRequest('run-1', { mode: 'durable', actorId: 'actor-owner', message: 'Continue' })).toMatchObject({
      path: '/run-sessions/run-1/input',
      init: { method: 'POST', headers: { 'X-Forgeloop-Actor-Id': 'actor-owner' }, body: { message: 'Continue' } },
    });
    expect(buildRunControlRequest('run-1', 'cancel', { mode: 'durable', actorId: 'actor-owner', reason: 'Stop' })).toMatchObject({
      path: '/run-sessions/run-1/cancel',
      init: { method: 'POST', headers: { 'X-Forgeloop-Actor-Id': 'actor-owner' }, body: { reason: 'Stop' } },
    });
    expect(buildRunControlRequest('run-1', 'resume', { mode: 'durable', actorId: 'actor-owner', reason: 'Resume' })).toMatchObject({
      path: '/run-sessions/run-1/resume',
      init: { method: 'POST', headers: { 'X-Forgeloop-Actor-Id': 'actor-owner' }, body: { reason: 'Resume' } },
    });
  });

  it('does not send actor_id query params for durable event backfill', () => {
    const request = buildRunEventListRequest('run-1', { mode: 'durable', actorId: 'actor-owner', after: '0001' });

    expect(request.path).toBe('/run-sessions/run-1/events?after=0001');
    expect(request.path).not.toContain('actor_id=');
  });

  it('requests durable SSE stream tokens with actor headers before opening the stream', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 'stream-token-1', expires_at: '2026-05-08T00:00:00.000Z' })));

    const token = await requestRunEventStreamToken('http://api.local', 'run-1', {
      mode: 'durable',
      actorId: 'actor-owner',
      fetchImpl: fetchMock,
    });

    expect(token).toBe('stream-token-1');
    expect(fetchMock).toHaveBeenCalledWith('http://api.local/run-sessions/run-1/events/stream-token', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Forgeloop-Actor-Id': 'actor-owner',
        'X-Forgeloop-Actor-Class': 'human_admin',
      },
      body: undefined,
    });
  });

  it('opens durable SSE streams with stream_token instead of query-only actor identity', () => {
    const tokenRequest = buildRunEventStreamTokenRequest('run-1', { mode: 'durable', actorId: 'actor-owner' });
    const streamRequest = buildRunEventStreamRequest('http://api.local', 'run-1', {
      mode: 'durable',
      actorId: 'actor-owner',
      streamToken: 'stream-token-1',
      after: '0001',
    });

    expect(tokenRequest.path).toBe('/run-sessions/run-1/events/stream-token');
    expect(tokenRequest.init.headers).toMatchObject({
      'X-Forgeloop-Actor-Id': 'actor-owner',
      'X-Forgeloop-Actor-Class': 'human_admin',
    });
    expect(streamRequest.url).toBe('http://api.local/run-sessions/run-1/events/stream?stream_token=stream-token-1&after=0001');
    expect(streamRequest.url).not.toContain('actor_id=');
  });

  it('marks durable public API and SSE auth PASS only after header and token flows are exercised', () => {
    const missingChecks = publicApiAuthChecks('durable', {
      durablePublicApiHeaderAuth: false,
      durableSseStreamTokenAuth: false,
      volatilePublicApiHeaderAuth: false,
    });
    const passedChecks = publicApiAuthChecks('durable', {
      durablePublicApiHeaderAuth: true,
      durableSseStreamTokenAuth: true,
      volatilePublicApiHeaderAuth: false,
    });

    expect(missingChecks.map((check) => [check.label, check.status])).toEqual([
      ['Durable public API actor header auth', 'failed'],
      ['Durable SSE stream-token auth', 'failed'],
    ]);
    expect(passedChecks.map((check) => [check.label, check.status])).toEqual([
      ['Durable public API actor header auth', 'passed'],
      ['Durable SSE stream-token auth', 'passed'],
    ]);
    expect(
      renderReport({
        status: 'PASS',
        apiUrl: 'http://api.local',
        results: [],
        checks: passedChecks,
      }),
    ).toContain('- Durable public API actor header auth: PASSED');
  });

  it('does not report dogfood PASS when browser workbench verification fails', () => {
    expect(
      deliveryDogfoodStatus(
        [{ label: 'run', packageId: 'package-1', runSessionId: 'run-1', reviewPacketId: 'review-1', status: 'passed', notes: [] }],
        [
          { label: 'Web app probe', status: 'passed', details: [] },
          { label: 'Browser visual/text-overflow verification', status: 'failed', details: ['browser e2e failed'] },
        ],
      ),
    ).toBe('FAIL');
  });

  it('does not report dogfood PASS when browser workbench verification is skipped', () => {
    expect(
      deliveryDogfoodStatus(
        [{ label: 'run', packageId: 'package-1', runSessionId: 'run-1', reviewPacketId: 'review-1', status: 'passed', notes: [] }],
        [
          { label: 'Web app probe', status: 'passed', details: [] },
          { label: 'Browser visual/text-overflow verification', status: 'skipped', details: ['browser e2e was not run'] },
        ],
      ),
    ).toBe('FAIL');
  });

  it('renders source metadata without leaking local repo paths', () => {
    const report = renderReport({
      status: 'PASS',
      apiUrl: 'http://api.local',
      results: [],
      checks: [],
    });

    expect(report).toContain('Source commit: unknown');
    expect(report).toContain('Source tree before report write: unknown');
    expect(report).not.toContain(process.cwd());
    expect(report).not.toContain('/Users/');
  });

  it('can clear durable database env for browser e2e child commands', () => {
    const env = dogfoodChildEnv(
      { FORGELOOP_DATABASE_URL: 'postgresql://example', KEEP_ME: '1' },
      { FORGELOOP_DATABASE_URL: undefined, EXTRA: '2' },
    );

    expect(env).not.toHaveProperty('FORGELOOP_DATABASE_URL');
    expect(env).toMatchObject({ KEEP_ME: '1', EXTRA: '2' });
  });

  it('uses trusted actor headers for volatile_demo run APIs', () => {
    const listRequest = buildRunEventListRequest('run-1', { mode: 'volatile_demo', actorId: 'actor-owner', after: '0001' });
    const streamRequest = buildRunEventStreamRequest('http://api.local', 'run-1', {
      mode: 'volatile_demo',
      actorId: 'actor-owner',
      after: '0001',
    });

    expect(listRequest.path).toBe('/run-sessions/run-1/events?after=0001');
    expect(listRequest.init.headers).toMatchObject({ 'X-Forgeloop-Actor-Id': 'actor-owner' });
    expect(streamRequest.url).toBe('http://api.local/run-sessions/run-1/events/stream?after=0001');
    expect(streamRequest.headers).toMatchObject({ 'X-Forgeloop-Actor-Id': 'actor-owner' });
    expect(buildRunInputRequest('run-1', { mode: 'volatile_demo', actorId: 'actor-owner', message: 'Continue' }).init.body).toEqual({
      message: 'Continue',
    });
  });
});
