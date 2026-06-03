import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

import { CodexAppServerJsonRpcClient, type CodexAppServerTransport } from '@forgeloop/codex-runtime';

export interface CodexAppServerStdioTransportOptions {
  codexBin?: string;
  codexHomeRoot: string;
  cwd: string;
  env?: Record<string, string | undefined>;
}

export class CodexAppServerStdioTransport implements CodexAppServerTransport {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #client: CodexAppServerJsonRpcClient;
  #processError: Error | undefined;
  #initialized = false;
  #initializePromise: Promise<void> | undefined;
  #resolveClosed: (() => void) | undefined;
  readonly #closedPromise: Promise<void>;

  constructor(private readonly options: CodexAppServerStdioTransportOptions) {
    this.#closedPromise = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
    this.#child = spawn(options.codexBin ?? 'codex', ['app-server', '--listen', 'stdio://'], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, CODEX_HOME: options.codexHomeRoot },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#child.stderr.resume();
    this.#client = new CodexAppServerJsonRpcClient({
      writeLine: async (line) => {
        if (this.#processError !== undefined) {
          throw this.#processError;
        }
        await new Promise<void>((resolve, reject) => {
          this.#child.stdin.write(`${line}\n`, (error) => {
            if (error !== null && error !== undefined) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      },
      close: async () => {
        this.#child.stdin.end();
      },
    });
    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      this.#client.acceptLine(line);
    });
    this.#child.once('error', (error) => {
      this.#closeWithError(error);
      this.#resolveClosed?.();
    });
    this.#child.once('close', () => {
      this.#closeWithError(new Error('Codex app-server process closed before the request completed.'));
      this.#resolveClosed?.();
    });
  }

  async initialize(): Promise<void> {
    if (this.#initialized) {
      return;
    }
    if (this.#initializePromise !== undefined) {
      return this.#initializePromise;
    }
    this.#initializePromise = (async () => {
      await this.#client.request('initialize', {
        clientInfo: { name: 'forgeloop', title: 'Forgeloop', version: '0.0.0' },
        capabilities: { experimentalApi: true },
      });
      await this.#client.sendNotification('initialized');
      this.#initialized = true;
    })();
    try {
      await this.#initializePromise;
    } finally {
      if (!this.#initialized) {
        this.#initializePromise = undefined;
      }
    }
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.#client.request(method, params);
  }

  notifications(): AsyncIterable<unknown> {
    return this.#client.notifications();
  }

  async close(): Promise<void> {
    this.#closeWithError(new Error('Codex app-server process was closed.'));
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGTERM');
    }
    await Promise.race([this.#closedPromise, delay(1_000)]);
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill('SIGKILL');
      await Promise.race([this.#closedPromise, delay(1_000)]);
    }
  }

  #closeWithError(error: Error): void {
    if (this.#processError === undefined) {
      this.#processError = error;
    }
    this.#client.closeWithError(error);
  }
}
