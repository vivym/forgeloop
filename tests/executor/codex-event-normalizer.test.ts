import { describe, expect, it } from 'vitest';

import {
  normalizeCodexAppServerNotification,
  normalizeCodexExecJsonLine,
  truncateString,
} from '../../packages/executor/src';

describe('codex event normalizer', () => {
  it('normalizes app-server assistant message deltas and redacts public secrets', () => {
    const events = normalizeCodexAppServerNotification({
      method: 'codex/event',
      params: {
        type: 'assistant_message_delta',
        delta: 'run with token=sk-test-secret and continue',
        turn_id: 'turn-1',
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        event_type: 'agent_message_delta',
        source: 'codex',
        visibility: 'public',
        summary: 'Codex message',
        payload: {
          message: 'run with token=[REDACTED] and continue',
          turn_id: 'turn-1',
        },
      }),
    ]);
  });

  it('normalizes Codex exec JSONL command output deltas', () => {
    const events = normalizeCodexExecJsonLine(
      JSON.stringify({
        type: 'command_output_delta',
        command: 'pnpm test',
        text: 'PASS tests/domain',
      }),
    );

    expect(events).toEqual([
      {
        event_type: 'command_output_delta',
        source: 'codex',
        visibility: 'public',
        summary: 'Command output',
        payload: {
          command: 'pnpm test',
          text: 'PASS tests/domain',
        },
      },
    ]);
  });

  it('truncates large public payload strings to bounded marker size', () => {
    const truncated = truncateString('a'.repeat(9_000), 8_192);

    expect(truncated.length).toBeLessThanOrEqual(8_200);
    expect(truncated).toContain('[truncated]');
  });
});
