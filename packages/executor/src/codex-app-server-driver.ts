import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

import {
  appServerResultFromResponse,
  CodexAppServerJsonRpcClient,
  effectiveConfigFromResponse,
  isRecord,
  textInput,
  type CodexAppServerTransport,
  type CodexEffectiveConfig,
} from '@forgeloop/codex-runtime';
import type { CodexDockerRuntimeEvidence, RunRuntimeMetadata } from '@forgeloop/domain';

import { normalizeCodexAppServerNotification } from './codex-event-normalizer.js';
import type { CodexRawLogStore } from './codex-raw-log-store.js';
import type {
  CodexDriverStartInput,
  CodexDriverStreamItem,
  CodexSessionDriver,
} from './codex-session-driver.js';
import type { LocalCodexRuntimeSafety } from './local-codex-preflight.js';
import { ResourceGovernorError, type RunGovernorBindings, type SandboxLease } from './resource-governor.js';

export interface CodexAppServerDriverOptions {
  transport: CodexAppServerTransport;
  rawLogStore?: CodexRawLogStore;
  runtimeSafety?: LocalCodexRuntimeSafety;
  resourceSafetyMode?: { mode: 'local_governor' } | { mode: 'external_sandbox'; evidence: CodexDockerRuntimeEvidence };
  workerIdentity?: string;
  nonceFactory?: () => string;
  now?: () => string;
}

export interface CodexAppServerProcessTransportOptions {
  codexBinary?: string;
  args?: string[];
  allowUnsafeDirectSpawn?: boolean;
}

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

interface AppServerLeaseState {
  lease: SandboxLease;
  expectedBase: Omit<RunGovernorBindings, 'commandId' | 'commandDigest'>;
  promptDigest: string;
  runSpecDigest: string;
  nextCommandSequence: number;
}

const primaryGovernorUnavailableError = (): Error =>
  new Error('primary_executor_governor_unavailable: Codex app-server execution requires a runtime safety lease.');

const appServerFallbackReason = (error: unknown): string => {
  if (error instanceof ResourceGovernorError) {
    switch (error.code) {
      case 'runtime_hard_limits_unavailable':
        return 'runtime_hard_limits_unavailable';
      case 'resource_governor_digest_mismatch':
      case 'resource_governor_lease_invalid':
      case 'resource_governor_nonce_replay':
        return 'runtime_attestation_invalid';
      case 'runtime_test_only_mock_forbidden':
      case 'resource_governor_protocol_error':
        return 'sandbox_isolation_unavailable';
    }
  }
  if (error instanceof Error && error.message.includes('primary_executor_governor_unavailable')) {
    return 'primary_executor_governor_unavailable';
  }
  if (isRecord(error) && typeof error.code === 'string') {
    switch (error.code) {
      case 'runtime_hard_limits_unavailable':
        return 'runtime_hard_limits_unavailable';
      case 'resource_governor_digest_mismatch':
      case 'resource_governor_lease_invalid':
      case 'resource_governor_nonce_replay':
        return 'runtime_attestation_invalid';
      case 'runtime_test_only_mock_forbidden':
      case 'resource_governor_protocol_error':
        return 'sandbox_isolation_unavailable';
    }
  }
  if (error instanceof Error && error.message.includes('resource_governor_nonce_replay')) {
    return 'runtime_attestation_invalid';
  }
  return 'app_server_preflight_failed';
};

const canonicalize = (value: unknown): CanonicalJsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .reduce<Record<string, CanonicalJsonValue>>((accumulator, [key, entry]) => {
        accumulator[key] = canonicalize(entry);
        return accumulator;
      }, {});
  }
  return null;
};

const digest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;

const stringField = (record: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
};

const notificationBody = (notification: unknown): Record<string, unknown> => {
  if (!isRecord(notification)) {
    return {};
  }

  const params = notification.params;
  if (isRecord(params)) {
    return typeof notification.method === 'string' ? { ...params, method: notification.method } : params;
  }

  return notification;
};

