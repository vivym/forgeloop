import { resourceLimitDigest } from '@forgeloop/domain';
import type { ResourceLimitVector } from '@forgeloop/domain';
import type { ResourceGovernor, ResourceGovernorReadinessInput, RunGovernorBindings } from './resource-governor.js';
import { ResourceGovernorError } from './resource-governor.js';
import {
  materializeTrustedToolchainCommand,
  structuredCommandDigest,
  StructuredCommandError,
  type MaterializedStructuredCommand,
  type StructuredCommandResult,
  type StructuredCommandSpec,
  type TrustedToolchainConfig,
  type Visibility,
} from './structured-command.js';

export type HookPhase = 'before_run' | 'after_run';
export type BeforeRunHookBlockerCode =
  | 'before_run_hook_failed'
  | 'before_run_hook_timed_out'
  | 'structured_command_invalid'
  | 'runtime_hard_limits_unavailable'
  | 'runtime_attestation_invalid'
  | 'sandbox_isolation_unavailable';
export type AfterRunHookDiagnosticCode =
  | 'after_run_hook_failed'
  | 'after_run_hook_timed_out'
  | 'after_run_read_only_unavailable'
  | 'after_run_source_write_policy_invalid'
  | 'structured_command_invalid'
  | 'runtime_hard_limits_unavailable'
  | 'runtime_attestation_invalid'
  | 'sandbox_isolation_unavailable';

export interface FrozenHookSpec {
  hook_id?: string;
  command: StructuredCommandSpec;
}

export interface FrozenHookSpecs {
  before_run?: readonly FrozenHookSpec[];
  after_run?: readonly FrozenHookSpec[];
}

export interface HookRunnerCommandContext extends Omit<RunGovernorBindings, 'commandId' | 'commandDigest'> {
  trustedToolchains: TrustedToolchainConfig;
  tempRoot?: string;
}

export interface RuntimeSafetyBlocker<Code extends string = string> {
  code: Code;
  summary: string;
  retryable: boolean;
  hook_id?: string;
}

export interface HookRunDiagnostic {
  hook_id: string;
  phase: HookPhase;
  status: 'succeeded' | 'failed' | 'timed_out' | 'skipped';
  visibility: Visibility;
  reason_code?: BeforeRunHookBlockerCode | AfterRunHookDiagnosticCode;
  summary: string;
  stdout_ref?: string;
  stderr_ref?: string;
  internal_diagnostic_ref?: string;
}

export type BeforeRunHookResult =
  | { ok: true; diagnostics: HookRunDiagnostic[] }
  | { ok: false; blocker: RuntimeSafetyBlocker<BeforeRunHookBlockerCode>; diagnostics: HookRunDiagnostic[] };

export interface HookRunInput {
  frozenHookSpecs: FrozenHookSpecs;
  runGovernor: ResourceGovernor;
  commandContext: HookRunnerCommandContext;
  maxHookTimeoutMs: number;
  mockRunContext?: ResourceGovernorReadinessInput;
}

export interface AfterRunHookInput extends HookRunInput {
  readOnlySourceEnforced: boolean;
  terminalStatus: string;
  reviewFinalizationEligible: boolean;
}

export interface AfterRunHookDiagnostics {
  terminalStatus: string;
  reviewFinalizationEligible: boolean;
  diagnostics: HookRunDiagnostic[];
}

export interface HookRunner {
  runBeforeRun(input: HookRunInput): Promise<BeforeRunHookResult>;
  runAfterRun(input: AfterRunHookInput): Promise<AfterRunHookDiagnostics>;
}

export const runBeforeRunHooks = async (input: HookRunInput): Promise<BeforeRunHookResult> => {
  const diagnostics: HookRunDiagnostic[] = [];

  for (const [index, hook] of (input.frozenHookSpecs.before_run ?? []).entries()) {
    const hookId = hookIdFor(hook, index);
    const commandId = `before_run:${hookId}`;
    let command: MaterializedStructuredCommand;
    try {
      command = materializeHookCommand(input, hook.command);
    } catch (error) {
      const blocker = beforeRunBlocker('structured_command_invalid', hookId);
      diagnostics.push(diagnosticFromError(hookId, 'before_run', 'failed', blocker.code, blocker.summary, error));
      return { ok: false, blocker, diagnostics };
    }

    let commandDigest: string;
    try {
      commandDigest = digestCommand(command, input.commandContext);
    } catch (error) {
      const blocker = beforeRunBlocker('structured_command_invalid', hookId);
      diagnostics.push(diagnosticFromError(hookId, 'before_run', 'failed', blocker.code, blocker.summary, error));
      return { ok: false, blocker, diagnostics };
    }

    let result: StructuredCommandResult;
    try {
      result = await input.runGovernor.run({
        scope: 'run',
        command,
        bindings: {
          ...input.commandContext,
          commandId,
          commandDigest,
        },
        ...(input.mockRunContext === undefined ? {} : { mockRunContext: input.mockRunContext }),
      });
    } catch (error) {
      const blocker = beforeRunBlocker(blockerCodeFromGovernorError(error, 'before_run_hook_failed'), hookId);
      diagnostics.push(diagnosticFromError(hookId, 'before_run', 'failed', blocker.code, blocker.summary, error));
      return { ok: false, blocker, diagnostics };
    }

    if (result.timed_out) {
      const blocker = beforeRunBlocker('before_run_hook_timed_out', hookId);
      diagnostics.push(diagnosticFromResult(hookId, 'before_run', 'timed_out', blocker.code, blocker.summary, result));
      return { ok: false, blocker, diagnostics };
    }
    if (result.exit_code !== 0) {
      const blocker = beforeRunBlocker('before_run_hook_failed', hookId);
      diagnostics.push(diagnosticFromResult(hookId, 'before_run', 'failed', blocker.code, blocker.summary, result));
      return { ok: false, blocker, diagnostics };
    }

  }

  return { ok: true, diagnostics };
};

