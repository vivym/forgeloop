import { describe, expect, it } from 'vitest';

import {
  buildBackfillRequest,
  buildStreamTokenRequest,
  buildStreamUrl,
  formatRunEventLine,
  parseTailArgs,
} from '../../scripts/tail-run-events';

describe('tail run events script helpers', () => {
  it('builds the backfill-first and stream-token request flow', () => {
    expect(buildBackfillRequest('http://api.local', 'run-1', { actorId: 'actor-owner' })).toEqual({
      url: 'http://api.local/run-sessions/run-1/events',
      init: { headers: { 'X-Forgeloop-Actor-Id': 'actor-owner' } },
    });
    expect(buildBackfillRequest('http://api.local', 'run-1', { actorId: 'actor-owner', after: '0000000000' }).url).toBe(
      'http://api.local/run-sessions/run-1/events?after=0000000000',
    );
    expect(buildStreamTokenRequest('http://api.local', 'run-1', 'actor-owner')).toEqual({
      url: 'http://api.local/run-sessions/run-1/events/stream-token',
      init: { method: 'POST', headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': 'actor-owner' } },
    });
    expect(buildStreamUrl('http://api.local', 'run-1', { streamToken: 'token-1', after: '0000000000' })).toBe(
      'http://api.local/run-sessions/run-1/events/stream?stream_token=token-1&after=0000000000',
    );
  });

  it('formats only default timeline events', () => {
    expect(formatRunEventLine({ cursor: '0000000001', event_type: 'watchdog_heartbeat', visibility: 'public', summary: 'tick' })).toBeUndefined();
    expect(
      formatRunEventLine({
        cursor: '0000000002',
        event_type: 'agent_message_delta',
        visibility: 'public',
        summary: 'Codex output.',
        payload: { text: 'hello' },
      }),
    ).toBe('0000000002 agent_message_delta hello');
  });

  it('requires run id and actor id arguments', () => {
    expect(() => parseTailArgs(['--run-session-id', 'run-1'])).toThrow('actor id is required');
    expect(parseTailArgs(['--', '--api-url', 'http://api.local', '--run-session-id', 'run-1', '--actor-id', 'actor-owner'])).toMatchObject({
      apiUrl: 'http://api.local',
      runSessionId: 'run-1',
      actorId: 'actor-owner',
    });
  });
});
