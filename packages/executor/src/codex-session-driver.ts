import type { ExecutorFailure, RunEventSource, RunEventType, RunEventVisibility, RunSpec } from '@forgeloop/contracts';
import type { RunRuntimeMetadata } from '@forgeloop/domain';

export type NormalizedRunEventRawRef = Record<string, unknown>;

export interface NormalizedRunEventDraft {
  event_type: RunEventType;
  source: RunEventSource;
  visibility: RunEventVisibility;
  summary: string;
  payload: Record<string, unknown>;
  raw_ref?: NormalizedRunEventRawRef;
}

export interface CodexDriverStartInput {
  runSpec: RunSpec;
  workspacePath: string;
  runtimeMetadata?: RunRuntimeMetadata;
}

export type CodexTerminalStatus = 'succeeded' | 'failed' | 'cancelled';

export type CodexDriverStreamItem =
  | { kind: 'event'; event: NormalizedRunEventDraft; runtimeMetadata?: Partial<RunRuntimeMetadata> }
  | {
      kind: 'terminal';
      status: CodexTerminalStatus;
      summary: string;
      runtimeMetadata?: Partial<RunRuntimeMetadata>;
      failure?: ExecutorFailure;
    };

export interface CodexSessionDriver {
  readonly kind: 'app_server' | 'exec_fallback' | 'fake';
  startRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem>;
  resumeRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem>;
  sendInput(input: {
    message: string;
    runtimeMetadata: RunRuntimeMetadata;
    targetTurnId?: string;
  }): Promise<Record<string, unknown>>;
  cancelRun(input: { runtimeMetadata: RunRuntimeMetadata }): Promise<Record<string, unknown>>;
}
