import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

import { normalizeCodexAppServerNotification } from './codex-event-normalizer.js';
import type { CodexRawLogStore } from './codex-raw-log-store.js';
import type {
  CodexDriverStartInput,
  CodexDriverStreamItem,
  CodexSessionDriver,
  RunRuntimeMetadata,
} from './codex-session-driver.js';

type SandboxConfig = { type: string } | string | null | undefined;

export interface CodexEffectiveConfig {
  approvalPolicy?: string | null | undefined;
  sandbox?: SandboxConfig;
}

export interface CodexAppServerTransport {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  notifications?(): AsyncIterable<unknown>;
  close?(): Promise<void>;
}

export interface CodexAppServerDriverOptions {
  transport: CodexAppServerTransport;
  rawLogStore?: CodexRawLogStore;
}

export interface CodexAppServerProcessTransportOptions {
  codexBinary?: string;
  args?: string[];
}

const textInput = (message: string): Array<Record<string, unknown>> => [{ type: 'text', text: message, text_elements: [] }];

const responseConfig = (response: unknown): CodexEffectiveConfig => {
  if (response !== null && typeof response === 'object') {
    const record = response as Record<string, unknown>;
    const config: CodexEffectiveConfig = {};
    if (typeof record.approvalPolicy === 'string') {
      config.approvalPolicy = record.approvalPolicy;
    }
    if ('sandbox' in record) {
      config.sandbox = record.sandbox as SandboxConfig;
    }

    return config;
  }

  return {};
};

export const resolveEffectiveDangerousMode = (config: CodexEffectiveConfig): RunRuntimeMetadata['effective_dangerous_mode'] => {
  const sandbox = config.sandbox;
  const sandboxType = typeof sandbox === 'string' ? sandbox : sandbox?.type;

  return config.approvalPolicy === 'never' && (sandboxType === 'dangerFullAccess' || sandboxType === 'danger-full-access')
    ? 'confirmed'
    : 'unconfirmed';
};

export const confirmAppServerDangerousMode = async (
  configOrPromise: CodexEffectiveConfig | Promise<CodexEffectiveConfig>,
): Promise<'confirmed'> => {
  const config = await configOrPromise;
  if (resolveEffectiveDangerousMode(config) !== 'confirmed') {
    throw new Error('Codex app-server dangerous mode was not confirmed by effective response config.');
  }

  return 'confirmed';
};

const extractThreadId = (response: unknown): string | undefined => {
  if (response !== null && typeof response === 'object') {
    const record = response as Record<string, unknown>;
    if (typeof record.threadId === 'string') {
      return record.threadId;
    }

    const thread = record.thread;
    if (thread !== null && typeof thread === 'object' && typeof (thread as Record<string, unknown>).id === 'string') {
      return (thread as Record<string, unknown>).id as string;
    }
  }

  return undefined;
};

const extractTurnId = (response: unknown): string | undefined => {
  if (response !== null && typeof response === 'object') {
    const record = response as Record<string, unknown>;
    if (typeof record.turnId === 'string') {
      return record.turnId;
    }

    const turn = record.turn;
    if (turn !== null && typeof turn === 'object' && typeof (turn as Record<string, unknown>).id === 'string') {
      return (turn as Record<string, unknown>).id as string;
    }
  }

  return undefined;
};

export class CodexAppServerDriver implements CodexSessionDriver {
  readonly kind = 'app_server' as const;
  readonly #transport: CodexAppServerTransport;
  readonly #rawLogStore: CodexRawLogStore | undefined;

  constructor(options: CodexAppServerDriverOptions) {
    this.#transport = options.transport;
    this.#rawLogStore = options.rawLogStore;
  }

