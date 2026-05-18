import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  runAfterRunHooks,
  runBeforeRunHooks,
  resourceLimitDigest,
  structuredCommandDigest,
  TestOnlyMockResourceGovernor,
  type HookRunnerCommandContext,
  type ResourceGovernor,
  type ResourceGovernorReadiness,
  type ResourceGovernorRunInput,
  type RuntimeSafetyAttestation,
  type SandboxLeaseInput,
  type StructuredCommandResult,
  type TrustedToolchainConfig,
} from '../../packages/executor/src/index';

const sha = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const shellPath = realpathSync('/bin/sh');
const shellRoot = dirname(shellPath);

const resourceLimits = {
  cpu_ms: 1_000,
  memory_mb: 512,
  pids: 32,
  fds: 64,
  workspace_bytes: 1_048_576,
  artifact_bytes: 1_048_576,
  timeout_ms: 30_000,
  output_limit_bytes: 100_000,
  run_output_limit_bytes: 500_000,
};

class RecordingRunGovernor implements ResourceGovernor {
  readonly governorId = 'recording-hook-governor';
  readonly provenance = 'test_only_mock' as const;
  readonly calls: ResourceGovernorRunInput[] = [];

  constructor(private readonly outputs: Array<Partial<StructuredCommandResult> | Error>) {}

  async checkReadiness(): Promise<ResourceGovernorReadiness> {
    return { status: 'ready', governor_id: this.governorId, provenance: this.provenance };
  }

  async createRunExecutionAttestation(): Promise<RuntimeSafetyAttestation> {
    throw new Error('not used');
  }

  async createRunLease(_input: SandboxLeaseInput) {
    throw new Error('not used');
  }

  async consumeLeaseCommandInvocation(): Promise<{ ok: true }> {
    return { ok: true };
  }

  async run(input: ResourceGovernorRunInput): Promise<StructuredCommandResult> {
    this.calls.push(input);
    const output = this.outputs.shift() ?? {};
    if (output instanceof Error) {
      throw output;
    }
    return {
      exit_code: 0,
      timed_out: false,
      stdout_truncated: false,
      stderr_truncated: false,
      visibility: 'internal',
      public_summary: 'hook completed',
      ...output,
    };
  }
}

const trustedToolchains = (): TrustedToolchainConfig => ({
  root_paths: [shellRoot],
  executable_paths: { tool: shellPath },
  path_entries: [shellRoot],
  writable: false,
});

const commandContext = (): HookRunnerCommandContext => {
  const limitsDigest = resourceLimitDigest(resourceLimits);
  return {
    runId: 'run-1',
    workspaceRoot: '/workspace/repo',
    artifactRoot: '/artifacts/run-1',
    sandboxOutputRoot: '/sandbox-output/run-1',
    policyDigest: sha,
    policySnapshotVersion: 1,
    envPolicyDigest: sha,
    commandPolicyDigest: sha,
    mountPolicyDigest: sha,
    networkPolicyDigest: 'network-disabled',
    resourceLimitDigest: limitsDigest,
    sandboxOutputRootPolicy: 'ephemeral_sandbox_output_only',
    artifactQuotaPolicy: 'sha256:artifact-quota',
    networkMode: 'disabled',
    resourceLimits,
    trustedToolchains: trustedToolchains(),
  };
};

const hookCommand = (args: string[], overrides: Record<string, unknown> = {}) => ({
  executable: 'tool',
  args,
  cwd: 'workspace_root' as const,
  timeout_ms: 1_000,
  output_limit_bytes: 10_000,
  visibility: 'internal' as const,
  source_write_policy: 'read_only' as const,
  ...overrides,
});

