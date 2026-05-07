import type {
  CodexDriverStartInput,
  CodexDriverStreamItem,
  CodexSessionDriver,
} from '../../executor/src/index.js';
import type { RunRuntimeMetadata } from '../../domain/src/index.js';

export type FakeCodexScriptItem = CodexDriverStreamItem | { kind: 'delay'; ms: number };

export interface FakeCodexSessionDriverOptions {
  kind?: 'app_server' | 'exec_fallback' | 'fake';
  script?: FakeCodexScriptItem[];
  inputAcks?: Record<string, unknown>[];
  cancelAcks?: Record<string, unknown>[];
  failStartWith?: Error;
  failResumeWith?: Error;
  failInputWith?: Error;
  neverCompletesUntilWatchdog?: boolean;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class FakeCodexSessionDriver implements CodexSessionDriver {
  readonly kind: 'app_server' | 'exec_fallback' | 'fake';
  readonly inputs: Array<{ message: string; runtimeMetadata: RunRuntimeMetadata; targetTurnId?: string }> = [];
  readonly cancelRequests: Array<{ runtimeMetadata: RunRuntimeMetadata }> = [];
  readonly startCalls: CodexDriverStartInput[] = [];
  readonly resumeCalls: CodexDriverStartInput[] = [];
  readonly callOrder: string[] = [];

  private readonly script: FakeCodexScriptItem[];
  private readonly inputAcks: Record<string, unknown>[];
  private readonly cancelAcks: Record<string, unknown>[];
  private readonly failStartWith: Error | undefined;
  private readonly failResumeWith: Error | undefined;
  private readonly failInputWith: Error | undefined;
  private readonly neverCompletesUntilWatchdog: boolean;

  constructor(options: FakeCodexSessionDriverOptions = {}) {
    this.kind = options.kind ?? 'fake';
    this.script = options.script ?? [];
    this.inputAcks = [...(options.inputAcks ?? [])];
    this.cancelAcks = [...(options.cancelAcks ?? [])];
    this.failStartWith = options.failStartWith;
    this.failResumeWith = options.failResumeWith;
    this.failInputWith = options.failInputWith;
    this.neverCompletesUntilWatchdog = options.neverCompletesUntilWatchdog ?? false;
  }

  startRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    this.callOrder.push('startRun');
    this.startCalls.push(input);
    if (this.failStartWith !== undefined) {
      throw this.failStartWith;
    }

    return this.stream();
  }

  resumeRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    this.callOrder.push('resumeRun');
    this.resumeCalls.push(input);
    if (this.failResumeWith !== undefined) {
      throw this.failResumeWith;
    }

    return this.stream();
  }

  async sendInput(input: {
    message: string;
    runtimeMetadata: RunRuntimeMetadata;
    targetTurnId?: string;
  }): Promise<Record<string, unknown>> {
    this.callOrder.push('sendInput');
    this.inputs.push(input);
    if (this.failInputWith !== undefined) {
      throw this.failInputWith;
    }

    return this.inputAcks.shift() ?? { continuity: { turn_id: input.targetTurnId ?? input.runtimeMetadata.active_turn_id } };
  }

  async cancelRun(input: { runtimeMetadata: RunRuntimeMetadata }): Promise<Record<string, unknown>> {
    this.callOrder.push('cancelRun');
    this.cancelRequests.push(input);
    return this.cancelAcks.shift() ?? { cancelled: true };
  }

  private async *stream(): AsyncIterable<CodexDriverStreamItem> {
    for (const item of this.script) {
      if (item.kind === 'delay') {
        await delay(item.ms);
        continue;
      }

      yield item;
    }

    while (this.neverCompletesUntilWatchdog) {
      await delay(1_000);
    }
  }
}