export const runAfterRunHooks = async (input: AfterRunHookInput): Promise<AfterRunHookDiagnostics> => {
  const diagnostics: HookRunDiagnostic[] = [];
  const hooks = input.frozenHookSpecs.after_run ?? [];

  if (!input.readOnlySourceEnforced) {
    return {
      terminalStatus: input.terminalStatus,
      reviewFinalizationEligible: input.reviewFinalizationEligible,
      diagnostics: hooks.map((hook, index) => ({
        hook_id: hookIdFor(hook, index),
        phase: 'after_run',
        status: 'skipped',
        visibility: 'internal',
        reason_code: 'after_run_read_only_unavailable',
        summary: 'after_run hook skipped because read-only source enforcement is unavailable.',
      })),
    };
  }

  for (const [index, hook] of hooks.entries()) {
    const hookId = hookIdFor(hook, index);
    const commandId = `after_run:${hookId}`;
    let command: MaterializedStructuredCommand;
    try {
      command = materializeHookCommand(input, hook.command);
    } catch (error) {
      diagnostics.push(
        diagnosticFromError(hookId, 'after_run', 'failed', 'structured_command_invalid', 'after_run hook command is invalid.', error),
      );
      continue;
    }

    if (command.source_write_policy !== 'artifact_only') {
      diagnostics.push({
        hook_id: hookId,
        phase: 'after_run',
        status: 'skipped',
        visibility: 'internal',
        reason_code: 'after_run_source_write_policy_invalid',
        summary: 'after_run hook skipped because its source write policy is not artifact_only.',
      });
      continue;
    }

    let commandDigest: string;
    try {
      commandDigest = digestCommand(command, input.commandContext);
    } catch (error) {
      diagnostics.push(
        diagnosticFromError(hookId, 'after_run', 'failed', 'structured_command_invalid', 'after_run hook command is invalid.', error),
      );
      continue;
    }

    try {
      const result = await input.runGovernor.run({
        scope: 'run',
        command,
        bindings: {
          ...input.commandContext,
          commandId,
          commandDigest,
        },
        ...(input.mockRunContext === undefined ? {} : { mockRunContext: input.mockRunContext }),
      });
      if (result.timed_out) {
        diagnostics.push(
          diagnosticFromResult(
            hookId,
            'after_run',
            'timed_out',
            'after_run_hook_timed_out',
            'after_run hook timed out.',
            result,
          ),
        );
        continue;
      }
      if (result.exit_code !== 0) {
        diagnostics.push(
          diagnosticFromResult(hookId, 'after_run', 'failed', 'after_run_hook_failed', 'after_run hook failed.', result),
        );
        continue;
      }
      diagnostics.push(diagnosticFromResult(hookId, 'after_run', 'succeeded', undefined, 'after_run hook completed.', result));
    } catch (error) {
      const code = blockerCodeFromGovernorError(error, 'after_run_hook_failed');
      diagnostics.push(diagnosticFromError(hookId, 'after_run', 'failed', code, afterRunSummary(code), error));
    }
  }

  return {
    terminalStatus: input.terminalStatus,
    reviewFinalizationEligible: input.reviewFinalizationEligible,
    diagnostics,
  };
};

export const createHookRunner = (): HookRunner => ({
  runBeforeRun: runBeforeRunHooks,
  runAfterRun: runAfterRunHooks,
});

const materializeHookCommand = (input: HookRunInput, command: StructuredCommandSpec): MaterializedStructuredCommand =>
  materializeTrustedToolchainCommand({
    command,
    toolchain: input.commandContext.trustedToolchains,
    workspaceRoot: input.commandContext.workspaceRoot,
    artifactRoot: input.commandContext.artifactRoot,
    ...(input.commandContext.tempRoot === undefined ? {} : { tempRoot: input.commandContext.tempRoot }),
    hardCaps: {
      hardMaxTimeoutMs: input.maxHookTimeoutMs,
      hardMaxOutputLimitBytes: input.commandContext.resourceLimits.output_limit_bytes,
    },
  });

