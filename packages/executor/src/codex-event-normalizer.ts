import type { RunEventType } from '@forgeloop/contracts';

import type { NormalizedRunEventDraft } from './codex-session-driver.js';

const SECRET_PATTERNS = [/(sk-[A-Za-z0-9_-]{8,})/g, /(token=)[^\s]+/gi, /(password=)[^\s]+/gi];
const DEFAULT_MAX_STRING_LENGTH = 8_192;
const TRUNCATION_MARKER = '[truncated]';

type JsonRecord = Record<string, unknown>;

export const truncateString = (value: string, max = DEFAULT_MAX_STRING_LENGTH): string => {
  if (value.length <= max) {
    return value;
  }

  const marker = ` ${TRUNCATION_MARKER}`;
  return `${value.slice(0, Math.max(0, max - marker.length))}${marker}`;
};

const redactString = (value: string): string =>
  SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, (...matches: string[]) => {
    const prefix = matches[1];
    return typeof prefix === 'string' && prefix.endsWith('=') ? `${prefix}[REDACTED]` : '[REDACTED]';
  }), value);

const sanitizePublicValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return truncateString(redactString(value));
  }

  if (Array.isArray(value)) {
    return value.map(sanitizePublicValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .map(([key, nestedValue]) => [key, sanitizePublicValue(nestedValue)]),
    );
  }

  return value;
};

export const redactForPublicPayload = (value: unknown): Record<string, unknown> => {
  const sanitized = sanitizePublicValue(value);
  return sanitized !== null && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : { value: sanitized };
};

const sanitizeNotificationType = (notificationType: string): string =>
  String(redactForPublicPayload({ notification_type: notificationType }).notification_type ?? 'unknown');

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const notificationBody = (input: unknown): JsonRecord => {
  if (!isRecord(input)) {
    return { type: 'unknown', value: input };
  }

  const params = input.params;
  if (isRecord(params)) {
    return typeof input.method === 'string' ? { ...params, method: input.method } : params;
  }

  return input;
};

const stringField = (record: JsonRecord, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
};

const eventDraft = (
  event_type: RunEventType,
  summary: string,
  payload: Record<string, unknown>,
  raw_ref?: Record<string, unknown>,
): NormalizedRunEventDraft => {
  const draft: NormalizedRunEventDraft = {
    event_type,
    source: 'codex',
    visibility: 'public',
    summary,
    payload: redactForPublicPayload(payload),
  };

  if (raw_ref !== undefined) {
    draft.raw_ref = raw_ref;
  }

  return draft;
};

const parseJsonLine = (line: string): JsonRecord | undefined => {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const normalizeCodexAppServerNotification = (input: unknown): NormalizedRunEventDraft[] => {
  const body = notificationBody(input);
  const type = stringField(body, ['type', 'event_type', 'eventType', 'kind']);

  const method = stringField(body, ['method']);

  if (
    type === 'assistant_message_delta' ||
    type === 'agent_message_delta' ||
    type === 'message_delta' ||
    method === 'item/agentMessage/delta'
  ) {
    return [
      eventDraft('agent_message_delta', 'Codex message', {
        message: stringField(body, ['delta', 'text', 'message', 'content']) ?? '',
        turn_id: stringField(body, ['turn_id', 'turnId']),
        thread_id: stringField(body, ['thread_id', 'threadId']),
      }),
    ];
  }

  if (type === 'assistant_message_completed' || type === 'agent_message_completed' || type === 'message_completed') {
    return [
      eventDraft('agent_message_completed', 'Codex completed a message', {
        message: stringField(body, ['message', 'text', 'content']) ?? '',
        turn_id: stringField(body, ['turn_id', 'turnId']),
      }),
    ];
  }

  if (type === 'turn_completed' || method === 'turn/completed') {
    return [];
  }

  if (
    type === 'command_output_delta' ||
    method === 'command/exec/outputDelta' ||
    method === 'item/commandExecution/outputDelta'
  ) {
    return [
      eventDraft('command_output_delta', 'Command output', {
        command: stringField(body, ['command']),
        text: stringField(body, ['text', 'delta', 'output', 'deltaBase64']) ?? '',
        turn_id: stringField(body, ['turn_id', 'turnId']),
        thread_id: stringField(body, ['thread_id', 'threadId']),
      }),
    ];
  }

  const notificationType = sanitizeNotificationType(type ?? method ?? 'unknown');

  return [
    eventDraft(
      'codex_warning',
      'Unknown Codex app-server notification',
      {
        notification_type: notificationType,
      },
      {
        source: 'app_server',
        notification_type: notificationType,
      },
    ),
  ];
};

export const normalizeCodexExecJsonLine = (line: string): NormalizedRunEventDraft[] => {
  const parsed = parseJsonLine(line);
  if (parsed === undefined) {
    return [
      eventDraft(
        'codex_warning',
        'Unparseable Codex exec JSON line',
        {
          line,
        },
        {
          source: 'exec_fallback',
          parse_error: true,
        },
      ),
    ];
  }

  const type = stringField(parsed, ['type', 'event_type', 'eventType', 'kind']);
  if (type === 'command_output_delta') {
    return [
      eventDraft('command_output_delta', 'Command output', {
        command: stringField(parsed, ['command']) ?? '',
        text: stringField(parsed, ['text', 'delta', 'output']) ?? '',
      }),
    ];
  }

  return normalizeCodexAppServerNotification(parsed);
};