const turnCompletedTerminal = (notification: unknown): CodexDriverStreamItem | undefined => {
  const body = notificationBody(notification);
  const method = stringField(body, ['method']);
  const type = stringField(body, ['type', 'event_type', 'eventType', 'kind']);
  if (method !== 'turn/completed' && type !== 'turn_completed') {
    return undefined;
  }

  const turn = isRecord(body.turn) ? body.turn : body;
  const status = stringField(turn, ['status']) ?? 'unknown';
  if (status === 'completed') {
    return {
      kind: 'terminal',
      status: 'succeeded',
      summary: 'Codex app-server turn completed.',
      runtimeMetadata: {
        driver_status: 'terminal',
      },
    };
  }

  if (status === 'interrupted') {
    return {
      kind: 'terminal',
      status: 'cancelled',
      summary: 'Codex app-server turn interrupted.',
      runtimeMetadata: {
        driver_status: 'terminal',
      },
    };
  }

  const error = isRecord(turn.error) ? turn.error : undefined;
  const errorMessage = error === undefined ? undefined : stringField(error, ['message', 'additionalDetails']);
  const summary =
    status === 'failed'
      ? 'Codex app-server turn failed.'
      : `Codex app-server turn ended with unknown status: ${status}.`;

  return {
    kind: 'terminal',
    status: 'failed',
    summary,
    runtimeMetadata: {
      driver_status: 'terminal',
    },
    failure: {
      kind: 'executor_error',
      message: errorMessage ?? summary,
      retryable: true,
    },
  };
};

const threadIdleTerminal = (notification: unknown): CodexDriverStreamItem | undefined => {
  const body = notificationBody(notification);
  const method = stringField(body, ['method']);
  if (method !== 'thread/status/changed') {
    return undefined;
  }

  const status = isRecord(body.status) ? stringField(body.status, ['type']) : stringField(body, ['status']);
  if (status !== 'idle') {
    return undefined;
  }

  return {
    kind: 'terminal',
    status: 'failed',
    summary: 'Codex app-server thread became idle before turn completion.',
    runtimeMetadata: {
      driver_status: 'terminal',
    },
    failure: {
      kind: 'executor_error',
      message: 'Codex app-server reported an idle thread before a turn/completed terminal notification.',
      retryable: true,
    },
  };
};

const assistantTextFromNotification = (notification: unknown): string | undefined => {
  const body = notificationBody(notification);
  const method = stringField(body, ['method']);
  const type = stringField(body, ['type', 'event_type', 'eventType', 'kind']);
  if (
    method === 'item/agentMessage/delta' ||
    type === 'assistant_message_delta' ||
    type === 'agent_message_delta' ||
    type === 'message_delta'
  ) {
    return stringField(body, ['delta', 'text', 'message', 'content']);
  }
  if (method === 'item/completed' && isRecord(body.item) && body.item.type === 'agentMessage') {
    return stringField(body.item, ['text']);
  }
  if (type === 'assistant_message_completed' || type === 'agent_message_completed' || type === 'message_completed') {
    return stringField(body, ['message', 'text', 'content']);
  }
  return undefined;
};

const threadIdleAfterAssistantTerminal = (notification: unknown, sawAssistantOutput: boolean): CodexDriverStreamItem | undefined => {
  if (!sawAssistantOutput) {
    return undefined;
  }
  const idleTerminal = threadIdleTerminal(notification);
  if (idleTerminal === undefined) {
    return undefined;
  }
  return {
    kind: 'terminal',
    status: 'succeeded',
    summary: 'Codex app-server thread became idle after assistant output.',
    runtimeMetadata: {
      driver_status: 'terminal',
    },
  };
};

const notificationStreamEndedTerminal = (error?: unknown): CodexDriverStreamItem => {
  const message =
    error instanceof Error
      ? `Codex app-server notification stream ended before turn completion: ${error.message}`
      : 'Codex app-server notification stream ended before turn completion.';

  return {
    kind: 'terminal',
    status: 'failed',
    summary: 'Codex app-server notification stream ended before turn completion.',
    runtimeMetadata: {
      driver_status: 'terminal',
    },
    failure: {
      kind: 'executor_error',
      message,
      retryable: true,
    },
  };
};

