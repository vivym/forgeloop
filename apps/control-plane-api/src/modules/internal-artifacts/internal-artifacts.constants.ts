export const INTERNAL_ARTIFACTS_WIRE_PATH = '/internal/artifacts';
export const INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH = '/internal/artifacts:upload';
export const INTERNAL_ARTIFACT_UPLOAD_ROUTE_PATH = '/internal/artifacts\\:upload';
export const INTERNAL_ARTIFACT_UPLOAD_MIDDLEWARE_ROUTE_PATH = '/internal/artifacts*path';
export const INTERNAL_ARTIFACT_METADATA_HEADER_NAME = 'x-forgeloop-artifact-metadata';
export const INTERNAL_ARTIFACT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

type UploadMiddlewareRequest = {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
  body?: unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: unknown) => void): void;
  removeAllListeners(event?: string): void;
  destroy(): void;
};

type UploadMiddlewareResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

type MiddlewareApp = {
  post(path: string, middleware: (request: UploadMiddlewareRequest, response: UploadMiddlewareResponse, next: (error?: unknown) => void) => void): void;
};

const firstHeaderValue = (request: UploadMiddlewareRequest, name: string): string | undefined => {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const isOctetStream = (request: UploadMiddlewareRequest): boolean =>
  firstHeaderValue(request, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/octet-stream';

const declaredContentLength = (request: UploadMiddlewareRequest): number | undefined => {
  const contentLength = firstHeaderValue(request, 'content-length')?.trim();
  if (contentLength === undefined || contentLength.length === 0) {
    return undefined;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
    return undefined;
  }
  const parsed = Number(contentLength);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const requestPath = (request: UploadMiddlewareRequest): string => request.url?.split('?', 1)[0] ?? '';

const sendUploadError = (response: UploadMiddlewareResponse, statusCode: number, message: string, error: string): void => {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ statusCode, message, error }));
};

const internalArtifactUploadMiddleware = (
  request: UploadMiddlewareRequest,
  response: UploadMiddlewareResponse,
  next: (error?: unknown) => void,
): void => {
  if (requestPath(request) !== INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH) {
    next();
    return;
  }
  if (request.rawBody !== undefined) {
    next();
    return;
  }
  if (!isOctetStream(request)) {
    sendUploadError(response, 415, 'Internal artifact upload requires application/octet-stream', 'Unsupported Media Type');
    return;
  }
  if ((declaredContentLength(request) ?? 0) > INTERNAL_ARTIFACT_UPLOAD_MAX_BYTES) {
    sendUploadError(response, 413, 'Internal artifact upload was rejected', 'Payload Too Large');
    return;
  }

  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  let rejected = false;

  const rejectOversized = () => {
    if (rejected) {
      return;
    }
    rejected = true;
    request.removeAllListeners('data');
    request.removeAllListeners('end');
    sendUploadError(response, 413, 'Internal artifact upload was rejected', 'Payload Too Large');
    request.destroy();
  };

  request.on('data', (chunk: Buffer | string) => {
    if (rejected) {
      return;
    }
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += chunkBuffer.byteLength;
    if (sizeBytes > INTERNAL_ARTIFACT_UPLOAD_MAX_BYTES) {
      rejectOversized();
      return;
    }
    chunks.push(chunkBuffer);
  });
  request.on('end', () => {
    if (rejected) {
      return;
    }
    const rawBody = Buffer.concat(chunks);
    request.rawBody = rawBody;
    request.body = rawBody;
    next();
  });
  request.on('error', next);
};

export const registerInternalArtifactUploadMiddleware = (app: MiddlewareApp): void => {
  app.post(INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH, internalArtifactUploadMiddleware);
  app.post(INTERNAL_ARTIFACT_UPLOAD_MIDDLEWARE_ROUTE_PATH, internalArtifactUploadMiddleware);
};