describe('HookRunner', () => {
  it('runs frozen before_run hooks through the run governor with bound command digests', async () => {
    const governor = new RecordingRunGovernor([{}]);
    const context = commandContext();

    const result = await runBeforeRunHooks({
      frozenHookSpecs: {
        before_run: [{ hook_id: 'before-1', command: hookCommand(['from-frozen-snapshot']) }],
      },
      runGovernor: governor,
      commandContext: context,
      maxHookTimeoutMs: 5_000,
    });

    expect(result).toEqual({ ok: true, diagnostics: [] });
    expect(governor.calls).toHaveLength(1);
    const call = governor.calls[0];
    expect(call?.scope).toBe('run');
    expect(call?.command.args).toEqual(['from-frozen-snapshot']);
    expect(call?.command.visibility).toBe('internal');
    expect(call?.command.source_write_policy).toBe('read_only');
    expect(call?.scope === 'run' ? call.bindings.commandId : undefined).toBe('before_run:before-1');
    expect(call?.scope === 'run' ? call.bindings.commandDigest : undefined).toBe(
      structuredCommandDigest({
        command: call.command,
        resource_limit_digest: context.resourceLimitDigest,
        run_id: context.runId,
        workspace_root: context.workspaceRoot,
        artifact_root: context.artifactRoot,
        sandbox_output_root_policy: context.sandboxOutputRootPolicy,
        artifact_quota_policy: context.artifactQuotaPolicy,
      }),
    );
  });

  it('fails closed with public before_run reason codes for non-zero exits, timeouts, and governor errors', async () => {
    for (const scenario of [
      {
        output: { exit_code: 7, public_summary: 'raw failure details should not leak' },
        expectedCode: 'before_run_hook_failed',
      },
      {
        output: { exit_code: null, timed_out: true, public_summary: 'raw timeout details should not leak' },
        expectedCode: 'before_run_hook_timed_out',
      },
      {
        output: new Error('governor leaked raw internal path /tmp/secret'),
        expectedCode: 'before_run_hook_failed',
      },
    ] as const) {
      const result = await runBeforeRunHooks({
        frozenHookSpecs: { before_run: [{ hook_id: 'before-1', command: hookCommand(['preflight']) }] },
        runGovernor: new RecordingRunGovernor([scenario.output]),
        commandContext: commandContext(),
        maxHookTimeoutMs: 5_000,
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false ? result.blocker.code : undefined).toBe(scenario.expectedCode);
      expect(result.ok === false ? result.blocker.retryable : undefined).toBe(true);
      expect(result.ok === false ? result.blocker.summary : '').not.toContain('/tmp/secret');
      expect(result.ok === false ? result.blocker.summary : '').not.toContain('raw');
    }
  });

  it('rejects before_run hooks above the attested max hook timeout without running the governor', async () => {
    const governor = new RecordingRunGovernor([{}]);

    const result = await runBeforeRunHooks({
      frozenHookSpecs: {
        before_run: [{ hook_id: 'slow-before', command: hookCommand(['slow'], { timeout_ms: 10_000 }) }],
      },
      runGovernor: governor,
      commandContext: commandContext(),
      maxHookTimeoutMs: 5_000,
    });

    expect(governor.calls).toHaveLength(0);
    expect(result).toMatchObject({
      ok: false,
      blocker: {
        code: 'structured_command_invalid',
        hook_id: 'slow-before',
        retryable: false,
      },
    });
  });

  it('passes validated mock run context through to test-only mock governors', async () => {
    const result = await runBeforeRunHooks({
      frozenHookSpecs: { before_run: [{ hook_id: 'before-1', command: hookCommand(['mock']) }] },
      runGovernor: new TestOnlyMockResourceGovernor('mock-governor', () => '2026-05-05T00:00:00.000Z'),
      commandContext: commandContext(),
      maxHookTimeoutMs: 5_000,
      mockRunContext: { executorType: 'mock', workflowOnly: true, environment: 'test' },
    });

    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('records after_run failures internally without changing terminal status or review finalization eligibility', async () => {
    const governor = new RecordingRunGovernor([
      {
        exit_code: 9,
        stdout_ref: '/artifacts/run-1/after-stdout.txt',
        stderr_ref: '/artifacts/run-1/after-stderr.txt',
        public_summary: 'post hook failed',
      },
    ]);

    const result = await runAfterRunHooks({
      frozenHookSpecs: {
        after_run: [
          {
            hook_id: 'after-1',
            command: hookCommand(['post-run'], { source_write_policy: 'artifact_only' }),
          },
        ],
      },
      runGovernor: governor,
      commandContext: commandContext(),
      maxHookTimeoutMs: 5_000,
      readOnlySourceEnforced: true,
      terminalStatus: 'succeeded',
      reviewFinalizationEligible: true,
    });

    expect(result.terminalStatus).toBe('succeeded');
    expect(result.reviewFinalizationEligible).toBe(true);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        hook_id: 'after-1',
        phase: 'after_run',
        status: 'failed',
        visibility: 'internal',
        stdout_ref: '/artifacts/run-1/after-stdout.txt',
        stderr_ref: '/artifacts/run-1/after-stderr.txt',
      }),
    ]);
    expect(governor.calls[0]?.command.source_write_policy).toBe('artifact_only');
  });

  it('skips after_run hooks with internal diagnostics when read-only source enforcement is unavailable', async () => {
    const governor = new RecordingRunGovernor([{}]);

    const result = await runAfterRunHooks({
      frozenHookSpecs: {
        after_run: [{ hook_id: 'after-1', command: hookCommand(['post-run'], { source_write_policy: 'artifact_only' }) }],
      },
      runGovernor: governor,
      commandContext: commandContext(),
      maxHookTimeoutMs: 5_000,
      readOnlySourceEnforced: false,
      terminalStatus: 'failed',
      reviewFinalizationEligible: false,
    });

    expect(governor.calls).toHaveLength(0);
    expect(result).toMatchObject({
      terminalStatus: 'failed',
      reviewFinalizationEligible: false,
      diagnostics: [
        {
          hook_id: 'after-1',
          phase: 'after_run',
          status: 'skipped',
          visibility: 'internal',
          reason_code: 'after_run_read_only_unavailable',
        },
      ],
    });
  });
});