const digestCommand = (command: MaterializedStructuredCommand, context: HookRunnerCommandContext): string => {
  assertResourceLimitDigest(context.resourceLimits, context.resourceLimitDigest);
  return structuredCommandDigest({
    command,
    resource_limit_digest: context.resourceLimitDigest,
    run_id: context.runId,
    workspace_root: context.workspaceRoot,
    artifact_root: context.artifactRoot,
    sandbox_output_root_policy: context.sandboxOutputRootPolicy,
    artifact_quota_policy: context.artifactQuotaPolicy,
  });
};

const assertResourceLimitDigest = (limits: ResourceLimitVector, expectedDigest: string): void => {
  if (resourceLimitDigest(limits) !== expectedDigest) {
    throw new StructuredCommandError('structured_command_invalid', 'Resource limit digest does not match runner context.');
  }
};

const hookIdFor = (hook: FrozenHookSpec, index: number): string => hook.hook_id ?? `hook-${index + 1}`;

const beforeRunBlocker = (
  code: BeforeRunHookBlockerCode,
  hookId: string,
): RuntimeSafetyBlocker<BeforeRunHookBlockerCode> => ({
  code,
  hook_id: hookId,
  retryable: code !== 'structured_command_invalid',
  summary: beforeRunSummary(code),
});

const beforeRunSummary = (code: BeforeRunHookBlockerCode): string => {
  switch (code) {
    case 'before_run_hook_timed_out':
      return 'before_run hook exceeded its timeout.';
    case 'structured_command_invalid':
      return 'before_run hook command is invalid.';
    case 'runtime_hard_limits_unavailable':
      return 'Runtime hard-limit governor is unavailable.';
    case 'runtime_attestation_invalid':
      return 'Runtime governor attestation is invalid.';
    case 'sandbox_isolation_unavailable':
      return 'Sandbox isolation could not be proven.';
    case 'before_run_hook_failed':
      return 'before_run hook exited non-zero.';
  }
};

const afterRunSummary = (code: AfterRunHookDiagnosticCode): string => {
  switch (code) {
    case 'after_run_hook_timed_out':
      return 'after_run hook timed out.';
    case 'after_run_read_only_unavailable':
      return 'after_run hook skipped because read-only source enforcement is unavailable.';
    case 'after_run_source_write_policy_invalid':
      return 'after_run hook skipped because its source write policy is not artifact_only.';
    case 'structured_command_invalid':
      return 'after_run hook command is invalid.';
    case 'runtime_hard_limits_unavailable':
      return 'Runtime hard-limit governor is unavailable.';
    case 'runtime_attestation_invalid':
      return 'Runtime governor attestation is invalid.';
    case 'sandbox_isolation_unavailable':
      return 'Sandbox isolation could not be proven.';
    case 'after_run_hook_failed':
      return 'after_run hook failed.';
  }
};

const blockerCodeFromGovernorError = <Fallback extends BeforeRunHookBlockerCode | AfterRunHookDiagnosticCode>(
  error: unknown,
  fallback: Fallback,
): Fallback | 'runtime_hard_limits_unavailable' | 'runtime_attestation_invalid' | 'sandbox_isolation_unavailable' => {
  if (!(error instanceof ResourceGovernorError)) {
    return fallback;
  }
  switch (error.code) {
    case 'runtime_hard_limits_unavailable':
      return 'runtime_hard_limits_unavailable';
    case 'resource_governor_digest_mismatch':
    case 'resource_governor_lease_invalid':
    case 'resource_governor_nonce_replay':
      return 'runtime_attestation_invalid';
    case 'runtime_test_only_mock_forbidden':
    case 'resource_governor_protocol_error':
      return 'sandbox_isolation_unavailable';
  }
};

const diagnosticFromResult = (
  hookId: string,
  phase: HookPhase,
  status: HookRunDiagnostic['status'],
  reasonCode: HookRunDiagnostic['reason_code'] | undefined,
  summary: string,
  result: StructuredCommandResult,
): HookRunDiagnostic => ({
  hook_id: hookId,
  phase,
  status,
  visibility: 'internal',
  ...(reasonCode === undefined ? {} : { reason_code: reasonCode }),
  summary,
  ...(result.stdout_ref === undefined ? {} : { stdout_ref: result.stdout_ref }),
  ...(result.stderr_ref === undefined ? {} : { stderr_ref: result.stderr_ref }),
  ...(result.internal_diagnostic_ref === undefined ? {} : { internal_diagnostic_ref: result.internal_diagnostic_ref }),
});

const diagnosticFromError = (
  hookId: string,
  phase: HookPhase,
  status: HookRunDiagnostic['status'],
  reasonCode: Exclude<HookRunDiagnostic['reason_code'], undefined>,
  summary: string,
  error: unknown,
): HookRunDiagnostic => ({
  hook_id: hookId,
  phase,
  status,
  visibility: 'internal',
  reason_code: error instanceof StructuredCommandError ? 'structured_command_invalid' : reasonCode,
  summary,
});
