import type { ArtifactRef, CheckResult } from '@forgeloop/contracts';
import { resourceLimitDigest } from '@forgeloop/domain';
import type { ResourceLimitVector } from '@forgeloop/domain';
import type {
  ResourceGovernor,
  ResourceGovernorReadinessInput,
  RunGovernorBindings,
  SandboxOutputImporter,
} from './resource-governor.js';
import { ResourceGovernorError } from './resource-governor.js';
import {
  materializeTrustedToolchainCommand,
  structuredCommandDigest,
  StructuredCommandError,
  type MaterializedStructuredCommand,
  type SourceWritePolicy,
  type StructuredCommandResult,
  type StructuredCommandSpec,
  type TrustedToolchainConfig,
  type Visibility,
} from './structured-command.js';

export type RequiredCheckBlockerCode =
  | 'required_check_failed'
  | 'required_check_timed_out'
  | 'structured_command_invalid'
  | 'runtime_hard_limits_unavailable'
  | 'runtime_attestation_invalid'
  | 'sandbox_isolation_unavailable'
  | 'artifact_visibility_denied';
export type RequiredCheckDiagnosticCode = RequiredCheckBlockerCode | 'required_checks_before_primary_execution';

export interface FrozenRequiredCheckSpec {
  check_id: string;
  display_name: string;
  source: 'execution_package' | 'repo_policy';
  blocks_review: boolean;
  timeout_ms: number;
  command: StructuredCommandSpec;
  visibility: Visibility;
}

export interface FrozenStructuredCheckPolicy {
  required_checks: readonly FrozenRequiredCheckSpec[];
}

export interface RequiredCheckRunnerCommandContext extends Omit<RunGovernorBindings, 'commandId' | 'commandDigest'> {
  trustedToolchains: TrustedToolchainConfig;
  tempRoot?: string;
}

export interface RequiredCheckBlocker {
  code: RequiredCheckBlockerCode;
  check_id?: string;
  summary: string;
  retryable: boolean;
}

export interface RequiredCheckDiagnostic {
  check_id: string;
  visibility: 'internal';
  status: CheckResult['status'];
  source_write_policy: SourceWritePolicy;
  path_policy_finalization_required: boolean;
  reason_code?: RequiredCheckDiagnosticCode;
  summary: string;
  stdout_ref?: string;
  stderr_ref?: string;
  internal_diagnostic_ref?: string;
}

export interface RequiredCheckRunInput {
  frozenCheckPolicy: FrozenStructuredCheckPolicy;
  runGovernor: ResourceGovernor;
  artifactWriter: RequiredCheckArtifactWriter;
  commandContext: RequiredCheckRunnerCommandContext;
  primaryExecutionCompleted: boolean;
  mockRunContext?: ResourceGovernorReadinessInput;
}

export type RequiredCheckArtifactWriter = SandboxOutputImporter;

export interface RequiredCheckRunResult {
  ok: boolean;
  checks: CheckResult[];
  blockers: RequiredCheckBlocker[];
  diagnostics: RequiredCheckDiagnostic[];
  artifactRefs: ArtifactRef[];
}

