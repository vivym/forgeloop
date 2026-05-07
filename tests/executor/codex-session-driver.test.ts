import { describe, expect, it, vi } from 'vitest';

import type { RunRuntimeMetadata } from '@forgeloop/domain';
import {
  buildCodexExecArgs,
  confirmAppServerDangerousMode,
  createCodexAppServerDriverForTest,
  resolveEffectiveDangerousMode,
} from '../../packages/executor/src';

const runtimeMetadata = (overrides: Partial<RunRuntimeMetadata> = {}): RunRuntimeMetadata => ({
  durability_mode: 'durable',
  recovery_attempt_count: 0,
  effective_dangerous_mode: 'confirmed',
  ...overrides,
});

describe('codex exec fallback driver boundary', () => {
  it('builds dangerous JSON exec args for a new prompt without sandbox fallback', () => {
    const args = buildCodexExecArgs({ prompt: 'implement task' });

    expect(args).toEqual(['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', 'implement task']);
    expect(args).not.toContain('--sandbox');
    expect(args).not.toContain('--yolo');
  });

  it('builds dangerous JSON resume args for an existing thread', () => {
    expect(buildCodexExecArgs({ prompt: 'continue', threadId: 'thread-1' })).toEqual([
      'exec',
      'resume',
      'thread-1',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      'continue',
    ]);
  });
});

describe('codex app-server dangerous mode confirmation', () => {
  it('resolves confirmed dangerous mode only for never approval and danger-full-access sandbox', () => {
    expect(
      resolveEffectiveDangerousMode({
        approvalPolicy: 'never',
        sandbox: { type: 'dangerFullAccess' },
      }),
    ).toBe('confirmed');
  });

  it('rejects app-server config that is not fully dangerous mode', async () => {
    await expect(
      confirmAppServerDangerousMode({
        approvalPolicy: 'on-request',
        sandbox: { type: 'dangerFullAccess' },
      }),
    ).rejects.toThrow(/dangerous mode/i);
  });
});

describe('codex app-server driver input routing', () => {
  it('steers an active turn or explicit target turn', async () => {
    const request = vi.fn(async () => ({ ok: true }));
    const driver = createCodexAppServerDriverForTest({ request });

    await expect(
      driver.sendInput({
        message: 'adjust course',
        runtimeMetadata: runtimeMetadata({
          codex_thread_id: 'thread-1',
          active_turn_id: 'turn-1',
        }),
      }),
    ).resolves.toMatchObject({ continuity: 'turn_steer' });

    await expect(
      driver.sendInput({
        message: 'target turn',
        targetTurnId: 'turn-2',
        runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1' }),
      }),
    ).resolves.toMatchObject({ continuity: 'turn_steer' });

    expect(request).toHaveBeenNthCalledWith(1, 'turn/steer', {
      input: [{ type: 'text', text: 'adjust course', text_elements: [] }],
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'turn/steer', {
      input: [{ type: 'text', text: 'target turn', text_elements: [] }],
      threadId: 'thread-1',
      expectedTurnId: 'turn-2',
    });
  });

  it('starts a new turn when a thread exists without an active turn', async () => {
    const request = vi.fn(async () => ({ turn: { id: 'turn-3' } }));
    const driver = createCodexAppServerDriverForTest({ request });

    await expect(
      driver.sendInput({
        message: 'next turn',
        runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1' }),
      }),
    ).resolves.toMatchObject({ continuity: 'thread_continuation', turnId: 'turn-3' });

    expect(request).toHaveBeenCalledWith('turn/start', {
      input: [{ type: 'text', text: 'next turn', text_elements: [] }],
      threadId: 'thread-1',
    });
  });
});