export const resolveEffectiveDangerousMode = (config: CodexEffectiveConfig): RunRuntimeMetadata['effective_dangerous_mode'] => {
  const sandbox = config.sandbox;

  return config.approvalPolicy === 'never' &&
    sandbox !== null &&
    typeof sandbox === 'object' &&
    sandbox.type === 'dangerFullAccess'
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
  const record = appServerResultFromResponse(response);
  if (!isRecord(record)) {
    return undefined;
  }
  if (typeof record.threadId === 'string') {
    return record.threadId;
  }
  if (typeof record.thread_id === 'string') {
    return record.thread_id;
  }
  if (isRecord(record.thread) && typeof record.thread.id === 'string') {
    return record.thread.id;
  }

  return undefined;
};

const extractTurnId = (response: unknown): string | undefined => {
  const record = appServerResultFromResponse(response);
  if (!isRecord(record)) {
    return undefined;
  }
  if (typeof record.turnId === 'string') {
    return record.turnId;
  }
  if (typeof record.turn_id === 'string') {
    return record.turn_id;
  }
  if (isRecord(record.turn) && typeof record.turn.id === 'string') {
    return record.turn.id;
  }

  return undefined;
};

export class CodexAppServerDriver implements CodexSessionDriver {
  readonly kind = 'app_server' as const;
  readonly #transport: CodexAppServerTransport;
  readonly #rawLogStore: CodexRawLogStore | undefined;
  readonly #runtimeSafety: LocalCodexRuntimeSafety | undefined;
  readonly #resourceSafetyMode: NonNullable<CodexAppServerDriverOptions['resourceSafetyMode']>;
  readonly #workerIdentity: string;
  readonly #nonceFactory: () => string;
  readonly #now: () => string;
  #leaseState: AppServerLeaseState | undefined;

