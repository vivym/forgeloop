import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  runRequiredChecks,
  resourceLimitDigest,
  TestOnlyMockResourceGovernor,
  type RequiredCheckArtifactWriter,
  type RequiredCheckRunnerCommandContext,
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
  readonly governorId = 'recording-check-governor';
  readonly provenance = 'test_only_mock' as const;
  readonly calls: ResourceGovernorRunInput[] = [];

  constructor(private readonly outputs: Array<Partial<StructuredCommandResult>>) {}

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
    const importedOutput = input.scope === 'run' ? await importSandboxOutputRefs(input, output) : output;
    return {
      exit_code: 0,
      timed_out: false,
      stdout_truncated: false,
      stderr_truncated: false,
      visibility: 'internal',
      public_summary: 'check completed',
      ...importedOutput,
    };
  }
}

class RecordingArtifactWriter implements RequiredCheckArtifactWriter {
  readonly imports: Array<Parameters<RequiredCheckArtifactWriter['importSandboxOutput']>[0]> = [];

  constructor(private readonly error?: Error & { code?: string }) {}

  async importSandboxOutput(input: Parameters<RequiredCheckArtifactWriter['importSandboxOutput']>[0]) {
    if (this.error !== undefined) {
      throw this.error;
    }
    this.imports.push(input);
    return {
      kind: input.kind,
      name: input.name,
      content_type: input.contentType,
      local_ref: `/artifacts/run-1/${input.name}`,
      digest: `sha256:${input.relativePath}`,
    };
  }
}

const importSandboxOutputRefs = async (
  input: Extract<ResourceGovernorRunInput, { scope: 'run' }>,
  output: Partial<StructuredCommandResult>,
): Promise<Partial<StructuredCommandResult>> => {
  const result = { ...output };
  const outputArtifacts: NonNullable<StructuredCommandResult['output_artifacts']> = {};
  if (output.stdout_ref !== undefined && input.outputImporter !== undefined && input.sandboxOutputArtifacts?.stdout !== undefined) {
    const artifact = await input.outputImporter.importSandboxOutput({
      sandboxOutputRoot: input.bindings.sandboxOutputRoot,
      relativePath: output.stdout_ref,
      kind: input.sandboxOutputArtifacts.stdout.kind,
      name: input.sandboxOutputArtifacts.stdout.name,
      contentType: input.sandboxOutputArtifacts.stdout.contentType ?? 'text/plain',
      visibility: input.sandboxOutputArtifacts.stdout.visibility,
    });
    result.stdout_ref = artifact.storage_uri ?? artifact.local_ref;
    outputArtifacts.stdout = artifact;
  }
  if (output.stderr_ref !== undefined && input.outputImporter !== undefined && input.sandboxOutputArtifacts?.stderr !== undefined) {
    const artifact = await input.outputImporter.importSandboxOutput({
      sandboxOutputRoot: input.bindings.sandboxOutputRoot,
      relativePath: output.stderr_ref,
      kind: input.sandboxOutputArtifacts.stderr.kind,
      name: input.sandboxOutputArtifacts.stderr.name,
      contentType: input.sandboxOutputArtifacts.stderr.contentType ?? 'text/plain',
      visibility: input.sandboxOutputArtifacts.stderr.visibility,
    });
    result.stderr_ref = artifact.storage_uri ?? artifact.local_ref;
    outputArtifacts.stderr = artifact;
  }
  if (Object.keys(outputArtifacts).length > 0) {
    result.output_artifacts = outputArtifacts;
  }
  return result;
};

const trustedToolchains = (): TrustedToolchainConfig => ({
  root_paths: [shellRoot],
  executable_paths: { tool: shellPath },
  path_entries: [shellRoot],
  writable: false,
});

