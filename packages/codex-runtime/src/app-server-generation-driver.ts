import { createHash, randomUUID } from 'node:crypto';
import { relative } from 'node:path';

import { extractSingleJsonObject } from './json-output.js';
import {
  appServerResultFromResponse,
  effectiveConfigFromResponse,
  isRecord,
  textInput,
  type CodexAppServerTransport,
  type CodexEffectiveConfig,
} from './app-server-protocol.js';
import {
  PublicCodexAppServerTurnError,
  publicFailureSubcodeFromAppServerErrorShape,
  publicFailureSubcodeForCodexErrorInfo,
} from './app-server-error-categories.js';
import type { CodexGenerationTaskKind } from './types.js';
import type { CodexGenerationRuntimeSafety, GenerationLease } from './generation-safety.js';

export type CodexThreadContinuation =
  | { kind: 'start_thread' }
  | { kind: 'resume_thread'; codex_thread_id: string; codex_thread_id_digest: string };

export interface CodexThreadMetadata {
  codex_thread_id: string;
  codex_thread_id_digest: string;
  app_server_turn_id?: string;
}

export interface AppServerGenerateInput {
  taskKind: CodexGenerationTaskKind;
  prompt: string;
  outputSchemaVersion: string;
  outputSchema?: Record<string, unknown>;
  contextDigest?: string;
  continuation?: CodexThreadContinuation;
  timeoutMs?: number;
  outputLimitBytes?: number;
  rawNotificationLimitBytes?: number;
  signal?: AbortSignal;
}

export interface AppServerGenerateOutput {
  assistantText: string;
  extractedJson: unknown;
  rawArtifactRefs: Record<string, unknown>[];
  codexThread?: CodexThreadMetadata;
}

export interface AppServerGenerationLimits {
  outputLimitBytes?: number;
  rawNotificationLimitBytes?: number;
}

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

const defaultTimeoutMs = 300_000;
const defaultOutputLimitBytes = 1_048_576;
const defaultRawNotificationLimitBytes = 4_194_304;
const defaultMaxTurnAttempts = 2;

const retryableAppServerTurnFailureSubcodes = new Set([
  'app_server_response_too_many_failed_attempts',
  'app_server_response_stream_connection_failed',
  'app_server_response_stream_disconnected',
  'app_server_server_overloaded',
]);

const canonicalize = (value: unknown): CanonicalJsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
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

export const codexThreadIdDigest = (threadId: string): string =>
  digest({ kind: 'codex_app_server_thread_id', thread_id: threadId });

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