  constructor(options: CodexAppServerDriverOptions) {
    this.#transport = options.transport;
    this.#rawLogStore = options.rawLogStore;
    this.#runtimeSafety = options.runtimeSafety;
    this.#resourceSafetyMode = options.resourceSafetyMode ?? { mode: 'local_governor' };
    this.#workerIdentity = options.workerIdentity ?? 'forgeloop-codex-app-server';
    this.#nonceFactory = options.nonceFactory ?? (() => randomUUID());
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async *startRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    try {
      await this.#transport.initialize?.();
      const leaseState = await this.#createLeaseIfNeeded(input, input.runSpec.objective);
      await this.#consumeLeaseCommandIfNeeded(leaseState, 'thread/start', input.runSpec.objective);

      const threadResponse = await this.#transport.request('thread/start', {
        cwd: input.workspacePath,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      });
      await confirmAppServerDangerousMode(effectiveConfigFromResponse(threadResponse) ?? {});

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
          ...this.#externalSandboxEvidence(),
        },
      };

      await this.#consumeLeaseCommandIfNeeded(leaseState, 'turn/start', input.runSpec.objective);
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
        ...this.#externalSandboxEvidence(),
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
            reason: appServerFallbackReason(error),
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
      await this.#transport.initialize?.();
      const leaseState = await this.#createLeaseIfNeeded(input, input.runSpec.objective);
      await this.#consumeLeaseCommandIfNeeded(leaseState, 'thread/resume', input.runSpec.objective);

      const response = await this.#transport.request('thread/resume', {
        threadId,
        cwd: input.workspacePath,
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      });
      await confirmAppServerDangerousMode(effectiveConfigFromResponse(response) ?? {});

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
          ...this.#externalSandboxEvidence(),
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
            reason: appServerFallbackReason(error),
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
      await this.#consumeLeaseCommandIfNeeded(this.#leaseState, 'turn/steer', input.message);
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

    await this.#consumeLeaseCommandIfNeeded(this.#leaseState, 'turn/start', input.message);
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

    await this.#consumeLeaseCommandIfNeeded(this.#leaseState, 'turn/interrupt', JSON.stringify({ threadId, turnId }));
    const response = await this.#transport.request('turn/interrupt', { threadId, turnId });
    return {
      acknowledged: true,
      threadId,
      turnId,
      response,
    };
  }

  async close(): Promise<void> {
    await this.#transport.close?.();
  }

  async #createLease(input: CodexDriverStartInput, prompt: string): Promise<AppServerLeaseState> {
    const runtimeSafety = this.#runtimeSafety;
    if (runtimeSafety?.runGovernor.createRunLease === undefined) {
      throw primaryGovernorUnavailableError();
    }

    const now = this.#now();
    const expiresAt = new Date(Date.parse(now) + 5 * 60 * 1000).toISOString();
    const promptDigest = digest(prompt);
    const runSpecDigest = digest(input.runSpec);
    const expectedBase = {
      ...runtimeSafety.hookCommandContext,
      workspaceRoot: input.workspacePath,
    };
    const lease = await runtimeSafety.runGovernor.createRunLease({
      ...expectedBase,
      commandId: 'app_server:create_lease',
      commandDigest: digest({
        driver: 'codex_app_server',
        action: 'create_lease',
        prompt_digest: promptDigest,
        run_spec_digest: runSpecDigest,
        workspace_root: input.workspacePath,
      }),
      executorType: input.runSpec.executor_type,
      workflowOnly: input.runSpec.workflow_only,
      environment: runtimeSafety.runtimeEnvironment ?? 'test',
      projectId: input.runSpec.project_id,
      repoId: input.runSpec.repo.repo_id,
      executionPackageId: input.runSpec.execution_package_id,
      expectedPackageVersion: input.runSpec.expected_package_version,
      now,
      expiresAt,
      workerIdentity: this.#workerIdentity,
      promptDigest,
      runSpecDigest,
    });
    const leaseState = { lease, expectedBase, promptDigest, runSpecDigest, nextCommandSequence: 1 };
    this.#leaseState = leaseState;
    return leaseState;
  }

  async #createLeaseIfNeeded(input: CodexDriverStartInput, prompt: string): Promise<AppServerLeaseState | undefined> {
    if (this.#resourceSafetyMode.mode === 'external_sandbox') {
      return undefined;
    }
    return this.#createLease(input, prompt);
  }

  #requireExistingLease(): AppServerLeaseState {
    if (this.#leaseState === undefined) {
      throw primaryGovernorUnavailableError();
    }
    return this.#leaseState;
  }

  async #consumeLeaseCommand(leaseState: AppServerLeaseState, method: string, prompt: string): Promise<void> {
    const runtimeSafety = this.#runtimeSafety;
    if (runtimeSafety === undefined) {
      throw primaryGovernorUnavailableError();
    }
    const commandSequence = leaseState.nextCommandSequence;
    leaseState.nextCommandSequence += 1;
    const commandDigest = digest({
      driver: 'codex_app_server',
      method,
      command_sequence: commandSequence,
      prompt_digest: digest(prompt),
      run_spec_digest: leaseState.runSpecDigest,
      workspace_root: leaseState.expectedBase.workspaceRoot,
    });
    await runtimeSafety.runGovernor.consumeLeaseCommandInvocation({
      lease: leaseState.lease,
      commandDigest,
      commandInvocationNonce: this.#nonceFactory(),
      now: this.#now(),
      expected: {
        ...leaseState.expectedBase,
        commandId: `app_server:${method}`,
        commandDigest,
        promptDigest: leaseState.promptDigest,
        runSpecDigest: leaseState.runSpecDigest,
      },
    });
  }

  async #consumeLeaseCommandIfNeeded(
    leaseState: AppServerLeaseState | undefined,
    method: string,
    prompt: string,
  ): Promise<void> {
    if (this.#resourceSafetyMode.mode === 'external_sandbox') {
      return;
    }
    if (leaseState === undefined) {
      throw primaryGovernorUnavailableError();
    }
    await this.#consumeLeaseCommand(leaseState, method, prompt);
  }

  #externalSandboxEvidence(): Partial<RunRuntimeMetadata> {
    if (this.#resourceSafetyMode.mode !== 'external_sandbox') {
      return {};
    }
    return this.#resourceSafetyMode.evidence;
  }

  async *#streamNotifications(runSessionId: string): AsyncIterable<CodexDriverStreamItem> {
    const notifications = this.#transport.notifications?.();
    if (notifications === undefined) {
      yield notificationStreamEndedTerminal();
      return;
    }

    let sawAssistantOutput = false;
    try {
      for await (const notification of notifications) {
        const rawRef = await this.#rawLogStore?.appendRawNotification({
          runSessionId,
          source: 'app_server',
          payload: notification,
        });
        const assistantText = assistantTextFromNotification(notification);
        if (assistantText !== undefined && assistantText.trim().length > 0) {
          sawAssistantOutput = true;
        }

        for (const event of normalizeCodexAppServerNotification(notification)) {
          if (rawRef !== undefined) {
            event.raw_ref = rawRef.raw_ref;
          }
          yield { kind: 'event', event };
        }

        const terminal = turnCompletedTerminal(notification) ?? threadIdleAfterAssistantTerminal(notification, sawAssistantOutput) ?? threadIdleTerminal(notification);
        if (terminal !== undefined) {
          yield terminal;
          return;
        }
      }
    } catch (error) {
      yield notificationStreamEndedTerminal(error);
      return;
    }

    yield notificationStreamEndedTerminal();
  }
}