export const runRequiredChecks = async (input: RequiredCheckRunInput): Promise<RequiredCheckRunResult> => {
  if (!input.primaryExecutionCompleted) {
    return {
      ok: false,
      checks: [],
      blockers: [],
      diagnostics: [
        {
          check_id: 'required-check-runner',
          visibility: 'internal',
          status: 'skipped',
          source_write_policy: 'read_only',
          path_policy_finalization_required: false,
          reason_code: 'required_checks_before_primary_execution',
          summary: 'Required checks cannot run before primary execution completes.',
        },
      ],
      artifactRefs: [],
    };
  }

  const checks: CheckResult[] = [];
  const blockers: RequiredCheckBlocker[] = [];
  const diagnostics: RequiredCheckDiagnostic[] = [];
  const artifactRefs: ArtifactRef[] = [];

  for (const frozenCheck of input.frozenCheckPolicy.required_checks) {
    const started = performance.now();
    let command: MaterializedStructuredCommand;
    try {
      command = materializeCheckCommand(input, frozenCheck);
    } catch (error) {
      const blocker = checkBlocker('structured_command_invalid', frozenCheck);
      blockers.push(blocker);
      diagnostics.push(diagnosticFromError(frozenCheck, 'failed', 'structured_command_invalid', commandSummary(blocker.code), error));
      continue;
    }

    let commandDigest: string;
    try {
      commandDigest = digestCommand(command, input.commandContext);
    } catch (error) {
      const blocker = checkBlocker('structured_command_invalid', frozenCheck);
      blockers.push(blocker);
      diagnostics.push(diagnosticFromError(frozenCheck, 'failed', 'structured_command_invalid', commandSummary(blocker.code), error));
      continue;
    }

    let result: StructuredCommandResult;
    try {
      result = await input.runGovernor.run({
        scope: 'run',
        command,
        bindings: {
          ...input.commandContext,
          commandId: `required_check:${frozenCheck.check_id}`,
          commandDigest,
        },
        outputImporter: input.artifactWriter,
        sandboxOutputArtifacts: {
          stdout: checkOutputImportSpec(frozenCheck, 'stdout'),
          stderr: checkOutputImportSpec(frozenCheck, 'stderr'),
        },
        ...(input.mockRunContext === undefined ? {} : { mockRunContext: input.mockRunContext }),
      });
    } catch (error) {
      const code = blockerCodeFromGovernorError(error, 'required_check_failed');
      const blocker = checkBlocker(code, frozenCheck);
      if (frozenCheck.blocks_review) {
        blockers.push(blocker);
      }
      diagnostics.push(diagnosticFromError(frozenCheck, 'failed', code, commandSummary(code), error));
      checks.push(checkResultFromGovernor(frozenCheck, command, { exit_code: 1, timed_out: false }, started, {}));
      continue;
    }

    let outputArtifacts: CheckOutputArtifacts;
    try {
      outputArtifacts = artifactRefsForCheck(frozenCheck, result);
    } catch (error) {
      const blocker = checkBlocker('artifact_visibility_denied', frozenCheck);
      if (frozenCheck.blocks_review) {
        blockers.push(blocker);
      }
      diagnostics.push(diagnosticFromError(frozenCheck, 'failed', blocker.code, commandSummary(blocker.code), error));
      checks.push(checkResultFromGovernor(frozenCheck, command, result, started, {}));
      continue;
    }

    const checkResult = checkResultFromGovernor(frozenCheck, command, result, started, outputArtifacts);
    const refs = Object.values(outputArtifacts).filter((artifact): artifact is ArtifactRef => artifact !== undefined);
    artifactRefs.push(...refs);
    checks.push(checkResult);
    diagnostics.push(diagnosticFromResult(frozenCheck, command, checkResult.status, result, outputArtifacts));

    const blockerCode = blockerCodeForResult(frozenCheck, result);
    if (blockerCode !== undefined) {
      blockers.push(checkBlocker(blockerCode, frozenCheck));
    }
  }

  return {
    ok: blockers.length === 0,
    checks,
    blockers,
    diagnostics,
    artifactRefs,
  };
};

const materializeCheckCommand = (
  input: RequiredCheckRunInput,
  check: FrozenRequiredCheckSpec,
): MaterializedStructuredCommand =>
  materializeTrustedToolchainCommand({
    command: {
      ...check.command,
      timeout_ms: check.command.timeout_ms ?? check.timeout_ms,
      visibility: 'internal',
    },
    toolchain: input.commandContext.trustedToolchains,
    workspaceRoot: input.commandContext.workspaceRoot,
    artifactRoot: input.commandContext.artifactRoot,
    ...(input.commandContext.tempRoot === undefined ? {} : { tempRoot: input.commandContext.tempRoot }),
    hardCaps: {
      hardMaxTimeoutMs: Math.min(input.commandContext.resourceLimits.timeout_ms, check.timeout_ms),
      hardMaxOutputLimitBytes: input.commandContext.resourceLimits.output_limit_bytes,
    },
  });