const assertPositiveInt = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name}_invalid`);
  }
};

const retryableAppServerTurnFailureSubcode = (error: unknown): string | undefined => {
  const publicResultJson = isRecord(error) && isRecord(error.publicResultJson) ? error.publicResultJson : undefined;
  const publicSubcode = publicResultJson?.failure_subcode;
  if (typeof publicSubcode === 'string' && retryableAppServerTurnFailureSubcodes.has(publicSubcode)) {
    return publicSubcode;
  }
  if (isRecord(error)) {
    const rawSubcode = publicFailureSubcodeFromAppServerErrorShape(error);
    if (rawSubcode !== undefined && retryableAppServerTurnFailureSubcodes.has(rawSubcode)) {
      return rawSubcode;
    }
  }
  return undefined;
};

const sandboxType = (config: CodexEffectiveConfig | undefined): string | undefined => {
  const sandbox = config?.sandboxPolicy ?? config?.sandbox;
  if (typeof sandbox === 'string') {
    return sandbox;
  }
  if (isRecord(sandbox) && typeof sandbox.type === 'string') {
    return sandbox.type;
  }
  return undefined;
};

const allowedGenerationSandboxTypes = new Set(['readOnly', 'read-only', 'artifactOnly', 'artifact-only']);

const isInsideArtifactRoot = (candidatePath: string, artifactRoot: string): boolean => {
  const candidateRelativePath = relative(artifactRoot, candidatePath);
  return candidateRelativePath === '' || (!candidateRelativePath.startsWith('..') && !candidateRelativePath.startsWith('/'));
};

const assertSafeEffectiveConfig = (
  config: CodexEffectiveConfig | undefined,
  safety: CodexGenerationRuntimeSafety,
): void => {
  const type = sandboxType(config);
  if (type === undefined || !allowedGenerationSandboxTypes.has(type) || /danger/i.test(type) || /full.?access/i.test(type)) {
    throw new Error('codex_generation_sandbox_invalid');
  }

  const writableRoots = config?.writableRoots ?? [];
  if ((type === 'readOnly' || type === 'read-only') && writableRoots.length > 0) {
    throw new Error('codex_generation_sandbox_invalid');
  }
  if (
    (type === 'artifactOnly' || type === 'artifact-only') &&
    (writableRoots.length === 0 || !writableRoots.every((root) => isInsideArtifactRoot(root, safety.artifactRoot)))
  ) {
    throw new Error('codex_generation_sandbox_invalid');
  }
};

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
  if (isRecord(notification.params)) {
    return typeof notification.method === 'string' ? { ...notification.params, method: notification.method } : notification.params;
  }
  return notification;
};

const assistantDelta = (notification: unknown): string | undefined => {
  const body = notificationBody(notification);
  const method = stringField(body, ['method']);
  const type = stringField(body, ['type', 'event_type', 'eventType', 'kind']);
  if (
    method !== 'item/agentMessage/delta' &&
    method !== 'assistant_message_delta' &&
    type !== 'assistant_message_delta' &&
    type !== 'agent_message_delta'
  ) {
    return undefined;
  }
  return stringField(body, ['delta', 'text']);
};

const agentMessageText = (value: unknown): string | undefined => {
  if (!isRecord(value) || value.type !== 'agentMessage') {
    return undefined;
  }
  return stringField(value, ['text']);
};

const responseMessageText = (value: unknown): string | undefined => {
  if (!isRecord(value) || value.type !== 'message' || value.role !== 'assistant' || !Array.isArray(value.content)) {
    return undefined;
  }
  const text = value.content
    .map((entry) => (isRecord(entry) && entry.type === 'output_text' ? stringField(entry, ['text']) : undefined))
    .filter((entry): entry is string => entry !== undefined)
    .join('');
  return text.length > 0 ? text : undefined;
};

const finalAgentMessageText = (notification: unknown): string | undefined => {
  const body = notificationBody(notification);
  const method = stringField(body, ['method']);
  const type = stringField(body, ['type', 'event_type', 'eventType', 'kind']);

  if (method === 'item/completed') {
    return agentMessageText(body.item);
  }
  if (method === 'rawResponseItem/completed') {
    return responseMessageText(body.item);
  }
  if (type === 'assistant_message_completed' || type === 'agent_message_completed' || type === 'message_completed') {
    return stringField(body, ['message', 'text', 'content']);
  }

  const turn = isRecord(body.turn) ? body.turn : body;
  if (Array.isArray(turn.items)) {
    const finalMessages = turn.items
      .map(agentMessageText)
      .filter((entry): entry is string => entry !== undefined && entry.trim().length > 0);
    return finalMessages.at(-1);
  }

  return undefined;
};

const terminalStatus = (notification: unknown): string | undefined => {
  const body = notificationBody(notification);
  const method = stringField(body, ['method']);
  const type = stringField(body, ['type', 'event_type', 'eventType', 'kind']);
  if (method === 'thread/status/changed') {
    const status = isRecord(body.status) ? stringField(body.status, ['type']) : stringField(body, ['status']);
    return status === 'idle' ? 'idle' : undefined;
  }
  if (method !== 'turn/completed' && type !== 'turn_completed') {
    return undefined;
  }
  const turn = isRecord(body.turn) ? body.turn : body;
  return stringField(turn, ['status']) ?? 'unknown';
};

const appServerTurnError = (notification: unknown): Error | undefined => {
  const body = notificationBody(notification);
  const error = isRecord(body.error) ? body.error : isRecord(body.turn) && isRecord(body.turn.error) ? body.turn.error : undefined;
  const codexErrorInfo = error === undefined ? undefined : stringField(error, ['codexErrorInfo', 'codex_error_info']);
  if (codexErrorInfo === 'usageLimitExceeded') {
    return new Error('codex_generation_usage_limited');
  }
  const failureSubcode = publicFailureSubcodeForCodexErrorInfo(
    error?.codexErrorInfo ?? error?.codex_error_info,
  );
  if (failureSubcode !== undefined) {
    return new PublicCodexAppServerTurnError(failureSubcode);
  }
  return undefined;
};

const extractThreadId = (response: unknown): string | undefined => {
  const body = appServerResultFromResponse(response);
  if (!isRecord(body)) {
    return undefined;
  }
  if (typeof body.threadId === 'string') {
    return body.threadId;
  }
  if (typeof body.thread_id === 'string') {
    return body.thread_id;
  }
  if (isRecord(body.thread) && typeof body.thread.id === 'string') {
    return body.thread.id;
  }
  return undefined;
};

const extractTurnId = (response: unknown): string | undefined => {
  const body = appServerResultFromResponse(response);
  if (!isRecord(body)) {
    return undefined;
  }
  if (typeof body.turnId === 'string') {
    return body.turnId;
  }
  if (typeof body.turn_id === 'string') {
    return body.turn_id;
  }
  if (isRecord(body.turn) && typeof body.turn.id === 'string') {
    return body.turn.id;
  }
  return undefined;
};

interface ActiveGenerationSession {
  safety: CodexGenerationRuntimeSafety;
  lease: GenerationLease;
  threadId?: string;
  turnId?: string;
}

const assertResumeContinuationDigest = (continuation: Extract<CodexThreadContinuation, { kind: 'resume_thread' }>): void => {
  if (continuation.codex_thread_id.length === 0) {
    throw new Error('codex_app_server_thread_id_missing');
  }
  if (continuation.codex_thread_id_digest !== codexThreadIdDigest(continuation.codex_thread_id)) {
    throw new Error('codex_app_server_thread_mismatch');
  }
};

export class AppServerGenerationDriver {
  #activeSession: ActiveGenerationSession | undefined;
  #generationActive = false;
  #cleanupDone = false;
  #cancelRequested = false;
  #removeAbortListener: (() => void) | undefined;
  #resolveCancel: (() => void) | undefined;
  #cancelPromise: Promise<void> = new Promise((resolve) => {
    this.#resolveCancel = resolve;
  });

  constructor(
    private readonly options: {
      transport: CodexAppServerTransport;
      runtimeSafety?: CodexGenerationRuntimeSafety;
      nonceFactory?: () => string;
      now?: () => string;
      limits?: AppServerGenerationLimits;
      maxTurnAttempts?: number;
    },
  ) {}

  async cancel(): Promise<void> {
    this.#cancelRequested = true;
    this.#resolveCancel?.();
    await this.#cleanupActiveSession('codex_generation_cancelled', { interrupt: true });
  }

  async generate(input: AppServerGenerateInput): Promise<AppServerGenerateOutput> {
    if (this.#generationActive) {
      throw new Error('codex_generation_concurrency_limit_exceeded');
    }
    const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
    const outputLimitBytes = input.outputLimitBytes ?? this.options.limits?.outputLimitBytes ?? defaultOutputLimitBytes;
    const rawNotificationLimitBytes =
      input.rawNotificationLimitBytes ?? this.options.limits?.rawNotificationLimitBytes ?? defaultRawNotificationLimitBytes;
    const maxTurnAttempts = this.options.maxTurnAttempts ?? defaultMaxTurnAttempts;
    assertPositiveInt('codex_generation_timeout_ms', timeoutMs);
    assertPositiveInt('codex_generation_output_limit_bytes', outputLimitBytes);
    assertPositiveInt('codex_generation_raw_notification_limit_bytes', rawNotificationLimitBytes);
    assertPositiveInt('codex_generation_max_turn_attempts', maxTurnAttempts);

    this.#generationActive = true;
    const now = this.options.now ?? (() => new Date().toISOString());
    const nonce = this.options.nonceFactory ?? (() => randomUUID());
    const deadline = Date.now() + timeoutMs;
    this.#resetCancelState(input.signal);

    try {
      const safety = this.options.runtimeSafety;
      if (safety === undefined) {
        throw new Error('codex_generation_safety_unavailable');
      }
      if (safety.taskKind !== input.taskKind) {
        throw new Error('codex_generation_safety_unavailable');
      }

      for (let attempt = 1; attempt <= maxTurnAttempts; attempt += 1) {
        this.#cleanupDone = false;
        try {
          return await this.#generateAttempt({
            input,
            safety,
            timeoutMs,
            outputLimitBytes,
            rawNotificationLimitBytes,
            deadline,
            now,
            nonce,
          });
        } catch (error) {
          await this.#cleanupActiveSession(error instanceof Error ? error.message : 'codex_generation_failed', { interrupt: true });
          const retryableSubcode = retryableAppServerTurnFailureSubcode(error);
          if (retryableSubcode === undefined || attempt >= maxTurnAttempts || this.#cancelRequested) {
            throw error;
          }
        }
      }
      throw new Error('codex_generation_turn_failed');
    } catch (error) {
      throw error;
    } finally {
      this.#clearAbortListener();
      this.#generationActive = false;
    }
  }

  async #generateAttempt(input: {
    input: AppServerGenerateInput;
    safety: CodexGenerationRuntimeSafety;
    timeoutMs: number;
    outputLimitBytes: number;
    rawNotificationLimitBytes: number;
    deadline: number;
    now: () => string;
    nonce: () => string;
  }): Promise<AppServerGenerateOutput> {
    const { safety, deadline, now, nonce } = input;
    const continuation = input.input.continuation ?? { kind: 'start_thread' };
    await this.#withDeadline(this.options.transport.initialize?.() ?? Promise.resolve(), deadline);
    const startTime = now();
    const lease = await this.#withDeadline(
      safety.createGenerationLease({
        promptDigest: digest(input.input.prompt),
        contextDigest: input.input.contextDigest ?? digest({}),
        outputSchemaVersion: input.input.outputSchemaVersion,
        sandboxPolicy: 'readOnly',
        writableRoots: [],
        timeoutMs: input.timeoutMs,
        outputLimitBytes: input.outputLimitBytes,
        rawNotificationLimitBytes: input.rawNotificationLimitBytes,
        now: startTime,
        expiresAt: new Date(Date.parse(startTime) + input.timeoutMs).toISOString(),
      }),
      deadline,
    );
    this.#activeSession = { safety, lease };

    let threadId: string;
    if (continuation.kind === 'start_thread') {
      await this.#consume(safety, lease, 'thread/start', input.input.prompt, nonce(), now(), deadline);
      const threadResponse = await this.#withDeadline(
        this.options.transport.request('thread/start', {
          approvalPolicy: 'never',
          experimentalRawEvents: false,
          persistExtendedHistory: false,
          sandbox: 'read-only',
        }),
        deadline,
      );
      assertSafeEffectiveConfig(effectiveConfigFromResponse(threadResponse), safety);

      const startedThreadId = extractThreadId(threadResponse);
      if (startedThreadId === undefined || startedThreadId.length === 0) {
        throw new Error('codex_app_server_unavailable');
      }
      threadId = startedThreadId;
    } else {
      assertResumeContinuationDigest(continuation);
      if (safety.allowThreadResume !== true) {
        throw new Error('codex_generation_command_invalid');
      }
      const resumeRequest = {
        threadId: continuation.codex_thread_id,
        excludeTurns: true,
        persistExtendedHistory: false,
      };
      await this.#consume(safety, lease, 'thread/resume', resumeRequest, nonce(), now(), deadline);
      const resumeResponse = await this.#withDeadline(
        this.options.transport.request('thread/resume', resumeRequest).catch(() => {
          throw new Error('codex_app_server_resume_failed');
        }),
        deadline,
      );

      const resumedThreadId = extractThreadId(resumeResponse);
      if (resumedThreadId === undefined || resumedThreadId.length === 0) {
        throw new Error('codex_app_server_thread_id_missing');
      }
      if (resumedThreadId !== continuation.codex_thread_id) {
        throw new Error('codex_app_server_thread_mismatch');
      }
      assertSafeEffectiveConfig(effectiveConfigFromResponse(resumeResponse), safety);
      threadId = continuation.codex_thread_id;
    }
    this.#activeSession.threadId = threadId;

    await this.#consume(safety, lease, 'turn/start', input.input.prompt, nonce(), now(), deadline);
    const turnResponse = await this.#withDeadline(
      this.options.transport.request('turn/start', {
        threadId,
        input: textInput(input.input.prompt),
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        ...(input.input.outputSchema === undefined ? {} : { outputSchema: input.input.outputSchema }),
      }),
      deadline,
    );
    const turnId = extractTurnId(turnResponse);
    if (turnId !== undefined) {
      this.#activeSession.turnId = turnId;
    }
    const turnEffectiveConfig = effectiveConfigFromResponse(turnResponse);
    if (turnEffectiveConfig !== undefined) {
      assertSafeEffectiveConfig(turnEffectiveConfig, safety);
    }

    const assistantText = await this.#withDeadline(
      this.#collectAssistantText({
        outputLimitBytes: input.outputLimitBytes,
        rawNotificationLimitBytes: input.rawNotificationLimitBytes,
      }),
      deadline,
    );
    await this.#cleanupActiveSession('codex_generation_completed', { interrupt: false });
    const codexThread: CodexThreadMetadata = {
      codex_thread_id: threadId,
      codex_thread_id_digest: codexThreadIdDigest(threadId),
      ...(turnId === undefined ? {} : { app_server_turn_id: turnId }),
    };
    return {
      assistantText,
      extractedJson: extractSingleJsonObject(assistantText),
      rawArtifactRefs: [],
      codexThread,
    };
  }

  async #consume(
    safety: CodexGenerationRuntimeSafety,
    lease: GenerationLease,
    method: string,
    command: unknown,
    nonce: string,
    now: string,
    deadline: number,
  ): Promise<void> {
    await this.#withDeadline(safety.consumeGenerationCommand({ lease, method, commandDigest: digest(command), nonce, now }), deadline);
  }

  async #collectAssistantText(limits: Required<AppServerGenerationLimits>): Promise<string> {
    const notifications = this.options.transport.notifications?.();
    if (notifications === undefined) {
      throw new Error('generated_output_invalid_json');
    }

    let text = '';
    let finalText: string | undefined;
    let lastTurnError: Error | undefined;
    let rawNotificationBytes = 0;
    for await (const notification of notifications) {
      rawNotificationBytes += byteLength(JSON.stringify(notification) ?? 'undefined');
      if (rawNotificationBytes > limits.rawNotificationLimitBytes) {
        throw new Error('codex_generation_raw_log_too_large');
      }

      lastTurnError = appServerTurnError(notification) ?? lastTurnError;

      const delta = assistantDelta(notification);
      if (delta !== undefined) {
        text += delta;
        if (byteLength(text) > limits.outputLimitBytes) {
          throw new Error('generated_output_too_large');
        }
      }

      const completedMessage = finalAgentMessageText(notification);
      if (completedMessage !== undefined) {
        finalText = completedMessage;
        if (byteLength(finalText) > limits.outputLimitBytes) {
          throw new Error('generated_output_too_large');
        }
      }

      const status = terminalStatus(notification);
      if (status !== undefined) {
        const output = finalText ?? text;
        if (status !== 'completed') {
          if (status === 'idle' && output.trim().length > 0) {
            continue;
          }
          throw lastTurnError ?? appServerTurnError(notification) ?? new Error('codex_generation_turn_failed');
        }
        break;
      }
    }

    const output = finalText ?? text;
    if (output.trim().length === 0) {
      throw new Error('generated_output_invalid_json');
    }
    return output;
  }

  #resetCancelState(signal: AbortSignal | undefined): void {
    this.#clearAbortListener();
    this.#cancelRequested = signal?.aborted ?? false;
    this.#cancelPromise = new Promise((resolve) => {
      this.#resolveCancel = resolve;
    });
    if (this.#cancelRequested) {
      this.#resolveCancel?.();
      return;
    }
    if (signal !== undefined) {
      const onAbort = (): void => {
        this.#cancelRequested = true;
        this.#resolveCancel?.();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    }
  }

  #clearAbortListener(): void {
    this.#removeAbortListener?.();
    this.#removeAbortListener = undefined;
  }

  async #withDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
    if (this.#cancelRequested) {
      throw new Error('codex_generation_cancelled');
    }

    const remainingMs = Math.max(0, deadline - Date.now());
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('codex_generation_timeout')), remainingMs);
        }),
        this.#cancelPromise.then(() => {
          throw new Error('codex_generation_cancelled');
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  async #cleanupActiveSession(reason: string, options: { interrupt: boolean }): Promise<void> {
    if (this.#cleanupDone) {
      return;
    }
    this.#cleanupDone = true;
    const session = this.#activeSession;
    this.#activeSession = undefined;
    if (options.interrupt && session?.threadId !== undefined && session.turnId !== undefined) {
      const nonce = this.options.nonceFactory ?? (() => randomUUID());
      const now = this.options.now ?? (() => new Date().toISOString());
      try {
        await session.safety.consumeGenerationCommand({
          lease: session.lease,
          method: 'turn/interrupt',
          commandDigest: digest({ reason, threadId: session.threadId, turnId: session.turnId }),
          nonce: nonce(),
          now: now(),
        });
      } catch {
        await this.options.transport.close?.().catch(() => undefined);
        return;
      }
      try {
        void Promise.resolve(
          this.options.transport.request('turn/interrupt', { threadId: session.threadId, turnId: session.turnId }),
        ).catch(() => undefined);
      } catch {
        // Best-effort interrupt cleanup must never prevent closing the owned transport.
      }
    }
    await this.options.transport.close?.().catch(() => undefined);
  }
}
