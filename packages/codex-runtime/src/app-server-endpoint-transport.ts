import { createHash, randomBytes } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

import { CodexAppServerJsonRpcClient } from './app-server-json-rpc.js';
import type { CodexAppServerTransport } from './app-server-protocol.js';

export type ParsedCodexAppServerEndpoint = { type: 'unix'; path: string } | { type: 'websocket'; url: string };

export interface CodexAppServerEndpointTransportOptions {
  bearerToken?: string;
  handshakeTimeoutMs?: number;
}

export const parseCodexAppServerEndpoint = (endpoint: string | undefined): ParsedCodexAppServerEndpoint => {
  if (endpoint === undefined || endpoint.trim().length === 0) {
    throw new Error('codex_app_server_endpoint_missing');
  }
  if (/^(exec|cli|spawn|stdio):?/i.test(endpoint)) {
    throw new Error('codex_app_server_endpoint_invalid');
  }
  if (endpoint.startsWith('ws://')) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('codex_app_server_endpoint_invalid');
    }
    if (url.protocol !== 'ws:' || url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
      throw new Error('codex_app_server_endpoint_invalid');
    }
    return { type: 'websocket', url: url.toString() };
  }

  if (endpoint.startsWith('unix:/')) {
    const socketPath = endpoint.slice('unix:'.length);
    if (!socketPath.startsWith('/')) {
      throw new Error('codex_app_server_endpoint_invalid');
    }
    return { type: 'unix', path: socketPath };
  }

  throw new Error('codex_app_server_endpoint_invalid');
};

export class CodexAppServerEndpointTransport implements CodexAppServerTransport {
  #socket: Socket | undefined;
  #webSocketReceiveBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  #client: CodexAppServerJsonRpcClient | undefined;
  #initialized = false;
  #initializePromise: Promise<void> | undefined;

