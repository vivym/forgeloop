import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyRunEventForTimeline } from '@forgeloop/contracts';

type TailRunEvent = {
  id?: string;
  cursor?: string;
  event_type?: string;
  visibility?: string;
  summary?: string;
  payload?: Record<string, unknown>;
};

type TailOptions = {
  apiUrl: string;
  runSessionId: string;
  actorId: string;
  after?: string;
  once: boolean;
};

type EventListResponse = {
  events: TailRunEvent[];
  next_cursor: string;
  has_more: boolean;
};

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, '');

const payloadText = (payload: Record<string, unknown> | undefined, keys: string[]): string | undefined => {
  if (payload === undefined) return undefined;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
};

export const buildBackfillRequest = (
  apiUrl: string,
  runSessionId: string,
  options: { actorId: string; after?: string },
): { url: string; init: RequestInit } => {
  const params = new URLSearchParams();
  if (options.after !== undefined) params.set('after', options.after);
  const query = params.toString();
  return {
    url: `${normalizeBaseUrl(apiUrl)}/run-sessions/${encodeURIComponent(runSessionId)}/events${query ? `?${query}` : ''}`,
    init: { headers: { 'X-Forgeloop-Actor-Id': options.actorId } },
  };
};

export const buildStreamTokenRequest = (apiUrl: string, runSessionId: string, actorId: string): { url: string; init: RequestInit } => ({
  url: `${normalizeBaseUrl(apiUrl)}/run-sessions/${encodeURIComponent(runSessionId)}/events/stream-token`,
  init: { method: 'POST', headers: { 'content-type': 'application/json', 'X-Forgeloop-Actor-Id': actorId } },
});

export const buildStreamUrl = (apiUrl: string, runSessionId: string, options: { streamToken: string; after?: string }): string => {
  const params = new URLSearchParams();
  params.set('stream_token', options.streamToken);
  if (options.after !== undefined) params.set('after', options.after);
  return `${normalizeBaseUrl(apiUrl)}/run-sessions/${encodeURIComponent(runSessionId)}/events/stream?${params.toString()}`;
};

export const formatRunEventLine = (event: TailRunEvent): string | undefined => {
  if (classifyRunEventForTimeline(event).mode !== 'visible') return undefined;
  const cursor = event.cursor ?? 'no-cursor';
  const type = event.event_type ?? 'event';
  const text = payloadText(event.payload, ['text', 'message', 'content', 'status', 'reason']) ?? event.summary ?? '';
  return [cursor, type, text].filter(Boolean).join(' ');
};

export const parseTailArgs = (args: string[]): TailOptions => {
  const options: Partial<TailOptions> = {
    apiUrl: process.env.FORGELOOP_API_URL ?? 'http://localhost:3000',
    once: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    if (arg === '--') continue;
    if (arg === '--api-url') options.apiUrl = next();
    else if (arg === '--run-session-id') options.runSessionId = next();
    else if (arg === '--actor-id') options.actorId = next();
    else if (arg === '--after') options.after = next();
    else if (arg === '--once') options.once = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.runSessionId?.trim()) throw new Error('run session id is required');
  if (!options.actorId?.trim()) throw new Error('actor id is required');

  return {
    apiUrl: normalizeBaseUrl(options.apiUrl ?? 'http://localhost:3000'),
    runSessionId: options.runSessionId.trim(),
    actorId: options.actorId.trim(),
    ...(options.after === undefined ? {} : { after: options.after }),
    once: options.once ?? false,
  };
};

const readJson = async <T>(url: string, init: RequestInit, signal: AbortSignal): Promise<T> => {
  const response = await fetch(url, { ...init, signal });
  const text = await response.text();
  const payload = text.length > 0 ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
};

const parseSseFrame = (frame: string): TailRunEvent[] => {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart());

  if (dataLines.length === 0) return [];

  const parsed = JSON.parse(dataLines.join('\n'));
  return typeof parsed === 'object' && parsed !== null ? [parsed as TailRunEvent] : [];
};

const emitEvent = (event: TailRunEvent): void => {
  const line = formatRunEventLine(event);
  if (line !== undefined) console.log(line);
};

const readSseUntilDisconnect = async (
  streamUrl: string,
  startingCursor: string,
  signal: AbortSignal,
  onEvent: (event: TailRunEvent) => void,
): Promise<string> => {
  const response = await fetch(streamUrl, {
    headers: { accept: 'text/event-stream' },
    signal,
  });
  if (!response.ok || response.body === null) {
    const text = response.body === null ? '' : await response.text();
    throw new Error(text.length > 0 ? text : `SSE request failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let cursor = startingCursor;

  try {
    for (;;) {
      const read = await reader.read();
      if (read.done) return cursor;
      buffer += decoder.decode(read.value, { stream: true });

      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        for (const event of parseSseFrame(frame)) {
          onEvent(event);
          if (event.cursor !== undefined) cursor = event.cursor;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
};

export const runTail = async (options: TailOptions): Promise<void> => {
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    const backfillRequest = buildBackfillRequest(options.apiUrl, options.runSessionId, {
      actorId: options.actorId,
      ...(options.after === undefined ? {} : { after: options.after }),
    });
    const backfill = await readJson<EventListResponse>(backfillRequest.url, backfillRequest.init, abortController.signal);
    for (const event of backfill.events) emitEvent(event);
    let cursor = backfill.next_cursor;
    if (options.once) return;

    for (;;) {
      if (abortController.signal.aborted) return;

      const tokenRequest = buildStreamTokenRequest(options.apiUrl, options.runSessionId, options.actorId);
      const tokenResponse = await readJson<{ token: string }>(tokenRequest.url, tokenRequest.init, abortController.signal);
      const streamUrl = buildStreamUrl(options.apiUrl, options.runSessionId, { streamToken: tokenResponse.token, after: cursor });
      cursor = await readSseUntilDisconnect(streamUrl, cursor, abortController.signal, emitEvent);
      if (abortController.signal.aborted) return;

      await delay(1000, undefined, { signal: abortController.signal });
    }
  } catch (error) {
    if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return;
    }
    throw error;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runTail(parseTailArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
