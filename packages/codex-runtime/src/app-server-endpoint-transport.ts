import { createConnection, type Socket } from 'node:net';

import { CodexAppServerJsonRpcClient } from './app-server-json-rpc.js';
import type { CodexAppServerTransport } from './app-server-protocol.js';

export interface ParsedCodexAppServerEndpoint {
  type: 'unix';
  path: string;
}

export const parseCodexAppServerEndpoint = (endpoint: string | undefined): ParsedCodexAppServerEndpoint => {
  if (endpoint === undefined || endpoint.trim().length === 0) {
    throw new Error('codex_app_server_endpoint_missing');
  }
  if (/^(exec|cli|spawn|stdio):?/i.test(endpoint)) {
    throw new Error('codex_app_server_endpoint_invalid');
  }
  if (!endpoint.startsWith('unix:/')) {
    throw new Error('codex_app_server_endpoint_invalid');
  }

  const socketPath = endpoint.slice('unix:'.length);
  if (!socketPath.startsWith('/')) {
    throw new Error('codex_app_server_endpoint_invalid');
  }
  return { type: 'unix', path: socketPath };
};

export class CodexAppServerEndpointTransport implements CodexAppServerTransport {
  #socket: Socket | undefined;
  #receiveBuffer = '';
  #client: CodexAppServerJsonRpcClient | undefined;
  #initialized = false;
  #initializePromise: Promise<void> | undefined;

  constructor(private readonly endpoint: string) {}

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
    this.#receiveBuffer = '';
    client?.closeWithError(new Error('Codex app-server socket was closed.'));
    this.#socket?.end();
    this.#socket = undefined;
  }

  async #initialize(): Promise<void> {
    const parsed = parseCodexAppServerEndpoint(this.endpoint);
    const socket = createConnection(parsed.path);
    this.#socket = socket;
    this.#client = new CodexAppServerJsonRpcClient({
      writeLine: async (line) => {
        if (this.#socket === undefined) {
          throw new Error('codex_app_server_unavailable');
        }
        await new Promise<void>((resolve, reject) => {
          this.#socket?.write(`${line}\n`, (error) => {
            if (error !== undefined && error !== null) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      },
      close: async () => {
        this.#socket?.end();
      },
    });
    socket.on('data', (chunk) => this.#handleData(chunk));
    socket.on('close', () => this.#client?.closeWithError(new Error('Codex app-server socket closed.')));
    socket.on('error', (error) => {
      this.#client?.closeWithError(Object.assign(new Error('codex_app_server_unavailable'), { cause: error }));
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    }).catch((error) => {
      throw Object.assign(new Error('codex_app_server_unavailable'), { cause: error });
    });
    await this.#client.request('initialize', {
      clientInfo: { name: 'forgeloop', title: 'Forgeloop', version: '0.0.0' },
      capabilities: null,
    });
    await this.#client.sendNotification('initialized');
  }

  #handleData(chunk: Buffer | string): void {
    this.#receiveBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = this.#receiveBuffer.split('\n');
    this.#receiveBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) {
        this.#client?.acceptLine(line);
      }
    }
  }
}
