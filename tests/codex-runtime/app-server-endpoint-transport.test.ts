import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CodexAppServerEndpointTransport } from '../../packages/codex-runtime/src/index';

const websocketGuid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const delay = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const acceptKey = (key: string): string => createHash('sha1').update(`${key}${websocketGuid}`).digest('base64');

const websocketFrame = (payload: string): Buffer => {
  const body = Buffer.from(payload, 'utf8');
  if (body.length >= 126) {
    throw new Error('test_websocket_frame_too_large');
  }
  return Buffer.concat([Buffer.from([0x81, body.length]), body]);
};

const decodeClientFrame = (buffer: Buffer): { payload: string; remaining: Buffer } | undefined => {
  if (buffer.length < 2) {
    return undefined;
  }
  const second = buffer[1]!;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) {
      return undefined;
    }
    length = buffer.readUInt16BE(offset);
    offset += 2;
  }
  if (!masked || length >= 65536 || buffer.length < offset + 4 + length) {
    return undefined;
  }
  const mask = buffer.subarray(offset, offset + 4);
  const encoded = buffer.subarray(offset + 4, offset + 4 + length);
  const decoded = Buffer.alloc(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    decoded[index] = encoded[index]! ^ mask[index % 4]!;
  }
  return { payload: decoded.toString('utf8'), remaining: buffer.subarray(offset + 4 + length) };
};

describe('CodexAppServerEndpointTransport websocket support', () => {
  const servers: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it('initializes over websocket with a bearer token kept out of the endpoint URL', async () => {
    const received: unknown[] = [];
    let authorization: string | undefined;
    const sockets = new Set<Socket>();
    const server = createServer();
    server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      authorization = request.headers.authorization;
      const key = request.headers['sec-websocket-key'];
      if (typeof key !== 'string') {
        socket.destroy();
        return;
      }
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${acceptKey(key)}`,
          '',
          '',
        ].join('\r\n'),
      );

      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        let decoded = decodeClientFrame(pending);
        while (decoded !== undefined) {
          const message = JSON.parse(decoded.payload) as { id?: number; method?: string };
          received.push(message);
          pending = decoded.remaining;
          if (message.id !== undefined) {
            socket.write(websocketFrame(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } })));
          }
          decoded = decodeClientFrame(pending);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push({
      close: async () => {
        for (const socket of sockets) {
          socket.destroy();
        }
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('test_server_address_unavailable');
    }

    const transport = new CodexAppServerEndpointTransport(`ws://127.0.0.1:${address.port}`, {
      bearerToken: 'secret-token',
    });
    try {
      await transport.initialize();
      for (let attempt = 0; attempt < 20 && received.length < 2; attempt += 1) {
        await delay(5);
      }
    } finally {
      await transport.close();
    }

    expect(authorization).toBe('Bearer secret-token');
    expect(received).toEqual([
      expect.objectContaining({ method: 'initialize' }),
      expect.objectContaining({ method: 'initialized' }),
    ]);
  });

  it('uses websocket framing over unix app-server endpoints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-unix-endpoint-'));
    const socketPath = join(root, 'codex.sock');
    const received: unknown[] = [];
    const sockets = new Set<Socket>();
    const server = createNetServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      let upgraded = false;
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk]);
        if (!upgraded) {
          const headerEnd = pending.indexOf('\r\n\r\n');
          if (headerEnd === -1) {
            return;
          }
          const headers = pending.subarray(0, headerEnd).toString('latin1');
          const key = headers.match(/^Sec-WebSocket-Key: (.+)$/im)?.[1]?.trim();
          if (key === undefined) {
            socket.destroy();
            return;
          }
          socket.write(
            [
              'HTTP/1.1 101 Switching Protocols',
              'Upgrade: websocket',
              'Connection: Upgrade',
              `Sec-WebSocket-Accept: ${acceptKey(key)}`,
              '',
              '',
            ].join('\r\n'),
          );
          pending = pending.subarray(headerEnd + 4);
          upgraded = true;
        }
        let decoded = decodeClientFrame(pending);
        while (decoded !== undefined) {
          const message = JSON.parse(decoded.payload) as { id?: number; method?: string };
          received.push(message);
          pending = decoded.remaining;
          if (message.id !== undefined) {
            socket.write(websocketFrame(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } })));
          }
          decoded = decodeClientFrame(pending);
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    servers.push({
      close: async () => {
        for (const socket of sockets) {
          socket.destroy();
        }
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(root, { recursive: true, force: true });
      },
    });

    const transport = new CodexAppServerEndpointTransport(`unix:${socketPath}`);
    try {
      await transport.initialize();
      for (let attempt = 0; attempt < 20 && received.length < 2; attempt += 1) {
        await delay(5);
      }
    } finally {
      await transport.close();
    }

    expect(received).toEqual([
      expect.objectContaining({ method: 'initialize' }),
      expect.objectContaining({ method: 'initialized' }),
    ]);
  });

  it('times out a socket that accepts but never completes websocket upgrade', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-unix-endpoint-hang-'));
    const socketPath = join(root, 'codex.sock');
    const sockets = new Set<Socket>();
    const server = createNetServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.resume();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    servers.push({
      close: async () => {
        for (const socket of sockets) {
          socket.destroy();
        }
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(root, { recursive: true, force: true });
      },
    });

    const transport = new CodexAppServerEndpointTransport(`unix:${socketPath}`, { handshakeTimeoutMs: 50 });
    try {
      await expect(transport.initialize()).rejects.toThrow(/codex_app_server_unavailable/);
    } finally {
      await transport.close().catch(() => undefined);
    }
  });
});
