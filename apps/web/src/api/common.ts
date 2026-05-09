type FetchLike = typeof fetch;

export class ForgeloopApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ForgeloopApiError';
    this.status = status;
    this.details = details;
  }
}

export interface ForgeloopApiOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

export interface ApiRequestInit {
  method?: string;
  body?: unknown;
  actorId?: string;
}

export interface ApiContext {
  baseUrl: string;
  request: <T>(path: string, init?: ApiRequestInit) => Promise<T>;
}

const defaultBaseUrl = () => import.meta.env.VITE_FORGELOOP_API_URL || 'http://localhost:3000';

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

const requiredActorId = (actorId: string) => {
  const trimmed = actorId.trim();
  if (!trimmed) throw new Error('actorId is required');
  return trimmed;
};

export const actorHeader = (actorId?: string) =>
  actorId === undefined ? {} : { 'X-Forgeloop-Actor-Id': requiredActorId(actorId) };

export function createApiContext(options: ForgeloopApiOptions = {}): ApiContext {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? defaultBaseUrl());
  const fetchImpl = options.fetch ?? fetch;

  async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const headers = { 'content-type': 'application/json', ...actorHeader(init.actorId) };
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    const payload = text ? parseJson(text) : undefined;

    if (!response.ok) {
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : `Forgeloop API request failed with ${response.status}`;
      throw new ForgeloopApiError(message, response.status, payload);
    }

    return payload as T;
  }

  return { baseUrl, request };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
