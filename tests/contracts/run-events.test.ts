import { describe, expect, it } from 'vitest';

import {
  publicRunEventSchema,
  runAcceptedResponseSchema,
  runEventListResponseSchema,
  runOperatorCommandResponseSchema,
} from '@forgeloop/contracts';

describe('long-running run event contracts', () => {
  const publicEvent = {
    id: 'event-1',
    run_session_id: 'run-session-1',
    sequence: 1,
    cursor: 'cursor-1',
    event_type: 'agent_message_completed',
    source: 'codex',
    visibility: 'public',
    summary: 'Codex completed a message.',
    payload: {
      message: 'Ready for review.',
    },
    created_at: '2026-05-07T01:00:00.000Z',
  };

  it('parses accepted run responses and rejects workflow results', () => {
    const parsed = runAcceptedResponseSchema.parse({
      status: 'accepted',
      run_session_id: 'run-session-1',
      execution_package_id: 'exec-package-1',
    });

    expect(parsed).toEqual({
      status: 'accepted',
      run_session_id: 'run-session-1',
      execution_package_id: 'exec-package-1',
    });
    expect(
      runAcceptedResponseSchema.safeParse({
        ...parsed,
        workflow_result: {
          status: 'succeeded',
        },
      }).success,
    ).toBe(false);
  });

  it('parses public run events without raw refs and rejects internal visibility', () => {
    const parsed = publicRunEventSchema.parse(publicEvent);

    expect(parsed).toEqual(publicEvent);
    expect(parsed.visibility).toBe('public');
    expect('raw_ref' in parsed).toBe(false);
    expect(publicRunEventSchema.safeParse({ ...publicEvent, visibility: 'internal' }).success).toBe(false);
    expect(publicRunEventSchema.safeParse({ ...publicEvent, raw_ref: 'local://raw/event-1.json' }).success).toBe(false);
    expect(publicRunEventSchema.safeParse({ ...publicEvent, sequence: 0 }).success).toBe(false);
    expect(
      publicRunEventSchema.safeParse({
        ...publicEvent,
        event_id: 'legacy-event-1',
        execution_package_id: 'exec-package-1',
        occurred_at: '2026-05-07T01:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('parses run event list responses', () => {
    const parsed = runEventListResponseSchema.parse({
      events: [publicEvent],
      next_cursor: 'cursor-2',
      has_more: true,
    });

    expect(parsed.events).toHaveLength(1);
    expect(parsed.next_cursor).toBe('cursor-2');
    expect(parsed.has_more).toBe(true);
  });

  it.each(['input', 'cancel', 'resume'] as const)('parses accepted %s operator command responses', (commandType) => {
    const parsed = runOperatorCommandResponseSchema.parse({
      status: 'accepted',
      command_id: `command-${commandType}-1`,
      run_session_id: 'run-session-1',
      command_type: commandType,
    });

    expect(parsed.command_type).toBe(commandType);
    expect(parsed.status).toBe('accepted');
  });
});
