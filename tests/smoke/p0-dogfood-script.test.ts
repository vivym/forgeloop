import { describe, expect, it, vi } from 'vitest';

import {
  buildRunControlRequest,
  buildRunEventListRequest,
  buildRunEventStreamRequest,
  buildRunEventStreamTokenRequest,
  buildRunInputRequest,
  buildRunPackageRequest,
  publicApiAuthChecks,
  renderReport,
  requestRunEventStreamToken,
} from '../../scripts/p0-dogfood';

describe('p0 dogfood script helpers', () => {
  it('sends durable public run API actor identity as X-Forgeloop-Actor-Id headers', () => {
    expect(buildRunPackageRequest('package-1', { mode: 'durable', actorId: 'actor-owner' })).toMatchObject({
      path: '/execution-packages/package-1/run',
      init: {
        method: 'POST',
        headers: { 'X-Forgeloop-Actor-Id': 'actor-owner' },
        body: { requested_by_actor_id: 'actor-owner', workflow_only: true, executor_type: 'mock' },
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

  it('does not send actor_id query fallback for durable event backfill', () => {
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

  it('opens durable SSE streams with stream_token instead of query-only actor_id fallback', () => {
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
      volatileActorFallback: false,
    });
    const passedChecks = publicApiAuthChecks('durable', {
      durablePublicApiHeaderAuth: true,
      durableSseStreamTokenAuth: true,
      volatileActorFallback: false,
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

  it('keeps volatile_demo behavior compatible with body and query actor fallback', () => {
    expect(buildRunEventListRequest('run-1', { mode: 'volatile_demo', actorId: 'actor-owner', after: '0001' }).path).toBe(
      '/run-sessions/run-1/events?actor_id=actor-owner&after=0001',
    );
    expect(buildRunEventStreamRequest('http://api.local', 'run-1', { mode: 'volatile_demo', actorId: 'actor-owner', after: '0001' }).url).toBe(
      'http://api.local/run-sessions/run-1/events/stream?actor_id=actor-owner&after=0001',
    );
    expect(buildRunInputRequest('run-1', { mode: 'volatile_demo', actorId: 'actor-owner', message: 'Continue' }).init.body).toEqual({
      actor_id: 'actor-owner',
      message: 'Continue',
    });
  });
});