  constructor(
    private readonly endpoint: string,
    private readonly options: CodexAppServerEndpointTransportOptions = {},
  ) {}

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }
    if (this.#initializePromise !== undefined) {
      return this.#initializePromise;
    }

    this.#initializePromise = this.#initialize();
    try {
      await this.#initializePromise;
      this.#initialized = true;
    } finally {
      if (!this.#initialized) {
        this.#initializePromise = undefined;
      }
    }
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.#client === undefined) {
      throw new Error('codex_app_server_unavailable');
    }
    return this.#client.request(method, params);
  }

  notifications(): AsyncIterable<unknown> {
    if (this.#client === undefined) {
      throw new Error('codex_app_server_unavailable');
    }
    return this.#client.notifications();
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    this.#initialized = false;
    this.#initializePromise = undefined;
    this.#webSocketReceiveBuffer = Buffer.alloc(0);
    client?.closeWithError(new Error('Codex app-server socket was closed.'));
    this.#socket?.end();
    this.#socket = undefined;
  }

  async #initialize(): Promise<void> {
    const parsed = parseCodexAppServerEndpoint(this.endpoint);
    const connection = parsed.type === 'unix' ? await this.#connectUnixWebSocket(parsed.path) : await this.#connectWebSocket(parsed.url);
    const socket = connection.socket;
    this.#socket = socket;
    this.#client = new CodexAppServerJsonRpcClient({
      writeLine: async (line) => {
        if (this.#socket === undefined) {
          throw new Error('codex_app_server_unavailable');
        }
        await writeSocket(this.#socket, webSocketFrame(0x1, Buffer.from(line, 'utf8')));
      },
      close: async () => {
        this.#socket?.end();
      },
    });
    socket.on('data', (chunk) => {
      this.#handleWebSocketData(chunk);
    });
    socket.on('close', () => this.#client?.closeWithError(new Error('Codex app-server socket closed.')));
    socket.on('error', (error) => {
      this.#client?.closeWithError(Object.assign(new Error('codex_app_server_unavailable'), { cause: error }));
    });

    if (connection.leftover.length > 0) {
      this.#handleWebSocketData(connection.leftover);
    }
    await this.#client.request('initialize', {
      clientInfo: { name: 'forgeloop', title: 'Forgeloop', version: '0.0.0' },
      capabilities: null,
    });
    await this.#client.sendNotification('initialized');
  }

  async #connectWebSocket(urlString: string): Promise<{ socket: Socket; leftover: Buffer }> {
    const url = new URL(urlString);
    const socket = createConnection({
      host: url.hostname,
      port: url.port.length === 0 ? 80 : Number(url.port),
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    }).catch((error) => {
      throw Object.assign(new Error('codex_app_server_unavailable'), { cause: error });
    });

    return this.#upgradeWebSocket(socket, hostHeader(url), `${url.pathname}${url.search}`);
  }

  async #connectUnixWebSocket(path: string): Promise<{ socket: Socket; leftover: Buffer }> {
    const socket = createConnection(path);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    }).catch((error) => {
      throw Object.assign(new Error('codex_app_server_unavailable'), { cause: error });
    });
    return this.#upgradeWebSocket(socket, 'localhost', '/');
  }

  async #upgradeWebSocket(socket: Socket, host: string, pathAndQuery: string): Promise<{ socket: Socket; leftover: Buffer }> {
    const key = randomBytes(16).toString('base64');
    const headers = [
      `GET ${pathAndQuery.length === 0 ? '/' : pathAndQuery} HTTP/1.1`,
      `Host: ${host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      ...bearerHeaders(this.options.bearerToken),
      '',
      '',
    ];
    await writeSocket(socket, headers.join('\r\n'));
    const { statusLine, headers: responseHeaders, leftover } = await readHttpUpgrade(
      socket,
      this.options.handshakeTimeoutMs ?? defaultHandshakeTimeoutMs,
    ).catch((error) => {
      socket.destroy();
      throw error;
    });
    if (!/^HTTP\/1\.[01] 101\b/.test(statusLine)) {
      socket.end();
      throw new Error('codex_app_server_unavailable');
    }
    const expectedAccept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    if (responseHeaders.get('sec-websocket-accept') !== expectedAccept) {
      socket.end();
      throw new Error('codex_app_server_unavailable');
    }
    return { socket, leftover };
  }

  #handleWebSocketData(chunk: Buffer | string): void {
    const nextChunk = typeof chunk === 'string' ? Buffer.from(chunk, 'binary') : chunk;
    this.#webSocketReceiveBuffer = Buffer.concat([this.#webSocketReceiveBuffer, nextChunk]);
    while (this.#webSocketReceiveBuffer.length > 0) {
      const frame = readWebSocketFrame(this.#webSocketReceiveBuffer);
      if (frame === undefined) {
        return;
      }
      this.#webSocketReceiveBuffer = frame.remaining;
      if (frame.opcode === 0x1) {
        this.#client?.acceptLine(frame.payload.toString('utf8'));
      } else if (frame.opcode === 0x8) {
        this.#client?.closeWithError(new Error('Codex app-server websocket closed.'));
        this.#socket?.end();
      } else if (frame.opcode === 0x9) {
        void (this.#socket === undefined ? Promise.resolve() : writeSocket(this.#socket, webSocketFrame(0xa, frame.payload))).catch(() => undefined);
      }
    }
  }
}

const writeSocket = async (socket: Socket, data: string | Buffer): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    socket.write(data, (error) => {
      if (error !== undefined && error !== null) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const bearerHeaders = (bearerToken: string | undefined): string[] => {
  if (bearerToken === undefined) {
    return [];
  }
  if (/[\r\n]/.test(bearerToken)) {
    throw new Error('codex_app_server_endpoint_invalid');
  }
  return [`Authorization: Bearer ${bearerToken}`];
};

const hostHeader = (url: URL): string => {
  const host = url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname;
  return url.port.length === 0 ? host : `${host}:${url.port}`;
};

const defaultHandshakeTimeoutMs = 5_000;

const readHttpUpgrade = async (
  socket: Socket,
  timeoutMs: number,
): Promise<{ statusLine: string; headers: Map<string, string>; leftover: Buffer }> => {
  let buffer = Buffer.alloc(0);
  return await new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(Object.assign(new Error('codex_app_server_unavailable'), { cause: error }));
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('codex_app_server_unavailable'));
    };
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }
      cleanup();
      const rawHeaders = buffer.subarray(0, headerEnd).toString('latin1').split('\r\n');
      const statusLine = rawHeaders.shift() ?? '';
      const headers = new Map<string, string>();
      for (const line of rawHeaders) {
        const separator = line.indexOf(':');
        if (separator > 0) {
          headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
        }
      }
      resolve({ statusLine, headers, leftover: buffer.subarray(headerEnd + 4) });
    };
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('codex_app_server_unavailable'));
    }, timeoutMs);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
};

const webSocketFrame = (opcode: number, payload: Buffer): Buffer => {
  const mask = randomBytes(4);
  const lengthBytes =
    payload.length < 126
      ? Buffer.from([0x80 | opcode, 0x80 | payload.length])
      : payload.length <= 0xffff
        ? Buffer.from([0x80 | opcode, 0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff])
        : (() => {
            const header = Buffer.alloc(10);
            header[0] = 0x80 | opcode;
            header[1] = 0x80 | 127;
            header.writeBigUInt64BE(BigInt(payload.length), 2);
            return header;
          })();
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index]! ^ mask[index % 4]!;
  }
  return Buffer.concat([lengthBytes, mask, masked]);
};

const readWebSocketFrame = (buffer: Buffer): { opcode: number; payload: Buffer; remaining: Buffer } | undefined => {
  if (buffer.length < 2) {
    return undefined;
  }
  const opcode = buffer[0]! & 0x0f;
  const masked = (buffer[1]! & 0x80) !== 0;
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) {
      return undefined;
    }
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return undefined;
    }
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('codex_app_server_unavailable');
    }
    length = Number(bigLength);
    offset += 8;
  }
  const maskOffset = offset;
  if (masked) {
    offset += 4;
  }
  if (buffer.length < offset + length) {
    return undefined;
  }
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = payload[index]! ^ mask[index % 4]!;
    }
  }
  return { opcode, payload, remaining: buffer.subarray(offset + length) };
};
