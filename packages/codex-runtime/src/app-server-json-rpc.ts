import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

import { isRecord } from './app-server-protocol.js';

export interface JsonRpcLineTransport {
  writeLine(line: string): Promise<void>;
  close?(): Promise<void>;
}

export class CodexAppServerJsonRpcClient {
  readonly #pending = new Map<number, { resolve(value: unknown): void; reject(reason?: unknown): void }>();
  readonly #notificationQueue: unknown[] = [];
  readonly #events = new EventEmitter();
  #requestId = 0;
  #closed = false;
  #closeError: Error | undefined;

  constructor(private readonly transport: JsonRpcLineTransport) {}

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.#closed) {
      throw this.#closeError ?? new Error('Codex app-server transport is closed.');
    }

    const id = ++this.#requestId;
    const response = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    try {
      await this.transport.writeLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    } catch (error) {
      this.#pending.delete(id);
      throw error;
    }
    return response;
  }

  async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    if (this.#closed) {
      throw this.#closeError ?? new Error('Codex app-server transport is closed.');
    }
    await this.transport.writeLine(JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }));
  }

  acceptLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      return;
    }

    if (isRecord(message) && typeof message.id === 'number') {
      const pending = this.#pending.get(message.id);
      if (pending === undefined) {
        return;
      }
      this.#pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(message.error);
        return;
      }
      pending.resolve(message.result);
      return;
    }

    this.#notificationQueue.push(message);
    this.#events.emit('notification');
  }

  async *notifications(): AsyncIterable<unknown> {
    while (!this.#closed || this.#notificationQueue.length > 0) {
      const notification = this.#notificationQueue.shift();
      if (notification !== undefined) {
        yield notification;
        continue;
      }
      await Promise.race([delay(50), new Promise((resolve) => this.#events.once('notification', resolve))]);
    }

    if (this.#closeError !== undefined) {
      throw this.#closeError;
    }
  }

  closeWithError(error: Error): void {
    if (this.#closeError === undefined) {
      this.#closeError = error;
    }
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
    this.#events.emit('notification');
  }

  async close(): Promise<void> {
    this.closeWithError(new Error('Codex app-server transport was closed.'));
    await this.transport.close?.();
  }
}
