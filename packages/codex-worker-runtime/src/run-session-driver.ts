import { CodexAppServerEndpointTransport } from '@forgeloop/codex-runtime';
import {
  CodexAppServerDriver,
  type CodexDriverStartInput,
  type CodexDriverStreamItem,
  type CodexRawLogStore,
  type CodexSessionDriver,
  type LocalCodexRuntimeSafety,
} from '@forgeloop/executor';
import type { RunRuntimeMetadata, RunSession } from '@forgeloop/domain';

import type { DockerizedCodexAppServerLauncher, DockerizedCodexAppServerSession } from './app-server-launcher.js';

export interface CodexRunSessionDriverLaunchInput {
  runSession: RunSession;
  runtimeMetadata: RunRuntimeMetadata;
  workerLease: {
    workerId: string;
    runSessionId: string;
    leaseId?: string;
    leaseToken: string;
  };
}

export interface LeasedRunSessionDriverOptions {
  launcher: Pick<DockerizedCodexAppServerLauncher, 'launchFromLease'>;
  createLaunchLease(input: {
    runSession: RunSession;
    runtimeMetadata: RunRuntimeMetadata;
    workerLease: CodexRunSessionDriverLaunchInput['workerLease'];
  }): Promise<{ leaseId: string; launchToken: string; workerSessionToken?: string }>;
  rawLogStore?: CodexRawLogStore;
  runtimeSafety?: LocalCodexRuntimeSafety;
  workerIdentity: string;
  innerDriverFactory?: (input: {
    endpoint: `unix:${string}`;
    dockerSession: DockerizedCodexAppServerSession;
  }) => CodexSessionDriver;
}

class LeasedRunSessionCodexDriver implements CodexSessionDriver {
  readonly kind = 'app_server' as const;
  #inner: CodexSessionDriver | undefined;
  #dockerSession: DockerizedCodexAppServerSession | undefined;
  #terminal: { status: 'succeeded' | 'failed' | 'cancelled'; summary: string } | undefined;
  #closed = false;

  constructor(
    private readonly options: LeasedRunSessionDriverOptions,
    private readonly launchInput: CodexRunSessionDriverLaunchInput,
  ) {}

  async *startRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    const driver = await this.#ensureInnerDriver(input);
    yield* this.#recordingStream(driver.startRun({ ...input, workspacePath: this.#dockerSession?.containerWorkspacePath ?? input.workspacePath }));
  }

  async *resumeRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    const driver = await this.#ensureInnerDriver(input);
    yield* this.#recordingStream(driver.resumeRun({ ...input, workspacePath: this.#dockerSession?.containerWorkspacePath ?? input.workspacePath }));
  }

  async sendInput(input: Parameters<CodexSessionDriver['sendInput']>[0]): Promise<Record<string, unknown>> {
    if (this.#inner === undefined) {
      throw new Error('Cannot send input before Dockerized Codex app-server driver has started.');
    }
    return this.#inner.sendInput(input);
  }

  async cancelRun(input: Parameters<CodexSessionDriver['cancelRun']>[0]): Promise<Record<string, unknown>> {
    return this.#inner?.cancelRun(input) ?? { acknowledged: false, reason: 'driver_not_started' };
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.#inner?.close?.();
    const terminal = this.#terminal ?? { status: 'cancelled' as const, summary: 'driver closed before terminal completion' };
    await this.#dockerSession?.close(terminal.status, terminal.summary);
  }

  async *#recordingStream(stream: AsyncIterable<CodexDriverStreamItem>): AsyncIterable<CodexDriverStreamItem> {
    try {
      for await (const item of stream) {
        if (item.kind === 'terminal') {
          this.#terminal = { status: item.status, summary: item.summary };
        }
        yield item;
      }
    } catch (error) {
      this.#terminal = {
        status: 'failed',
        summary: error instanceof Error ? error.message : 'driver stream failed',
      };
      throw error;
    }
  }

  async #ensureInnerDriver(input: CodexDriverStartInput): Promise<CodexSessionDriver> {
    if (this.#inner !== undefined) {
      return this.#inner;
    }
    const lease = await this.options.createLaunchLease(this.launchInput);
    this.#dockerSession = await this.options.launcher.launchFromLease({
      leaseId: lease.leaseId,
      launchToken: lease.launchToken,
      ...(lease.workerSessionToken === undefined ? {} : { workerSessionToken: lease.workerSessionToken }),
      originalWorkspacePath: input.workspacePath,
    });
    this.#inner =
      this.options.innerDriverFactory?.({ endpoint: this.#dockerSession.endpoint, dockerSession: this.#dockerSession }) ??
      new CodexAppServerDriver({
        transport: new CodexAppServerEndpointTransport(this.#dockerSession.endpoint),
        ...(this.options.rawLogStore === undefined ? {} : { rawLogStore: this.options.rawLogStore }),
        ...(this.options.runtimeSafety === undefined ? {} : { runtimeSafety: this.options.runtimeSafety }),
        resourceSafetyMode: { mode: 'external_sandbox', evidence: this.#dockerSession.publicEvidence },
        workerIdentity: this.options.workerIdentity,
      });
    return this.#inner;
  }
}

export const createLeasedRunSessionCodexDriver = (
  options: LeasedRunSessionDriverOptions,
  input: CodexRunSessionDriverLaunchInput,
): CodexSessionDriver => new LeasedRunSessionCodexDriver(options, input);