  async *startRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    try {
      const threadResponse = await this.#transport.request('thread/start', {
        cwd: input.workspacePath,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      });
      await confirmAppServerDangerousMode(responseConfig(threadResponse));

      const threadId = extractThreadId(threadResponse);
      if (threadId === undefined) {
        throw new Error('Codex app-server thread/start did not return a thread id.');
      }

      yield {
        kind: 'event',
        event: {
          event_type: 'thread_started',
          source: 'codex',
          visibility: 'public',
          summary: 'Codex thread started.',
          payload: { thread_id: threadId },
        },
        runtimeMetadata: {
          driver_kind: 'app_server',
          driver_status: 'active',
          codex_thread_id: threadId,
          effective_dangerous_mode: 'confirmed',
        },
      };

      const turnResponse = await this.#transport.request('turn/start', {
        threadId,
        input: textInput(input.runSpec.objective),
        cwd: input.workspacePath,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' },
      });
      const turnId = extractTurnId(turnResponse);

      const runtimeMetadata: Partial<RunRuntimeMetadata> = {
        driver_kind: 'app_server',
        driver_status: 'active',
      };
      if (turnId !== undefined) {
        runtimeMetadata.active_turn_id = turnId;
      }

      yield {
        kind: 'event',
        event: {
          event_type: 'turn_started',
          source: 'codex',
          visibility: 'public',
          summary: 'Codex turn started.',
          payload: { thread_id: threadId, turn_id: turnId },
        },
        runtimeMetadata,
      };

      yield* this.#streamNotifications(input.runSpec.run_session_id);
    } catch (error) {
      yield {
        kind: 'event',
        event: {
          event_type: 'driver_fallback_used',
          source: 'executor',
          visibility: 'public',
          summary: 'Codex app-server failed preflight; fallback is required.',
          payload: {
            reason: error instanceof Error ? error.message : 'Unknown app-server error.',
          },
        },
        runtimeMetadata: {
          driver_kind: 'exec_fallback',
          driver_status: 'starting',
        },
      };
    }
  }

  async *resumeRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    const threadId = input.runtimeMetadata?.codex_thread_id;
    if (threadId === undefined) {
      yield {
        kind: 'event',
        event: {
          event_type: 'driver_fallback_used',
          source: 'executor',
          visibility: 'public',
          summary: 'Codex app-server resume requires a thread id; fallback is required.',
          payload: {},
        },
        runtimeMetadata: {
          driver_kind: 'exec_fallback',
          driver_status: 'starting',
        },
      };
      return;
    }

    try {
      const response = await this.#transport.request('thread/resume', {
        threadId,
        cwd: input.workspacePath,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      });
      await confirmAppServerDangerousMode(responseConfig(response));

      yield {
        kind: 'event',
        event: {
          event_type: 'thread_resumed',
          source: 'codex',
          visibility: 'public',
          summary: 'Codex thread resumed.',
          payload: { thread_id: threadId },
        },
        runtimeMetadata: {
          driver_kind: 'app_server',
          driver_status: 'active',
          codex_thread_id: threadId,
          effective_dangerous_mode: 'confirmed',
        },
      };

      yield* this.#streamNotifications(input.runSpec.run_session_id);
    } catch (error) {
      yield {
        kind: 'event',
        event: {
          event_type: 'driver_fallback_used',
          source: 'executor',
          visibility: 'public',
          summary: 'Codex app-server resume failed; fallback is required.',
          payload: {
            reason: error instanceof Error ? error.message : 'Unknown app-server error.',
          },
        },
        runtimeMetadata: {
          driver_kind: 'exec_fallback',
          driver_status: 'starting',
        },
      };
    }
  }

  async sendInput(input: {
    message: string;
    runtimeMetadata: RunRuntimeMetadata;
    targetTurnId?: string;
  }): Promise<Record<string, unknown>> {
    const threadId = input.runtimeMetadata.codex_thread_id;
    if (threadId === undefined) {
      throw new Error('Cannot send Codex app-server input without runtimeMetadata.codex_thread_id.');
    }

    const activeTurnId = input.targetTurnId ?? input.runtimeMetadata.active_turn_id;
    if (activeTurnId !== undefined) {
      const response = await this.#transport.request('turn/steer', {
        threadId,
        input: textInput(input.message),
        expectedTurnId: activeTurnId,
      });
      return {
        continuity: 'turn_steer',
        threadId,
        turnId: activeTurnId,
        response,
      };
    }

    const response = await this.#transport.request('turn/start', {
      threadId,
      input: textInput(input.message),
    });
    return {
      continuity: 'thread_continuation',
      threadId,
      turnId: extractTurnId(response),
      response,
    };
  }

  async cancelRun(input: { runtimeMetadata: RunRuntimeMetadata }): Promise<Record<string, unknown>> {
    const threadId = input.runtimeMetadata.codex_thread_id;
    const turnId = input.runtimeMetadata.active_turn_id;
    if (threadId === undefined || turnId === undefined) {
      return { acknowledged: false, reason: 'missing_thread_or_turn' };
    }

    const response = await this.#transport.request('turn/interrupt', { threadId, turnId });
    return {
      acknowledged: true,
      threadId,
      turnId,
      response,
    };
  }

  async *#streamNotifications(runSessionId: string): AsyncIterable<CodexDriverStreamItem> {
    const notifications = this.#transport.notifications?.();
    if (notifications === undefined) {
      return;
    }

    for await (const notification of notifications) {
      const rawRef = await this.#rawLogStore?.appendRawNotification({
        runSessionId,
        source: 'app_server',
        payload: notification,
      });

      for (const event of normalizeCodexAppServerNotification(notification)) {
        if (rawRef !== undefined) {
          event.raw_ref = rawRef.raw_ref;
        }
        yield { kind: 'event', event };
      }
    }
  }
}

export class CodexAppServerProcessTransport implements CodexAppServerTransport {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  readonly #notificationQueue: unknown[] = [];
  #requestId = 0;
  #closed = false;

  constructor(options: CodexAppServerProcessTransportOptions = {}) {
    this.#child = spawn(options.codexBinary ?? 'codex', options.args ?? ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      this.#handleLine(line);
    });
    this.#child.once('close', () => {
      this.#closed = true;
      for (const pending of this.#pending.values()) {
        pending.reject(new Error('Codex app-server process closed before the request completed.'));
      }
      this.#pending.clear();
    });
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.#requestId;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    const response = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#child.stdin.write(`${payload}\n`);
    return response;
  }

  async *notifications(): AsyncIterable<unknown> {
    while (!this.#closed || this.#notificationQueue.length > 0) {
      const notification = this.#notificationQueue.shift();
      if (notification !== undefined) {
        yield notification;
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async close(): Promise<void> {
    this.#child.kill('SIGTERM');
    this.#closed = true;
  }

  #handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      return;
    }

    if (message !== null && typeof message === 'object') {
      const record = message as Record<string, unknown>;
      if (typeof record.id === 'number') {
        const pending = this.#pending.get(record.id);
        if (pending === undefined) {
          return;
        }
        this.#pending.delete(record.id);

        if (record.error !== undefined) {
          pending.reject(record.error);
          return;
        }

        pending.resolve(record.result);
        return;
      }
    }

    this.#notificationQueue.push(message);
  }
}

export const createCodexAppServerDriverForTest = (transport: CodexAppServerTransport): CodexSessionDriver =>
  new CodexAppServerDriver({ transport });
