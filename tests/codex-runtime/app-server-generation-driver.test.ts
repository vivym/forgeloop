import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  AppServerGenerationDriver,
  createCodexGenerationRuntimeSafety,
  effectiveConfigFromResponse,
  parseCodexAppServerEndpoint,
  type CodexAppServerTransport,
  type CodexGenerationRuntimeSafety,
} from '../../packages/codex-runtime/src/index';

const fakeSafety = (): CodexGenerationRuntimeSafety => ({
  taskKind: 'plan_draft',
  actionRunId: 'action-1',
  projectId: 'project-1',
  repoIds: ['repo-main'],
  artifactRoot: '/tmp/artifacts',
  policyDigests: { 'repo-main': 'sha256:policy' },
  async createGenerationLease() {
    return { lease_id: 'lease-1', expires_at: '2026-05-19T00:10:00.000Z' };
  },
  async consumeGenerationCommand() {},
});

const withTestTimeout = async <T>(promise: Promise<T>, timeoutMs = 100): Promise<T> =>
  Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error('test_timeout_waiting_for_codex_generation_timeout');
    }),
  ]);

describe('AppServerGenerationDriver', () => {
  it('rejects app-server effective danger full access config', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'dangerFullAccess' } } };
        }
        return {};
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/codex_generation_sandbox_invalid/);
  });

  it('rejects source-write app-server sandbox even when approval policy is omitted', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'workspaceWrite' } } };
        }
        return {};
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/codex_generation_sandbox_invalid/);
  });

  it('rejects artifact-only config when writable roots escape artifact root', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return {
            threadId: 'thread-1',
            effectiveConfig: {
              approvalPolicy: 'never',
              sandbox: { type: 'artifactOnly' },
              writableRoots: ['/tmp/artifacts', '/Users/viv/projs/forgeloop'],
            },
          };
        }
        return {};
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/codex_generation_sandbox_invalid/);
  });

  it('requests no approvals and read-only sandbox before collecting generated output', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') {
        return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' }, approvalPolicy: 'never' } };
      }
      if (method === 'turn/start') {
        return { turnId: 'turn-1' };
      }
      return {};
    });
    const transport: CodexAppServerTransport = {
      request,
      notifications: async function* () {
        yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"ok"}' };
        yield { type: 'turn_completed', status: 'completed' };
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    await driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' });

    expect(request).toHaveBeenNthCalledWith(1, 'thread/start', {
      approvalPolicy: 'never',
      sandbox: 'read-only',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'turn/start', {
      approvalPolicy: 'never',
      input: [{ type: 'text', text: '{}', text_elements: [] }],
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      threadId: 'thread-1',
    });
  });

  it('does not send a partial app-server output schema without a complete strict schema', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') {
        return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' }, approvalPolicy: 'never' } };
      }
      return { turnId: 'turn-1' };
    });
    const transport: CodexAppServerTransport = {
      request,
      notifications: async function* () {
        yield { type: 'assistant_message_delta', delta: '{"schema_version":"boundary_round_result.v1","summary":"ok"}' };
        yield { type: 'turn_completed', status: 'completed' };
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: { ...fakeSafety(), taskKind: 'boundary_brainstorming_round' } });

    await driver.generate({
      taskKind: 'boundary_brainstorming_round',
      prompt: '{}',
      outputSchemaVersion: 'boundary_round_result.v1',
    });

    const turnStartParams = request.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(turnStartParams).not.toHaveProperty('outputSchema');
  });

  it('binds generation lease to sandbox policy and hard limits', async () => {
    const leaseInputs: unknown[] = [];
    const safety: CodexGenerationRuntimeSafety = {
      ...fakeSafety(),
      async createGenerationLease(input) {
        leaseInputs.push(input);
        return { lease_id: 'lease-1', expires_at: input.expiresAt };
      },
    };
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
        }
        return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
      },
      notifications: async function* () {
        yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"ok"}' };
        yield { type: 'turn_completed', status: 'completed' };
      },
      async close() {},
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: safety });

    await driver.generate({
      taskKind: 'plan_draft',
      prompt: '{}',
      outputSchemaVersion: 'plan_draft.v1',
      timeoutMs: 123,
      outputLimitBytes: 456,
      rawNotificationLimitBytes: 789,
    });

    expect(leaseInputs[0]).toMatchObject({
      outputSchemaVersion: 'plan_draft.v1',
      sandboxPolicy: 'readOnly',
      writableRoots: [],
      timeoutMs: 123,
      outputLimitBytes: 456,
      rawNotificationLimitBytes: 789,
    });
  });

  it.each([
    ['timeout', { timeoutMs: 0 }, /codex_generation_timeout_ms_invalid/],
    ['output', { outputLimitBytes: 0 }, /codex_generation_output_limit_bytes_invalid/],
    ['raw notification', { rawNotificationLimitBytes: -1 }, /codex_generation_raw_notification_limit_bytes_invalid/],
  ] as const)('rejects non-positive %s limits before starting an app-server turn', async (_name, limits, expectedError) => {
    const request = vi.fn(async () => ({ threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } }));
    const driver = new AppServerGenerationDriver({
      transport: { request },
      runtimeSafety: fakeSafety(),
    });

    await expect(
      driver.generate({
        taskKind: 'plan_draft',
        prompt: '{}',
        outputSchemaVersion: 'plan_draft.v1',
        ...limits,
      }),
    ).rejects.toThrow(expectedError);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects unsafe turn/start effective config after safe thread/start response', async () => {
    const consumedMethods: string[] = [];
    const safety: CodexGenerationRuntimeSafety = {
      ...fakeSafety(),
      async consumeGenerationCommand(input) {
        consumedMethods.push(input.method);
      },
    };
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') {
        return { threadId: 'thread-1', effectiveConfig: { sandboxPolicy: { type: 'readOnly' } } };
      }
      if (method === 'turn/start') {
        return { turnId: 'turn-1', effectiveConfig: { sandboxPolicy: { type: 'dangerFullAccess' } } };
      }
      if (method === 'turn/interrupt') {
        return { acknowledged: true };
      }
      return {};
    });
    const transport: CodexAppServerTransport = {
      request,
      notifications: async function* () {
        yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"ok"}' };
        yield { type: 'turn_completed', status: 'completed' };
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: safety });

    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/codex_generation_sandbox_invalid/);
    expect(consumedMethods).toEqual(['thread/start', 'turn/start', 'turn/interrupt']);
    expect(request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' });
  });

  it('reads effective config from top-level and nested app-server responses', () => {
    expect(
      effectiveConfigFromResponse({
        effectiveConfig: { sandbox: { type: 'readOnly' }, approvalPolicy: 'never' },
      }),
    ).toEqual({ sandbox: { type: 'readOnly' }, approvalPolicy: 'never' });
    expect(
      effectiveConfigFromResponse({
        result: { effective_config: { sandbox_policy: { type: 'readOnly' }, approval_policy: 'never' } },
      }),
    ).toEqual({ sandboxPolicy: { type: 'readOnly' }, approvalPolicy: 'never' });
    expect(
      effectiveConfigFromResponse({
        config: { sandbox_mode: 'read-only', approval_policy: 'never' },
      }),
    ).toEqual({ sandbox: 'read-only', approvalPolicy: 'never' });
  });

  it('blocks app-server mode when generation safety lease is unavailable', async () => {
    const driver = new AppServerGenerationDriver({
      transport: { async request() { return {}; } },
      runtimeSafety: undefined,
    });

    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/codex_generation_safety_unavailable/);
  });

  it('collects assistant output from notifications and validates one JSON object', async () => {
    const close = vi.fn(async () => {});
    async function* notifications() {
      yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"ok"}' };
      yield { type: 'turn_completed', status: 'completed' };
    }
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        if (method === 'turn/start') {
          return { turnId: 'turn-1' };
        }
        return {};
      },
      notifications,
      close,
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    const result = await driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' });

    expect(result.extractedJson).toMatchObject({ schema_version: 'plan_draft.v1' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('prefers the completed final agent message over interim commentary deltas', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        return { turn: { id: 'turn-1', status: 'inProgress', items: [] } };
      },
      notifications: async function* () {
        yield { method: 'item/agentMessage/delta', params: { delta: 'I will produce the requested JSON now.' } };
        yield {
          method: 'item/completed',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            completedAtMs: 1,
            item: {
              type: 'agentMessage',
              id: 'message-1',
              text: '{"schema_version":"plan_draft.v1","summary":"ok"}',
              phase: 'final_answer',
              memoryCitation: null,
            },
          },
        };
        yield { method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed', items: [] } } };
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    const result = await driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' });

    expect(result.assistantText).toBe('{"schema_version":"plan_draft.v1","summary":"ok"}');
    expect(result.extractedJson).toMatchObject({ schema_version: 'plan_draft.v1' });
  });

  it('reads completed final agent messages from the terminal turn snapshot when deltas are absent', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        return { turn: { id: 'turn-1', status: 'inProgress', items: [] } };
      },
      notifications: async function* () {
        yield {
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: {
              id: 'turn-1',
              status: 'completed',
              items: [
                {
                  type: 'agentMessage',
                  id: 'message-1',
                  text: '{"schema_version":"plan_draft.v1","summary":"ok"}',
                  phase: 'final_answer',
                  memoryCitation: null,
                },
              ],
            },
          },
        };
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    const result = await driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' });

    expect(result.extractedJson).toMatchObject({ schema_version: 'plan_draft.v1' });
  });

  it('accepts a completed final agent message followed by idle without turn completion', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        return { turn: { id: 'turn-1', status: 'inProgress', items: [] } };
      },
      notifications: async function* () {
        yield {
          method: 'item/completed',
          params: {
            item: {
              type: 'agentMessage',
              id: 'message-1',
              text: '{"schema_version":"plan_draft.v1","summary":"ok"}',
              phase: 'final_answer',
              memoryCitation: null,
            },
          },
        };
        yield {
          method: 'thread/status/changed',
          params: { threadId: 'thread-1', status: { type: 'idle' } },
        };
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    const result = await driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' });

    expect(result.assistantText).toBe('{"schema_version":"plan_draft.v1","summary":"ok"}');
    expect(result.extractedJson).toMatchObject({ schema_version: 'plan_draft.v1' });
  });

  it('removes completed run abort listeners before the next generation', async () => {
    const oldController = new AbortController();
    let notificationStreams = 0;
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        return { turnId: 'turn-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      },
      notifications: async function* () {
        notificationStreams += 1;
        if (notificationStreams === 1) {
          yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"ok"}' };
          yield { type: 'turn_completed', status: 'completed' };
          return;
        }
        await new Promise(() => undefined);
      },
      async close() {},
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    await driver.generate({
      taskKind: 'plan_draft',
      prompt: '{}',
      outputSchemaVersion: 'plan_draft.v1',
      signal: oldController.signal,
    });
    const secondGeneration = driver.generate({
      taskKind: 'plan_draft',
      prompt: '{}',
      outputSchemaVersion: 'plan_draft.v1',
      timeoutMs: 10,
    });
    await delay(5);
    oldController.abort();

    await expect(withTestTimeout(secondGeneration, 100)).rejects.toThrow(/codex_generation_timeout/);
  });

  it('rejects terminal success with no assistant output', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        return { turnId: 'turn-1' };
      },
      notifications: async function* () {
        yield { type: 'turn_completed', status: 'completed' };
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/generated_output_invalid_json/);
  });

  it('fails when the thread becomes idle before turn completion', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        return { turnId: 'turn-1' };
      },
      notifications: async function* () {
        yield {
          method: 'thread/status/changed',
          params: { threadId: 'thread-1', status: { type: 'idle' } },
        };
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/codex_generation_turn_failed/);
  });

  it('maps app-server usage-limit turn errors to a public-safe reason code', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        return { turnId: 'turn-1' };
      },
      notifications: async function* () {
        yield {
          method: 'turn/completed',
          params: {
            turn: {
              status: 'failed',
              error: {
                message: 'You have hit your usage limit.',
                codexErrorInfo: 'usageLimitExceeded',
              },
            },
          },
        };
      },
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/codex_generation_usage_limited/);
  });

  it('rejects invalid or multiple generated JSON objects', async () => {
    const createDriver = (assistantText: string) =>
      new AppServerGenerationDriver({
        transport: {
          async request(method) {
            if (method === 'thread/start') {
              return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
            }
            return { turnId: 'turn-1' };
          },
          notifications: async function* () {
            yield { type: 'assistant_message_delta', delta: assistantText };
            yield { type: 'turn_completed', status: 'completed' };
          },
        },
        runtimeSafety: fakeSafety(),
      });

    await expect(
      createDriver('not-json').generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/generated_output_invalid_json/);
    await expect(
      createDriver('{"a":1}{"b":2}').generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/generated_output_ambiguous|generated_output_invalid_json/);
  });

  it('times out a never-ending notification stream and closes the transport', async () => {
    const close = vi.fn(async () => {});
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        return { turnId: 'turn-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      },
      notifications: async function* () {
        await new Promise(() => undefined);
      },
      close,
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    await expect(
      withTestTimeout(
        driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1', timeoutMs: 5 }),
      ),
    ).rejects.toThrow(/codex_generation_timeout/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('times out a never-ending app-server request and closes the transport', async () => {
    const close = vi.fn(async () => {});
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        await new Promise(() => undefined);
        return {};
      },
      close,
    };
    const driver = new AppServerGenerationDriver({ transport, runtimeSafety: fakeSafety() });

    await expect(
      withTestTimeout(
        driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1', timeoutMs: 5 }),
      ),
    ).rejects.toThrow(/codex_generation_timeout/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('times out lease creation and closes the initialized transport', async () => {
    const close = vi.fn(async () => {});
    const safety: CodexGenerationRuntimeSafety = {
      ...fakeSafety(),
      async createGenerationLease() {
        await new Promise(() => undefined);
        return { lease_id: 'unreachable', expires_at: '2026-05-19T00:10:00.000Z' };
      },
    };
    const driver = new AppServerGenerationDriver({
      transport: {
        async initialize() {},
        async request() {
          return {};
        },
        close,
      },
      runtimeSafety: safety,
    });

    await expect(
      withTestTimeout(
        driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1', timeoutMs: 5 }),
      ),
    ).rejects.toThrow(/codex_generation_timeout/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects concurrent generation on the same session driver', async () => {
    const driver = new AppServerGenerationDriver({
      transport: {
        async request(method) {
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          await new Promise(() => undefined);
        },
        async close() {},
      },
      runtimeSafety: fakeSafety(),
    });

    const firstGeneration = driver.generate({
      taskKind: 'plan_draft',
      prompt: '{}',
      outputSchemaVersion: 'plan_draft.v1',
      timeoutMs: 100,
    });
    await delay(5);
    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1', timeoutMs: 5 }),
    ).rejects.toThrow(/codex_generation_concurrency_limit_exceeded/);
    await expect(firstGeneration).rejects.toThrow(/codex_generation_timeout/);
  });

  it('interrupts a known turn before closing on timeout', async () => {
    const consumedMethods: string[] = [];
    const close = vi.fn(async () => {});
    const safety: CodexGenerationRuntimeSafety = {
      ...fakeSafety(),
      async consumeGenerationCommand(input) {
        consumedMethods.push(input.method);
      },
    };
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') {
        return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      }
      if (method === 'turn/start') {
        return { turnId: 'turn-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      }
      if (method === 'turn/interrupt') {
        return { acknowledged: true };
      }
      return {};
    });
    const driver = new AppServerGenerationDriver({
      transport: {
        request,
        notifications: async function* () {
          await new Promise(() => undefined);
        },
        close,
      },
      runtimeSafety: safety,
    });

    await expect(
      withTestTimeout(
        driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1', timeoutMs: 5 }),
      ),
    ).rejects.toThrow(/codex_generation_timeout/);
    expect(consumedMethods).toEqual(['thread/start', 'turn/start', 'turn/interrupt']);
    expect(request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not let a hanging interrupt request block timeout cleanup and close', async () => {
    const consumedMethods: string[] = [];
    const close = vi.fn(async () => {});
    const safety: CodexGenerationRuntimeSafety = {
      ...fakeSafety(),
      async consumeGenerationCommand(input) {
        consumedMethods.push(input.method);
      },
    };
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') {
        return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      }
      if (method === 'turn/start') {
        return { turnId: 'turn-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      }
      if (method === 'turn/interrupt') {
        await new Promise(() => undefined);
      }
      return {};
    });
    const driver = new AppServerGenerationDriver({
      transport: {
        request,
        notifications: async function* () {
          await new Promise(() => undefined);
        },
        close,
      },
      runtimeSafety: safety,
    });

    await expect(
      withTestTimeout(
        driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1', timeoutMs: 5 }),
      ),
    ).rejects.toThrow(/codex_generation_timeout/);
    expect(consumedMethods).toEqual(['thread/start', 'turn/start', 'turn/interrupt']);
    expect(request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not send interrupt when cleanup lease consumption fails', async () => {
    const close = vi.fn(async () => {});
    const safety: CodexGenerationRuntimeSafety = {
      ...fakeSafety(),
      async consumeGenerationCommand(input) {
        if (input.method === 'turn/interrupt') {
          throw new Error('resource_governor_lease_invalid');
        }
      },
    };
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/start') {
        return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      }
      if (method === 'turn/start') {
        return { turnId: 'turn-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      }
      return { acknowledged: true };
    });
    const driver = new AppServerGenerationDriver({
      transport: {
        request,
        notifications: async function* () {
          await new Promise(() => undefined);
        },
        close,
      },
      runtimeSafety: safety,
    });

    await expect(
      withTestTimeout(
        driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1', timeoutMs: 5 }),
      ),
    ).rejects.toThrow(/codex_generation_timeout/);
    expect(request).not.toHaveBeenCalledWith('turn/interrupt', expect.anything());
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('records governed interruption consumption before explicit cancellation request', async () => {
    const events: string[] = [];
    const close = vi.fn(async () => {});
    const request = vi.fn(async (method: string) => {
      events.push(`request:${method}`);
      if (method === 'thread/start') {
        return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      }
      if (method === 'turn/start') {
        return { turnId: 'turn-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      }
      return { acknowledged: true };
    });
    const safety: CodexGenerationRuntimeSafety = {
      ...fakeSafety(),
      async consumeGenerationCommand(input) {
        events.push(`consume:${input.method}`);
      },
    };
    const driver = new AppServerGenerationDriver({
      transport: {
        request,
        notifications: async function* () {
          await new Promise(() => undefined);
        },
        close,
      },
      runtimeSafety: safety,
    });

    const generation = driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1', timeoutMs: 500 });
    await delay(5);
    await driver.cancel();

    await expect(withTestTimeout(generation)).rejects.toThrow(/codex_generation_cancelled/);
    expect(request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' });
    expect(events).toEqual([
      'consume:thread/start',
      'request:thread/start',
      'consume:turn/start',
      'request:turn/start',
      'consume:turn/interrupt',
      'request:turn/interrupt',
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects assistant output beyond configured output limit', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        return { turnId: 'turn-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      },
      notifications: async function* () {
        yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"' };
        yield { type: 'assistant_message_delta', delta: 'x'.repeat(80) };
        yield { type: 'assistant_message_delta', delta: '"}' };
        yield { type: 'turn_completed', status: 'completed' };
      },
    };
    const driver = new AppServerGenerationDriver({
      transport,
      runtimeSafety: fakeSafety(),
      limits: { outputLimitBytes: 64 },
    });

    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/generated_output_too_large/);
  });

  it('rejects raw app-server notifications beyond configured raw log limit', async () => {
    const transport: CodexAppServerTransport = {
      async request(method) {
        if (method === 'thread/start') {
          return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        }
        return { turnId: 'turn-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
      },
      notifications: async function* () {
        yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1","summary":"ok"}', raw: 'x'.repeat(256) };
        yield { type: 'turn_completed', status: 'completed' };
      },
    };
    const driver = new AppServerGenerationDriver({
      transport,
      runtimeSafety: fakeSafety(),
      limits: { rawNotificationLimitBytes: 64 },
    });

    await expect(
      driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' }),
    ).rejects.toThrow(/codex_generation_raw_log_too_large/);
  });

  it('keeps raw app-server notification payloads out of thrown errors', async () => {
    const rawPayload = 'raw prompt /Users/viv/private secret-claim-token';
    const driver = new AppServerGenerationDriver({
      transport: {
        async request(method) {
          if (method === 'thread/start') {
            return { threadId: 'thread-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
          }
          return { turnId: 'turn-1', effectiveConfig: { sandbox: { type: 'readOnly' } } };
        },
        notifications: async function* () {
          yield { type: 'assistant_message_delta', delta: '{"schema_version":"plan_draft.v1"}', raw: rawPayload };
          yield { type: 'turn_completed', status: 'completed' };
        },
      },
      runtimeSafety: fakeSafety(),
      limits: { rawNotificationLimitBytes: 64 },
    });

    let thrown: unknown;
    try {
      await driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain('codex_generation_raw_log_too_large');
    expect(message).not.toContain('/Users/viv');
    expect(message).not.toContain('secret-claim-token');
    expect(message).not.toContain('raw prompt');
  });
});

describe('app-server endpoint and generation safety contracts', () => {
  it('rejects process-spawning app-server endpoints and accepts governed sockets', () => {
    expect(() => parseCodexAppServerEndpoint('exec:codex app-server')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(() => parseCodexAppServerEndpoint('cli')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(() => parseCodexAppServerEndpoint('spawn:/tmp/fake')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(() => parseCodexAppServerEndpoint('stdio')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(() => parseCodexAppServerEndpoint('http://127.0.0.1:1234')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(() => parseCodexAppServerEndpoint('ws://token@127.0.0.1:1234')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(() => parseCodexAppServerEndpoint('ws://127.0.0.1:1234?token=secret')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(parseCodexAppServerEndpoint('unix:/tmp/codex-app-server.sock')).toEqual({
      type: 'unix',
      path: '/tmp/codex-app-server.sock',
    });
    expect(parseCodexAppServerEndpoint('ws://127.0.0.1:1234')).toEqual({
      type: 'websocket',
      url: 'ws://127.0.0.1:1234/',
    });
  });

  it('builds production safety only with an artifact root and repo policy digests', async () => {
    expect(() =>
      createCodexGenerationRuntimeSafety({
        taskKind: 'plan_draft',
        actionRunId: 'action-1',
        projectId: 'project-1',
        repoIds: ['repo-main'],
        artifactRoot: undefined,
        policyDigests: { 'repo-main': 'sha256:policy' },
      }),
    ).toThrow(/codex_generation_safety_unavailable/);

    expect(() =>
      createCodexGenerationRuntimeSafety({
        taskKind: 'plan_draft',
        actionRunId: 'action-1',
        projectId: 'project-1',
        repoIds: ['repo-main'],
        artifactRoot: 'relative-artifacts',
        policyDigests: { 'repo-main': 'sha256:policy' },
      }),
    ).toThrow(/codex_generation_safety_unavailable/);

    expect(() =>
      createCodexGenerationRuntimeSafety({
        taskKind: 'plan_draft',
        actionRunId: 'action-1',
        projectId: 'project-1',
        repoIds: ['repo-main'],
        artifactRoot: '/tmp/forgeloop-artifacts',
        policyDigests: {},
      }),
    ).toThrow(/codex_generation_safety_unavailable/);

    const safety = createCodexGenerationRuntimeSafety({
      taskKind: 'plan_draft',
      actionRunId: 'action-1',
      projectId: 'project-1',
      repoIds: ['repo-main'],
      artifactRoot: '/tmp/forgeloop-artifacts',
      policyDigests: { 'repo-main': 'sha256:policy' },
    });
    await expect(
      safety.createGenerationLease({
        promptDigest: 'sha256:prompt',
        contextDigest: 'sha256:context',
        outputSchemaVersion: 'plan_draft.v1',
        sandboxPolicy: 'readOnly',
        writableRoots: [],
        timeoutMs: 300_000,
        outputLimitBytes: 1_048_576,
        rawNotificationLimitBytes: 4_194_304,
        now: '2026-05-19T00:00:00.000Z',
        expiresAt: '2026-05-19T00:05:00.000Z',
      }),
    ).resolves.toMatchObject({ lease_id: expect.stringMatching(/^gen_lease_/), expires_at: '2026-05-19T00:05:00.000Z' });
    await expect(
      safety.consumeGenerationCommand({
        lease: { lease_id: 'lease-1', expires_at: '2026-05-19T00:05:00.000Z' },
        method: 'turn/interrupt',
        commandDigest: 'sha256:interrupt',
        nonce: 'nonce-1',
        now: '2026-05-19T00:01:00.000Z',
      }),
    ).resolves.toBeUndefined();
    await expect(
      safety.consumeGenerationCommand({
        lease: { lease_id: 'lease-1', expires_at: '2026-05-19T00:05:00.000Z' },
        method: 'thread/resume',
        commandDigest: 'sha256:resume',
        nonce: 'nonce-2',
        now: '2026-05-19T00:01:00.000Z',
      }),
    ).rejects.toThrow(/codex_generation_command_invalid/);
  });
});
