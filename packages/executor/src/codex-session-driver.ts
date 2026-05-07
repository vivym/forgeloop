import type { ExecutorFailure, RunSpec } from '../../contracts/src/executor.js';

export type RunEventType =
  | 'run_queued'
  | 'worker_lease_acquired'
  | 'driver_started'
  | 'thread_started'
  | 'thread_resumed'
  | 'turn_started'
  | 'turn_status_changed'
  | 'agent_message_delta'
  | 'agent_message_completed'
  | 'plan_updated'
  | 'tool_call_started'
  | 'tool_call_progress'
  | 'tool_call_completed'
  | 'command_started'
  | 'command_output_delta'
  | 'command_completed'
  | 'waiting_for_input'
  | 'user_input'
  | 'watchdog_heartbeat'
  | 'watchdog_idle_detected'
  | 'stalled'
  | 'resuming'
  | 'cancel_requested'
  | 'cancelled'
  | 'codex_warning'
  | 'driver_fallback_used'
  | 'executor_result_started'
  | 'required_check_started'
  | 'required_check_completed'
  | 'artifact_captured'
  | 'run_succeeded'
  | 'run_failed';

export type RunEventSource = 'api' | 'worker' | 'codex' | 'executor' | 'watchdog' | 'user';
export type RunEventVisibility = 'public' | 'internal';

export type RunDriverKind = 'app_server' | 'exec_fallback' | 'fake';
export type RunDriverStatus = 'not_started' | 'starting' | 'active' | 'waiting_for_input' | 'stalled' | 'terminal';
export type EffectiveDangerousMode = 'confirmed' | 'unconfirmed' | 'not_requested';

export interface RunRuntimeMetadata {
  durability_mode: 'durable' | 'volatile_demo';
  driver_kind?: RunDriverKind;
  driver_status?: RunDriverStatus;
  codex_thread_id?: string;
  active_turn_id?: string;
  workspace_path?: string;
  app_server_endpoint?: string;
  worker_id?: string;
  last_event_cursor?: string;
  last_event_at?: string;
  recovery_attempt_count: number;
  effective_dangerous_mode: EffectiveDangerousMode;
}

export interface NormalizedRunEventDraft {
  event_type: RunEventType;
  source: RunEventSource;
  visibility: RunEventVisibility;
  summary: string;
  payload: Record<string, unknown>;
  raw_ref?: Record<string, unknown>;
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
