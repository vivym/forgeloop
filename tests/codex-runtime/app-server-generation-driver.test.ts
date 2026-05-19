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
      sandboxPolicy: { type: 'readOnly' },
    });
    expect(request).toHaveBeenNthCalledWith(2, 'turn/start', {
      approvalPolicy: 'never',
      input: [{ type: 'text', text: '{}', text_elements: [] }],
      sandboxPolicy: { type: 'readOnly' },
      threadId: 'thread-1',
    });
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

  it('allows explicit cancellation while collecting notifications', async () => {
    const close = vi.fn(async () => {});
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
      runtimeSafety: fakeSafety(),
    });

    const generation = driver.generate({ taskKind: 'plan_draft', prompt: '{}', outputSchemaVersion: 'plan_draft.v1', timeoutMs: 500 });
    await delay(5);
    await driver.cancel();

    await expect(withTestTimeout(generation)).rejects.toThrow(/codex_generation_cancelled/);
    expect(request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' });
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
});

describe('app-server endpoint and generation safety contracts', () => {
  it('rejects process-spawning app-server endpoints and accepts unix sockets', () => {
    expect(() => parseCodexAppServerEndpoint('exec:codex app-server')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(() => parseCodexAppServerEndpoint('cli')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(() => parseCodexAppServerEndpoint('spawn:/tmp/fake')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(() => parseCodexAppServerEndpoint('stdio')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(() => parseCodexAppServerEndpoint('http://127.0.0.1:1234')).toThrow(/codex_app_server_endpoint_invalid/);
    expect(parseCodexAppServerEndpoint('unix:/tmp/codex-app-server.sock')).toEqual({
      type: 'unix',
      path: '/tmp/codex-app-server.sock',
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