const digestCommand = (command: MaterializedStructuredCommand, context: RequiredCheckRunnerCommandContext): string => {
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

const blockerCodeForResult = (
  check: FrozenRequiredCheckSpec,
  result: StructuredCommandResult,
): 'required_check_failed' | 'required_check_timed_out' | undefined => {
  if (!check.blocks_review) {
    return undefined;
  }
  if (result.timed_out) {
    return 'required_check_timed_out';
  }
  if (result.exit_code !== 0) {
    return 'required_check_failed';
  }
  return undefined;
};

const checkBlocker = (code: RequiredCheckBlockerCode, check: FrozenRequiredCheckSpec): RequiredCheckBlocker => ({
  code,
  check_id: check.check_id,
  retryable: code !== 'structured_command_invalid' && code !== 'artifact_visibility_denied',
  summary: commandSummary(code),
});

const commandSummary = (code: RequiredCheckBlockerCode): string => {
  switch (code) {
    case 'required_check_timed_out':
      return 'Required check exceeded its timeout.';
    case 'structured_command_invalid':
      return 'Required check command is invalid.';
    case 'runtime_hard_limits_unavailable':
      return 'Runtime hard-limit governor is unavailable.';
    case 'runtime_attestation_invalid':
      return 'Runtime governor attestation is invalid.';
    case 'sandbox_isolation_unavailable':
      return 'Sandbox isolation could not be proven.';
    case 'artifact_visibility_denied':
      return 'Required check output could not be imported as an internal artifact.';
    case 'required_check_failed':
      return 'Required check exited non-zero.';
  }
};

const statusForResult = (result: Pick<StructuredCommandResult, 'exit_code' | 'timed_out'>): CheckResult['status'] => {
  if (result.timed_out) {
    return 'timed_out';
  }
  return result.exit_code === 0 ? 'succeeded' : 'failed';
};

const checkResultFromGovernor = (
  check: FrozenRequiredCheckSpec,
  command: MaterializedStructuredCommand,
  result: Pick<StructuredCommandResult, 'exit_code' | 'timed_out' | 'stdout_ref' | 'stderr_ref'>,
  started: number,
  outputArtifacts: CheckOutputArtifacts,
): CheckResult => {
  return {
    check_id: check.check_id,
    command: `structured:${check.check_id}`,
    status: statusForResult(result),
    exit_code: result.timed_out ? null : result.exit_code ?? 1,
    duration_seconds: Math.max(0, (performance.now() - started) / 1000),
    blocks_review: check.blocks_review,
    ...(outputArtifacts.stdout === undefined ? {} : { stdout: outputArtifacts.stdout }),
    ...(outputArtifacts.stderr === undefined ? {} : { stderr: outputArtifacts.stderr }),
  };
};

interface CheckOutputArtifacts {
  stdout?: ArtifactRef;
  stderr?: ArtifactRef;
}

const artifactRefsForCheck = (
  check: FrozenRequiredCheckSpec,
  result: StructuredCommandResult,
): CheckOutputArtifacts => {
  const artifacts: CheckOutputArtifacts = {};
  if (result.stdout_ref !== undefined) {
    artifacts.stdout = artifactRefFromImportedGovernorRef(check, 'stdout', result.stdout_ref, result.output_artifacts?.stdout);
  }
  if (result.stderr_ref !== undefined) {
    artifacts.stderr = artifactRefFromImportedGovernorRef(check, 'stderr', result.stderr_ref, result.output_artifacts?.stderr);
  }
  return artifacts;
};

const checkOutputImportSpec = (
  check: FrozenRequiredCheckSpec,
  stream: 'stdout' | 'stderr',
): { kind: 'check_output'; name: string; contentType: string; visibility: 'internal' } => ({
    kind: 'check_output',
    name: `${safePathSegment(check.check_id)}-${stream}.txt`,
    contentType: 'text/plain',
    visibility: 'internal',
  });

const artifactRefFromImportedGovernorRef = (
  check: FrozenRequiredCheckSpec,
  stream: 'stdout' | 'stderr',
  ref: string,
  artifact: ArtifactRef | undefined,
): ArtifactRef => {
  const base = {
    kind: 'check_output' as const,
    name: `${safePathSegment(check.check_id)}-${stream}.txt`,
    content_type: 'text/plain',
  };
  if (
    artifact !== undefined &&
    artifact.kind === 'check_output' &&
    artifact.name === base.name &&
    artifactRefString(artifact) === ref
  ) {
    return artifact;
  }
  throw new Error('Required check output ref was not imported through the artifact writer.');
};

const diagnosticFromResult = (
  check: FrozenRequiredCheckSpec,
  command: MaterializedStructuredCommand,
  status: CheckResult['status'],
  result: StructuredCommandResult,
  outputArtifacts: CheckOutputArtifacts,
): RequiredCheckDiagnostic => {
  const blockerCode = blockerCodeForResult(check, result);
  return {
    check_id: check.check_id,
    visibility: 'internal',
    status,
    source_write_policy: command.source_write_policy,
    path_policy_finalization_required: command.source_write_policy !== 'read_only',
    ...(blockerCode === undefined ? {} : { reason_code: blockerCode }),
    summary: status === 'succeeded' ? 'Required check completed.' : commandSummary(blockerCode ?? 'required_check_failed'),
    ...(outputArtifacts.stdout === undefined ? {} : { stdout_ref: artifactRefString(outputArtifacts.stdout) }),
    ...(outputArtifacts.stderr === undefined ? {} : { stderr_ref: artifactRefString(outputArtifacts.stderr) }),
    ...(result.internal_diagnostic_ref === undefined ? {} : { internal_diagnostic_ref: result.internal_diagnostic_ref }),
  };
};

const diagnosticFromError = (
  check: FrozenRequiredCheckSpec,
  status: CheckResult['status'],
  reasonCode: RequiredCheckBlockerCode,
  summary: string,
  error: unknown,
): RequiredCheckDiagnostic => ({
  check_id: check.check_id,
  visibility: 'internal',
  status,
  source_write_policy: check.command.source_write_policy ?? 'read_only',
  path_policy_finalization_required: (check.command.source_write_policy ?? 'read_only') !== 'read_only',
  reason_code: error instanceof StructuredCommandError ? 'structured_command_invalid' : reasonCode,
  summary,
});

const blockerCodeFromGovernorError = <Fallback extends RequiredCheckBlockerCode>(
  error: unknown,
  fallback: Fallback,
): Fallback | 'runtime_hard_limits_unavailable' | 'runtime_attestation_invalid' | 'sandbox_isolation_unavailable' | 'artifact_visibility_denied' => {
  if (isErrorWithCode(error, 'artifact_visibility_denied')) {
    return 'artifact_visibility_denied';
  }
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

const isErrorWithCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'check';
};

const artifactRefString = (artifact: ArtifactRef): string => artifact.storage_uri ?? artifact.local_ref ?? artifact.name;