export class CodexAppServerProcessTransport implements CodexAppServerTransport {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #client: CodexAppServerJsonRpcClient;
  #processError: Error | undefined = undefined;
  #initialized = false;
  #initializePromise: Promise<void> | undefined = undefined;
  #resolveClosed: (() => void) | undefined;
  readonly #closedPromise: Promise<void>;

  constructor(options: CodexAppServerProcessTransportOptions = {}) {
    if (options.allowUnsafeDirectSpawn !== true) {
      throw new Error('codex_app_server_direct_spawn_disabled: use a governed transport or explicit test-only unsafe spawn opt-in.');
    }
    this.#closedPromise = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
    this.#child = spawn(options.codexBinary ?? 'codex', options.args ?? ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#client = new CodexAppServerJsonRpcClient({
      writeLine: async (line) => {
        if (this.#processError !== undefined) {
          throw this.#processError;
        }
        await new Promise<void>((resolve) => {
          this.#child.stdin.write(`${line}\n`, (error) => {
            if (error !== null && error !== undefined && this.#processError !== undefined) {
              this.#closeWithError(this.#processError);
            }
            resolve();
          });
        });
      },
      close: async () => {
        this.#child.stdin.end();
      },
    });

    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      this.#client.acceptLine(line);
    });
    this.#child.once('error', (error) => {
      this.#closeWithError(error);
      this.#resolveClosed?.();
    });
    this.#child.once('close', () => {
      this.#closeWithError(new Error('Codex app-server process closed before the request completed.'));
      this.#resolveClosed?.();
    });
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    if (this.#initializePromise !== undefined) {
      return this.#initializePromise;
    }

    this.#initializePromise = (async () => {
      await this.request('initialize', {
        clientInfo: {
          name: 'forgeloop',
          title: 'Forgeloop',
          version: '0.0.0',
        },
        capabilities: { experimentalApi: true },
      });
      await this.#sendNotification('initialized');
      this.#initialized = true;
    })();

    try {
      await this.#initializePromise;
    } finally {
      if (!this.#initialized) {
        this.#initializePromise = undefined;
      }
    }
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.#client.request(method, params);
  }

  async #sendNotification(method: string): Promise<void> {
    await this.#client.sendNotification(method);
  }

  async *notifications(): AsyncIterable<unknown> {
    yield* this.#client.notifications();
  }

  async close(): Promise<void> {
    this.#closeWithError(new Error('Codex app-server process was closed.'));
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGTERM');
    }
    await Promise.race([this.#closedPromise, delay(1_000)]);
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGKILL');
      await Promise.race([this.#closedPromise, delay(1_000)]);
    }
  }

  #closeWithError(error: Error): void {
    if (this.#processError === undefined) {
      this.#processError = error;
    }
    this.#client.closeWithError(error);
  }
}

export const createCodexAppServerDriverForTest = (
  transport: CodexAppServerTransport,
  options: Omit<CodexAppServerDriverOptions, 'transport'> = {},
): CodexSessionDriver =>
  new CodexAppServerDriver({ transport, ...options });