const commandContext = (): RequiredCheckRunnerCommandContext => {
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

const checkCommand = (args: string[], overrides: Record<string, unknown> = {}) => ({
  executable: 'tool',
  args,
  cwd: 'workspace_root' as const,
  timeout_ms: 1_000,
  output_limit_bytes: 10_000,
  visibility: 'public_safe' as const,
  source_write_policy: 'path_policy_scoped' as const,
  ...overrides,
});

describe('RequiredCheckRunner', () => {
  it('consumes frozen structured check policy and runs checks only after primary execution', async () => {
    const artifactWriter = new RecordingArtifactWriter();
    const governor = new RecordingRunGovernor([{ stdout_ref: 'stdout.txt', stderr_ref: 'stderr.txt' }]);

    await expect(
      runRequiredChecks({
        frozenCheckPolicy: {
          required_checks: [
            {
              check_id: 'unit',
              display_name: 'Unit Tests',
              source: 'repo_policy',
              blocks_review: true,
              timeout_ms: 1_000,
              command: checkCommand(['frozen-only']),
              visibility: 'internal',
            },
          ],
        },
        runGovernor: governor,
        artifactWriter,
        commandContext: commandContext(),
        primaryExecutionCompleted: false,
      }),
    ).resolves.toMatchObject({
      ok: false,
      blockers: [],
      checks: [],
      diagnostics: [{ reason_code: 'required_checks_before_primary_execution' }],
    });

    expect(governor.calls).toHaveLength(0);

    const result = await runRequiredChecks({
      frozenCheckPolicy: {
        required_checks: [
          {
            check_id: 'unit',
            display_name: 'Unit Tests',
            source: 'repo_policy',
            blocks_review: true,
            timeout_ms: 1_000,
            command: checkCommand(['frozen-only']),
            visibility: 'internal',
          },
        ],
      },
      runGovernor: governor,
      artifactWriter,
      commandContext: commandContext(),
      primaryExecutionCompleted: true,
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual([
      expect.objectContaining({
        check_id: 'unit',
        command: 'structured:unit',
        status: 'succeeded',
        exit_code: 0,
        blocks_review: true,
        stdout: expect.objectContaining({
          kind: 'check_output',
          local_ref: '/artifacts/run-1/unit-stdout.txt',
          digest: 'sha256:stdout.txt',
        }),
        stderr: expect.objectContaining({
          kind: 'check_output',
          local_ref: '/artifacts/run-1/unit-stderr.txt',
          digest: 'sha256:stderr.txt',
        }),
      }),
    ]);
    expect(artifactWriter.imports).toEqual([
      expect.objectContaining({ relativePath: 'stdout.txt', kind: 'check_output', name: 'unit-stdout.txt', visibility: 'internal' }),
      expect.objectContaining({ relativePath: 'stderr.txt', kind: 'check_output', name: 'unit-stderr.txt', visibility: 'internal' }),
    ]);
    expect(result.checks[0]?.command).not.toContain('frozen-only');
    expect(governor.calls).toHaveLength(1);
    expect(governor.calls[0]?.scope).toBe('run');
    expect(governor.calls[0]?.command.args).toEqual(['frozen-only']);
  });

  it('maps non-zero and timed-out blocking checks to sanitized blockers', async () => {
    const result = await runRequiredChecks({
      frozenCheckPolicy: {
        required_checks: [
          {
            check_id: 'lint',
            display_name: 'Lint',
            source: 'repo_policy',
            blocks_review: true,
            timeout_ms: 1_000,
            command: checkCommand(['lint']),
            visibility: 'internal',
          },
          {
            check_id: 'types',
            display_name: 'Typecheck',
            source: 'repo_policy',
            blocks_review: true,
            timeout_ms: 1_000,
            command: checkCommand(['types']),
            visibility: 'internal',
          },
        ],
      },
      runGovernor: new RecordingRunGovernor([
        { exit_code: 2, public_summary: 'raw lint output /tmp/secret' },
        { exit_code: null, timed_out: true, public_summary: 'raw timeout output /tmp/secret' },
      ]),
      artifactWriter: new RecordingArtifactWriter(),
      commandContext: commandContext(),
      primaryExecutionCompleted: true,
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toMatchObject([
      { check_id: 'lint', status: 'failed', exit_code: 2, blocks_review: true },
      { check_id: 'types', status: 'timed_out', exit_code: null, blocks_review: true },
    ]);
    expect(result.blockers).toEqual([
      expect.objectContaining({ code: 'required_check_failed', check_id: 'lint', retryable: true }),
      expect.objectContaining({ code: 'required_check_timed_out', check_id: 'types', retryable: true }),
    ]);
    expect(result.blockers.map((blocker) => blocker.summary).join('\n')).not.toContain('/tmp/secret');
    expect(result.blockers.map((blocker) => blocker.summary).join('\n')).not.toContain('raw');
  });

  it('records nonblocking check failures without review blockers', async () => {
    const result = await runRequiredChecks({
      frozenCheckPolicy: {
        required_checks: [
          {
            check_id: 'advisory',
            display_name: 'Advisory',
            source: 'repo_policy',
            blocks_review: false,
            timeout_ms: 1_000,
            command: checkCommand(['advisory']),
            visibility: 'internal',
          },
        ],
      },
      runGovernor: new RecordingRunGovernor([{ exit_code: 3, public_summary: 'raw advisory failure' }]),
      artifactWriter: new RecordingArtifactWriter(),
      commandContext: commandContext(),
      primaryExecutionCompleted: true,
    });

    expect(result).toMatchObject({
      ok: true,
      blockers: [],
      checks: [{ check_id: 'advisory', status: 'failed', exit_code: 3, blocks_review: false }],
    });
  });

  it('rejects checks that exceed frozen timeout without running the governor', async () => {
    const governor = new RecordingRunGovernor([{}]);

    const result = await runRequiredChecks({
      frozenCheckPolicy: {
        required_checks: [
          {
            check_id: 'slow-check',
            display_name: 'Slow Check',
            source: 'repo_policy',
            blocks_review: true,
            timeout_ms: 1_000,
            command: checkCommand(['slow'], { timeout_ms: 5_000 }),
            visibility: 'internal',
          },
        ],
      },
      runGovernor: governor,
      artifactWriter: new RecordingArtifactWriter(),
      commandContext: commandContext(),
      primaryExecutionCompleted: true,
    });

    expect(governor.calls).toHaveLength(0);
    expect(result).toMatchObject({
      ok: false,
      checks: [],
      blockers: [{ code: 'structured_command_invalid', check_id: 'slow-check', retryable: false }],
    });
  });

  it('passes validated mock run context through to test-only mock governors', async () => {
    const result = await runRequiredChecks({
      frozenCheckPolicy: {
        required_checks: [
          {
            check_id: 'unit',
            display_name: 'Unit Tests',
            source: 'repo_policy',
            blocks_review: true,
            timeout_ms: 1_000,
            command: checkCommand(['mock']),
            visibility: 'internal',
          },
        ],
      },
      runGovernor: new TestOnlyMockResourceGovernor('mock-governor', () => '2026-05-05T00:00:00.000Z'),
      artifactWriter: new RecordingArtifactWriter(),
      commandContext: commandContext(),
      primaryExecutionCompleted: true,
      mockRunContext: { executorType: 'mock', workflowOnly: true, environment: 'test' },
    });

    expect(result).toMatchObject({
      ok: true,
      blockers: [],
      checks: [{ check_id: 'unit', status: 'succeeded', exit_code: 0 }],
    });
  });

  it('keeps raw output artifacts internal by default and leaves source-writing checks subject to final PathPolicy', async () => {
    const result = await runRequiredChecks({
      frozenCheckPolicy: {
        required_checks: [
          {
            check_id: 'generate',
            display_name: 'Generate',
            source: 'repo_policy',
            blocks_review: true,
            timeout_ms: 1_000,
            command: checkCommand(['write-source']),
            visibility: 'public_safe',
          },
        ],
      },
      runGovernor: new RecordingRunGovernor([{ stdout_ref: 'generate-stdout.txt', stderr_ref: 'generate-stderr.txt' }]),
      artifactWriter: new RecordingArtifactWriter(),
      commandContext: commandContext(),
      primaryExecutionCompleted: true,
    });

    expect(result.ok).toBe(true);
    expect(result.checks[0]).toEqual(
      expect.objectContaining({
        stdout: expect.objectContaining({ kind: 'check_output', local_ref: '/artifacts/run-1/generate-stdout.txt' }),
        stderr: expect.objectContaining({ kind: 'check_output', local_ref: '/artifacts/run-1/generate-stderr.txt' }),
      }),
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        check_id: 'generate',
        visibility: 'internal',
        source_write_policy: 'path_policy_scoped',
        path_policy_finalization_required: true,
      }),
    ]);
  });

  it('maps artifact writer visibility failures to artifact_visibility_denied', async () => {
    const error = Object.assign(new Error('raw local path /tmp/secret'), { code: 'artifact_visibility_denied' });
    const result = await runRequiredChecks({
      frozenCheckPolicy: {
        required_checks: [
          {
            check_id: 'unit',
            display_name: 'Unit Tests',
            source: 'repo_policy',
            blocks_review: true,
            timeout_ms: 1_000,
            command: checkCommand(['unit']),
            visibility: 'internal',
          },
        ],
      },
      runGovernor: new RecordingRunGovernor([{ stdout_ref: 'stdout.txt' }]),
      artifactWriter: new RecordingArtifactWriter(error),
      commandContext: commandContext(),
      primaryExecutionCompleted: true,
    });

    expect(result).toMatchObject({
      ok: false,
      blockers: [{ code: 'artifact_visibility_denied', check_id: 'unit', retryable: false }],
      checks: [{ check_id: 'unit', status: 'failed', blocks_review: true }],
    });
    expect(result.blockers[0]?.summary).not.toContain('/tmp/secret');
  });
});
