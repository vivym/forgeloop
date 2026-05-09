import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import type { RunRuntimeMetadata } from '@forgeloop/domain';
import {
  buildCodexExecArgs,
  CodexAppServerProcessTransport,
  CodexExecFallbackDriver,
  confirmAppServerDangerousMode,
  createCodexAppServerDriverForTest,
  resolveEffectiveDangerousMode,
} from '../../packages/executor/src';

import { createRunSpec } from './test-fixtures';

const runtimeMetadata = (overrides: Partial<RunRuntimeMetadata> = {}): RunRuntimeMetadata => ({
  durability_mode: 'durable',
  recovery_attempt_count: 0,
  effective_dangerous_mode: 'confirmed',
  ...overrides,
});

const withTimeout = async <T>(promise: Promise<T>, message: string): Promise<T> =>
  Promise.race([
    promise,
    delay(250).then(() => {
      throw new Error(message);
    }),
  ]);

const collectUntilTerminal = async (items: AsyncIterable<unknown>): Promise<unknown[]> => {
  const collected: unknown[] = [];
  for await (const item of items) {
    collected.push(item);
    if (typeof item === 'object' && item !== null && (item as { kind?: unknown }).kind === 'terminal') {
      break;
    }
  }

  return collected;
};

const missingCodexBinary = () => join(tmpdir(), `missing-codex-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const waitForProcessExit = async (pid: number): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await delay(25);
  }

  throw new Error(`Process ${pid} was still running.`);
};

const waitForProtocolMethods = async (logPath: string, expected: string[]): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const messages = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { method: string });

      if (JSON.stringify(messages.map((message) => message.method)) === JSON.stringify(expected)) {
        return;
      }
    } catch {
      // The fake process creates the protocol log lazily after the first message.
    }
    await delay(25);
  }

  throw new Error(`Timed out waiting for protocol methods: ${expected.join(', ')}`);
};

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

  it('yields a failed terminal item when codex cannot be spawned', async () => {
    const driver = new CodexExecFallbackDriver({ codexBinary: missingCodexBinary() });

    await expect(
      withTimeout(
        collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
        'Codex exec spawn failure did not terminate.',
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: 'terminal',
        status: 'failed',
        failure: expect.objectContaining({
          kind: 'executor_process_failed',
          retryable: true,
        }),
      }),
    ]);
  });

  it('rejects input continuation when codex cannot be spawned', async () => {
    const driver = new CodexExecFallbackDriver({ codexBinary: missingCodexBinary() });

    await expect(
      driver.sendInput({
        message: 'continue',
        runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1' }),
      }),
    ).rejects.toThrow(/spawn/i);
  });

  it('kills the spawned exec process when the stream consumer returns early', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'forgeloop-codex-exec-'));
    const pidPath = join(directory, 'pid.txt');
    const binaryPath = join(directory, 'codex-fake.js');
    await writeFile(
      binaryPath,
      `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
console.log(JSON.stringify({ type: 'command_output_delta', command: 'pnpm test', text: 'still running' }));
setInterval(() => {}, 1000);
`,
    );
    await chmod(binaryPath, 0o755);

    const driver = new CodexExecFallbackDriver({ codexBinary: binaryPath });
    const iterator = driver.startRun({ runSpec: createRunSpec(), workspacePath: directory })[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: {
        kind: 'event',
      },
    });

    await iterator.return?.();
    const pid = Number(await readFile(pidPath, 'utf8'));
    await waitForProcessExit(pid);

    expect(() => process.kill(pid, 0)).toThrow();
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

  it.each([
    {
      approvalPolicy: 'never',
      sandbox: { type: 'danger-full-access' },
    },
    {
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    },
    {
      approvalPolicy: 'never',
      sandbox: { type: 'workspaceWrite' },
    },
    {
      approvalPolicy: 'on-request',
      sandbox: { type: 'dangerFullAccess' },
    },
  ])('does not confirm non-response dangerous mode config %#', (config) => {
    expect(resolveEffectiveDangerousMode(config)).toBe('unconfirmed');
  });
});

describe('codex app-server driver input routing', () => {
  it('initializes the app-server transport before starting a thread', async () => {
    const calls: string[] = [];
    const driver = createCodexAppServerDriverForTest({
      initialize: async () => {
        calls.push('initialize');
      },
      request: async (method: string) => {
        calls.push(method);
        return method === 'thread/start'
          ? {
              thread: { id: 'thread-1' },
              approvalPolicy: 'never',
              sandbox: { type: 'dangerFullAccess' },
            }
          : { turn: { id: 'turn-1' } };
      },
      notifications: async function* () {
        yield {
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: { id: 'turn-1', status: 'completed', error: null },
          },
        };
      },
    });

    await collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() }));

    expect(calls.slice(0, 3)).toEqual(['initialize', 'thread/start', 'turn/start']);
  });

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

  it('terminates startRun when a turn/completed notification reports completion', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createCodexAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'item/agentMessage/delta',
          params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'done' },
        };
        yield {
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: { id: 'turn-1', status: 'completed', error: null },
          },
        };
        await new Promise(() => undefined);
      },
    });

    await expect(
      withTimeout(
        collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
        'Codex app-server startRun did not terminate after turn/completed.',
      ),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'turn_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'agent_message_delta' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'succeeded',
        summary: 'Codex app-server turn completed.',
      }),
    ]);
  });

  it('terminates startRun when the app-server reports the thread idle without turn/completed', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createCodexAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'item/completed',
          params: {
            item: { type: 'userMessage', id: 'item-1' },
            threadId: 'thread-1',
            turnId: 'turn-1',
          },
        };
        yield {
          method: 'thread/status/changed',
          params: {
            threadId: 'thread-1',
            status: { type: 'idle' },
          },
        };
        await new Promise(() => undefined);
      },
    });

    await expect(
      withTimeout(
        collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
        'Codex app-server startRun did not terminate after idle thread status.',
      ),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'turn_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'codex_warning' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'codex_warning' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'succeeded',
        summary: 'Codex app-server thread became idle.',
      }),
    ]);
  });

  it('fails startRun when notifications end before turn completion', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createCodexAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'item/agentMessage/delta',
          params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'working' },
        };
      },
    });

    await expect(
      collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'turn_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'agent_message_delta' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'failed',
        summary: 'Codex app-server notification stream ended before turn completion.',
        failure: expect.objectContaining({
          kind: 'executor_error',
          retryable: true,
        }),
      }),
    ]);
  });

  it('fails startRun when no notification stream is available after turn start', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createCodexAppServerDriverForTest({ request });

    await expect(
      collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'turn_started' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'failed',
        summary: 'Codex app-server notification stream ended before turn completion.',
      }),
    ]);
  });

  it('maps failed turn/completed notifications to retryable terminal failures', async () => {
    const request = vi.fn(async () => ({
      thread: { id: 'thread-1' },
      approvalPolicy: 'never',
      sandbox: { type: 'dangerFullAccess' },
    }));
    const driver = createCodexAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: {
              id: 'turn-1',
              status: 'failed',
              error: { message: 'model request failed', additionalDetails: 'rate limit' },
            },
          },
        };
      },
    });

    await expect(
      collectUntilTerminal(
        driver.resumeRun({
          runSpec: createRunSpec(),
          workspacePath: tmpdir(),
          runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1' }),
        }),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_resumed' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'failed',
        failure: expect.objectContaining({
          kind: 'executor_error',
          message: expect.stringContaining('model request failed'),
          retryable: true,
        }),
      }),
    ]);
  });
});

describe('codex app-server process transport', () => {
  it('sends an idempotent initialize handshake to the process transport', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'forgeloop-codex-app-server-'));
    const logPath = join(directory, 'protocol.ndjson');
    const binaryPath = join(directory, 'app-server-fake.js');
    await writeFile(
      binaryPath,
      `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const logPath = ${JSON.stringify(logPath)};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  fs.appendFileSync(logPath, line + '\\n');
  const message = JSON.parse(line);
  if (message.method === 'initialize' && message.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        userAgent: 'fake',
        codexHome: ${JSON.stringify(directory)},
        platformFamily: 'unix',
        platformOs: 'macos'
      }
    }) + '\\n');
  }
});
`,
    );
    await chmod(binaryPath, 0o755);

    const transport = new CodexAppServerProcessTransport({ codexBinary: binaryPath, args: [] });
    await transport.initialize();
    await transport.initialize();
    await waitForProtocolMethods(logPath, ['initialize', 'initialized']);
    await transport.close();

    const messages = (await readFile(logPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { method: string; params?: { clientInfo?: { name?: string } } });

    expect(messages.map((message) => message.method)).toEqual(['initialize', 'initialized']);
    expect(messages[0]?.params?.clientInfo?.name).toBe('forgeloop');
  });

  it('rejects pending requests when the app-server process cannot be spawned', async () => {
    const transport = new CodexAppServerProcessTransport({ codexBinary: missingCodexBinary() });

    await expect(transport.request('thread/start', {})).rejects.toThrow(/spawn/i);
    await transport.close();
  });
});
