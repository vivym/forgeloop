import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

import { CodexAppServerJsonRpcClient, type CodexAppServerTransport } from '@forgeloop/codex-runtime';

export interface CodexAppServerDockerExecTransportOptions {
  dockerBin?: string;
  containerId: string;
  socketContainerPath: string;
  handshakeTimeoutMs?: number;
}

export class CodexAppServerDockerExecTransport implements CodexAppServerTransport {
  #child: ChildProcessWithoutNullStreams | undefined;
  #client: CodexAppServerJsonRpcClient | undefined;
  #webSocketReceiveBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  #initialized = false;
  #initializePromise: Promise<void> | undefined;

  constructor(private readonly options: CodexAppServerDockerExecTransportOptions) {}

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
    const child = this.#child;
    this.#client = undefined;
    this.#child = undefined;
    this.#webSocketReceiveBuffer = Buffer.alloc(0);
    this.#initialized = false;
    this.#initializePromise = undefined;
    client?.closeWithError(new Error('Codex app-server docker exec transport was closed.'));
    child?.stdin.end();
    child?.kill('SIGTERM');
  }

  async #initialize(): Promise<void> {
    assertSafeDockerExecInput(this.options.containerId, this.options.socketContainerPath);
    const child = spawn(this.options.dockerBin ?? 'docker', [
      'exec',
      '-i',
      this.options.containerId,
      'codex',
      'app-server',
      'proxy',
      '--sock',
      this.options.socketContainerPath,
    ]);
    this.#child = child;
    child.stderr.resume();
    child.once('error', (error) => {
      this.#client?.closeWithError(Object.assign(new Error('codex_app_server_unavailable'), { cause: error }));
    });
    child.once('exit', (code) => {
      if (code === 0) {
        this.#client?.closeWithError(new Error('Codex app-server docker exec transport closed.'));
        return;
      }
      this.#client?.closeWithError(new Error('codex_app_server_unavailable'));
    });

    const leftover = await upgradeDockerExecWebSocket(child, this.options.handshakeTimeoutMs ?? defaultHandshakeTimeoutMs);
    this.#client = new CodexAppServerJsonRpcClient({
      writeLine: async (line) => {
        if (this.#child === undefined) {
          throw new Error('codex_app_server_unavailable');
        }
        await writeChildStdin(this.#child, webSocketFrame(0x1, Buffer.from(line, 'utf8')));
      },
      close: async () => {
        this.#child?.stdin.end();
      },
    });
    child.stdout.on('data', (chunk) => this.#handleWebSocketData(chunk));
    if (leftover.length > 0) {
      this.#handleWebSocketData(leftover);
    }

    await this.#client.request('initialize', {
      clientInfo: { name: 'forgeloop', title: 'Forgeloop', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    });
    await this.#client.sendNotification('initialized');
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
        this.#client?.closeWithError(new Error('Codex app-server docker exec websocket closed.'));
        this.#child?.stdin.end();
      } else if (frame.opcode === 0x9 && this.#child !== undefined) {
        void writeChildStdin(this.#child, webSocketFrame(0xa, frame.payload)).catch(() => undefined);
      }
    }
  }
}

const assertSafeDockerExecInput = (containerId: string, socketContainerPath: string): void => {
  if (containerId.length === 0 || /[\0\r\n]/.test(containerId)) {
    throw new Error('codex_app_server_endpoint_invalid');
  }
  if (!socketContainerPath.startsWith('/') || /[\0\r\n]/.test(socketContainerPath)) {
    throw new Error('codex_app_server_endpoint_invalid');
  }
};

const defaultHandshakeTimeoutMs = 5_000;

const upgradeDockerExecWebSocket = async (child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<Buffer> => {
  const key = randomBytes(16).toString('base64');
  await writeChildStdin(
    child,
    [
      'GET / HTTP/1.1',
      'Host: localhost',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n'),
  );
  const { statusLine, headers, leftover } = await readHttpUpgrade(child, timeoutMs).catch((error) => {
    child.kill('SIGTERM');
    throw error;
  });
  if (!/^HTTP\/1\.[01] 101\b/.test(statusLine)) {
    child.kill('SIGTERM');
    throw new Error('codex_app_server_unavailable');
  }
  const expectedAccept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  if (headers.get('sec-websocket-accept') !== expectedAccept) {
    child.kill('SIGTERM');
    throw new Error('codex_app_server_unavailable');
  }
  return leftover;
};

const readHttpUpgrade = async (
  child: ChildProcessWithoutNullStreams,
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
      child.stdout.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(Object.assign(new Error('codex_app_server_unavailable'), { cause: error }));
    };
    const onExit = (): void => {
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
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
};

const writeChildStdin = async (child: ChildProcessWithoutNullStreams, data: string | Buffer): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    child.stdin.write(data, (error) => {
      if (error !== undefined && error !== null) {
        reject(error);
        return;
      }
      resolve();
    });
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
