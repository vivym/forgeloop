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
}

export interface AppServerGenerateOutput {
  assistantText: string;
  extractedJson: unknown;
  rawArtifactRefs: Record<string, unknown>[];
}

type CanonicalJsonValue = null | boolean | number | string | CanonicalJsonValue[] | { [key: string]: CanonicalJsonValue };

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

export class AppServerGenerationDriver {
  constructor(
    private readonly options: {
      transport: CodexAppServerTransport;
      runtimeSafety?: CodexGenerationRuntimeSafety;
      nonceFactory?: () => string;
      now?: () => string;
    },
  ) {}

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
    await this.options.transport.initialize?.();
    const startTime = now();
    const lease = await safety.createGenerationLease({
      promptDigest: digest(input.prompt),
      contextDigest: input.contextDigest ?? digest({}),
      outputSchemaVersion: input.outputSchemaVersion,
      now: startTime,
      expiresAt: new Date(Date.parse(startTime) + (input.timeoutMs ?? 300_000)).toISOString(),
    });

    await this.#consume(safety, lease, 'thread/start', input.prompt, nonce(), now());
    const threadResponse = await this.options.transport.request('thread/start', {
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
    });
    assertSafeEffectiveConfig(effectiveConfigFromResponse(threadResponse), safety);

    const threadId = extractThreadId(threadResponse);
    if (threadId === undefined || threadId.length === 0) {
      throw new Error('codex_app_server_unavailable');
    }

    await this.#consume(safety, lease, 'turn/start', input.prompt, nonce(), now());
    await this.options.transport.request('turn/start', {
      threadId,
      input: textInput(input.prompt),
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
    });

    const assistantText = await this.#collectAssistantText();
    return {
      assistantText,
      extractedJson: extractSingleJsonObject(assistantText),
      rawArtifactRefs: [],
    };
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

  async #collectAssistantText(): Promise<string> {
    const notifications = this.options.transport.notifications?.();
    if (notifications === undefined) {
      throw new Error('generated_output_invalid_json');
    }

    let text = '';
    for await (const notification of notifications) {
      const delta = assistantDelta(notification);
      if (delta !== undefined) {
        text += delta;
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
}
