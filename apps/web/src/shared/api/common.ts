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
  rawBody?: BodyInit;
  headers?: HeadersInit;
  actorId?: string;
  jsonContentType?: boolean;
}

export interface ApiContext {
  baseUrl: string;
  request: <T>(path: string, init?: ApiRequestInit) => Promise<T>;
  rawRequest: (pathOrUrl: string, init?: ApiRequestInit) => Promise<Response>;
}

const defaultBaseUrl = () => import.meta.env.VITE_FORGELOOP_API_URL || 'http://localhost:3000';

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

const requiredActorId = (actorId: string) => {
  const trimmed = actorId.trim();
  if (!trimmed) throw new Error('actorId is required');
  return trimmed;
};

export const actorHeader = (actorId?: string) =>
  actorId === undefined
    ? {}
    : {
        'X-Forgeloop-Actor-Id': requiredActorId(actorId),
        'X-Forgeloop-Actor-Class': 'human_admin',
      };

export function createApiContext(options: ForgeloopApiOptions = {}): ApiContext {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? defaultBaseUrl());
  const fetchImpl = options.fetch ?? fetch;

  async function rawRequest(pathOrUrl: string, init: ApiRequestInit = {}): Promise<Response> {
    if (init.body !== undefined && init.rawBody !== undefined) {
      throw new Error('ApiRequestInit cannot include both body and rawBody');
    }

    const headers = {
      ...(init.rawBody === undefined && init.jsonContentType !== false ? { 'content-type': 'application/json' } : {}),
      ...actorHeader(init.actorId),
      ...headersToRecord(init.headers),
    };
    const response = await fetchImpl(resolveApiUrl(baseUrl, pathOrUrl), {
      method: init.method ?? 'GET',
      headers,
      ...(init.rawBody === undefined
        ? init.body === undefined
          ? {}
          : { body: JSON.stringify(init.body) }
        : { body: init.rawBody }),
    });

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? parseJson(text) : undefined;
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : `Forgeloop API request failed with ${response.status}`;
      throw new ForgeloopApiError(message, response.status, payload);
    }

    return response;
  }

  async function request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const response = await rawRequest(path, init);
    const text = await response.text();
    const payload = text ? parseJson(text) : undefined;

    return payload as T;
  }

  return { baseUrl, request, rawRequest };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function resolveApiUrl(baseUrl: string, pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return `${baseUrl}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}
