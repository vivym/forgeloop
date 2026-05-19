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
import type { CodexGenerationTaskKind } from './types.js';
import type { CodexGenerationRuntimeSafety, GenerationLease } from './generation-safety.js';

export interface AppServerGenerateInput {
  taskKind: CodexGenerationTaskKind;
  prompt: string;
  outputSchemaVersion: string;
  contextDigest?: string;
  timeoutMs?: number;
  outputLimitBytes?: number;
  rawNotificationLimitBytes?: number;
  signal?: AbortSignal;
}

export interface AppServerGenerateOutput {
  assistantText: string;
  extractedJson: unknown;
  rawArtifactRefs: Record<string, unknown>[];
}

export interface AppServerGenerationLimits {
  outputLimitBytes?: number;
  rawNotificationLimitBytes?: number;
}

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

const defaultTimeoutMs = 300_000;
const defaultOutputLimitBytes = 1_048_576;
const defaultRawNotificationLimitBytes = 4_194_304;

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

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

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

const terminalStatus = (notification: unknown): string | undefined => {
  const body = notificationBody(notification);
  const method = stringField(body, ['method']);
  const type = stringField(body, ['type', 'event_type', 'eventType', 'kind']);
  if (method === 'thread/status/changed') {
    const status = isRecord(body.status) ? stringField(body.status, ['type']) : stringField(body, ['status']);
    return status === 'idle' ? 'completed' : undefined;
  }
  if (method !== 'turn/completed' && type !== 'turn_completed') {
    return undefined;
  }
  const turn = isRecord(body.turn) ? body.turn : body;
  return stringField(turn, ['status']) ?? 'unknown';
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

export class AppServerGenerationDriver {
  #activeSession: ActiveGenerationSession | undefined;
  #cleanupDone = false;
  #cancelRequested = false;
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
    },
  ) {}

  async cancel(): Promise<void> {
    this.#cancelRequested = true;
    this.#resolveCancel?.();
    await this.#cleanupActiveSession('codex_generation_cancelled');
  }

  async generate(input: AppServerGenerateInput): Promise<AppServerGenerateOutput> {
    const safety = this.options.runtimeSafety;
    if (safety === undefined) {
      throw new Error('codex_generation_safety_unavailable');
    }
    if (safety.taskKind !== input.taskKind) {
      throw new Error('codex_generation_safety_unavailable');
    }

    const now = this.options.now ?? (() => new Date().toISOString());
    const nonce = this.options.nonceFactory ?? (() => randomUUID());
    const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    this.#cleanupDone = false;
    this.#resetCancelState(input.signal);
    await this.#withDeadline(this.options.transport.initialize?.() ?? Promise.resolve(), deadline);
    const startTime = now();
    const lease = await safety.createGenerationLease({
      promptDigest: digest(input.prompt),
      contextDigest: input.contextDigest ?? digest({}),
      outputSchemaVersion: input.outputSchemaVersion,
      now: startTime,
      expiresAt: new Date(Date.parse(startTime) + timeoutMs).toISOString(),
    });
    this.#activeSession = { safety, lease };

    try {
      await this.#consume(safety, lease, 'thread/start', input.prompt, nonce(), now());
      const threadResponse = await this.#withDeadline(
        this.options.transport.request('thread/start', {
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly' },
        }),
        deadline,
      );
      assertSafeEffectiveConfig(effectiveConfigFromResponse(threadResponse), safety);

      const threadId = extractThreadId(threadResponse);
      if (threadId === undefined || threadId.length === 0) {
        throw new Error('codex_app_server_unavailable');
      }
      this.#activeSession.threadId = threadId;

      await this.#consume(safety, lease, 'turn/start', input.prompt, nonce(), now());
      const turnResponse = await this.#withDeadline(
        this.options.transport.request('turn/start', {
          threadId,
          input: textInput(input.prompt),
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly' },
        }),
        deadline,
      );
      const turnEffectiveConfig = effectiveConfigFromResponse(turnResponse);
      if (turnEffectiveConfig !== undefined) {
        assertSafeEffectiveConfig(turnEffectiveConfig, safety);
      }
      const turnId = extractTurnId(turnResponse);
      if (turnId !== undefined) {
        this.#activeSession.turnId = turnId;
      }

      const assistantText = await this.#withDeadline(
        this.#collectAssistantText({
          outputLimitBytes: input.outputLimitBytes ?? this.options.limits?.outputLimitBytes ?? defaultOutputLimitBytes,
          rawNotificationLimitBytes:
            input.rawNotificationLimitBytes ??
            this.options.limits?.rawNotificationLimitBytes ??
            defaultRawNotificationLimitBytes,
        }),
        deadline,
      );
      this.#activeSession = undefined;
      this.#cleanupDone = true;
      return {
        assistantText,
        extractedJson: extractSingleJsonObject(assistantText),
        rawArtifactRefs: [],
      };
    } catch (error) {
      await this.#cleanupActiveSession(error instanceof Error ? error.message : 'codex_generation_failed');
      throw error;
    }
  }

  async #consume(
    safety: CodexGenerationRuntimeSafety,
    lease: GenerationLease,
    method: string,
    command: unknown,
    nonce: string,
    now: string,
  ): Promise<void> {
    await safety.consumeGenerationCommand({ lease, method, commandDigest: digest(command), nonce, now });
  }

  async #collectAssistantText(limits: Required<AppServerGenerationLimits>): Promise<string> {
    const notifications = this.options.transport.notifications?.();
    if (notifications === undefined) {
      throw new Error('generated_output_invalid_json');
    }

    let text = '';
    let rawNotificationBytes = 0;
    for await (const notification of notifications) {
      rawNotificationBytes += byteLength(JSON.stringify(notification) ?? 'undefined');
      if (rawNotificationBytes > limits.rawNotificationLimitBytes) {
        throw new Error('codex_generation_raw_log_too_large');
      }

      const delta = assistantDelta(notification);
      if (delta !== undefined) {
        text += delta;
        if (byteLength(text) > limits.outputLimitBytes) {
          throw new Error('generated_output_too_large');
        }
      }

      const status = terminalStatus(notification);
      if (status !== undefined) {
        if (status !== 'completed') {
          throw new Error('codex_generation_turn_failed');
        }
        break;
      }
    }

    if (text.trim().length === 0) {
      throw new Error('generated_output_invalid_json');
    }
    return text;
  }

  #resetCancelState(signal: AbortSignal | undefined): void {
    this.#cancelRequested = signal?.aborted ?? false;
    this.#cancelPromise = new Promise((resolve) => {
      this.#resolveCancel = resolve;
    });
    if (this.#cancelRequested) {
      this.#resolveCancel?.();
      return;
    }
    signal?.addEventListener(
      'abort',
      () => {
        this.#cancelRequested = true;
        this.#resolveCancel?.();
      },
      { once: true },
    );
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

  async #cleanupActiveSession(reason: string): Promise<void> {
    if (this.#cleanupDone) {
      return;
    }
    this.#cleanupDone = true;
    const session = this.#activeSession;
    this.#activeSession = undefined;
    if (session?.threadId !== undefined && session.turnId !== undefined) {
      const nonce = this.options.nonceFactory ?? (() => randomUUID());
      const now = this.options.now ?? (() => new Date().toISOString());
      await session.safety
        .consumeGenerationCommand({
          lease: session.lease,
          method: 'turn/interrupt',
          commandDigest: digest({ reason, threadId: session.threadId, turnId: session.turnId }),
          nonce: nonce(),
          now: now(),
        })
        .catch(() => undefined);
      await this.options.transport.request('turn/interrupt', { threadId: session.threadId, turnId: session.turnId }).catch(() => undefined);
    }
    await this.options.transport.close?.().catch(() => undefined);
  }
}
