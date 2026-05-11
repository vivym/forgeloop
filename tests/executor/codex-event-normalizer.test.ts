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

  it('redacts local paths and token notification names from public payloads', () => {
    const pathEvents = normalizeCodexAppServerNotification({
      params: {
        type: 'assistant_message_delta',
        delta: 'Updated [README.md](/Users/viv/projs/forgeloop/.worktrees/run-1/README.md)',
      },
    });
    const notificationEvents = normalizeCodexAppServerNotification({
      params: {
        type: 'thread/tokenUsage/updated',
      },
    });
    const commandEvents = normalizeCodexExecJsonLine(
      JSON.stringify({
        type: 'command_output_delta',
        command: 'cat README.md',
        text: 'wrote /private/var/folders/tmp/worktree-path/README.md',
      }),
    );

    expect(JSON.stringify(pathEvents)).not.toContain('/Users/');
    expect(JSON.stringify(pathEvents)).not.toContain('.worktrees');
    expect(pathEvents[0]?.payload.message).toContain('[REDACTED_PATH]');
    expect(JSON.stringify(notificationEvents)).not.toContain('token');
    expect(notificationEvents[0]?.payload.notification_type).toContain('[REDACTED]');
    expect(JSON.stringify(commandEvents)).not.toContain('/private/var/folders/');
    expect(commandEvents[0]?.payload.text).toContain('[REDACTED_PATH]');
  });

  it('truncates large public payload strings to bounded marker size', () => {
    const truncated = truncateString('a'.repeat(9_000), 8_192);

    expect(truncated.length).toBeLessThanOrEqual(8_200);
    expect(truncated).toContain('[truncated]');
  });

  it('keeps unknown notification summaries concise when the type contains secrets or huge strings', () => {
    const events = normalizeCodexAppServerNotification({
      params: {
        type: `token=sk-test-secret-${'a'.repeat(9_000)}`,
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        event_type: 'codex_warning',
        summary: 'Unknown Codex app-server notification',
        payload: {
          notification_type: expect.stringContaining('token=[REDACTED]'),
        },
      }),
    ]);
    expect(events[0]?.summary).not.toContain('sk-test-secret');
    expect(String(events[0]?.payload.notification_type).length).toBeLessThanOrEqual(8_200);
    expect(JSON.stringify(events[0]?.raw_ref)).not.toContain('sk-');
    expect(JSON.stringify(events[0]?.raw_ref).length).toBeLessThanOrEqual(8_300);
  });
});
