import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ExternalSandboxResourceGovernor,
  TestOnlyMockResourceGovernor,
  UnavailableResourceGovernor,
  resourceLimitDigest,
  structuredCommandDigest,
  validateRunExecutionAttestation,
  type MaterializedStructuredCommand,
  type ResourceGovernor,
  type ResourceLimitVector,
  type SandboxLauncher,
  type SandboxOutputImporter,
  type SandboxTrustVerifier,
} from '../../packages/executor/src/index';

const sha = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const shellPath = realpathSync('/bin/sh');
const shellRoot = dirname(shellPath);
const sandboxBinaryDigest = `sha256:${createHash('sha256').update(readFileSync(shellPath)).digest('hex')}`;

const resourceLimits = (overrides: Partial<ResourceLimitVector> = {}): ResourceLimitVector => ({
  cpu_ms: 1_000,
  memory_mb: 512,
  pids: 32,
  fds: 64,
  workspace_bytes: 1_048_576,
  artifact_bytes: 1_048_576,
  timeout_ms: 30_000,
  output_limit_bytes: 100_000,
  run_output_limit_bytes: 500_000,
  ...overrides,
});

const command = (overrides: Partial<MaterializedStructuredCommand> = {}): MaterializedStructuredCommand => ({
  executable: 'sh',
  args: ['-c', 'true'],
  cwd: 'workspace_root',
  timeout_ms: 30_000,
  output_limit_bytes: 100_000,
  env: {},
  visibility: 'internal',
  source_write_policy: 'read_only',
  resolved_executable_path: shellPath,
  executable_identity_digest: sha,
  path_entries: [shellRoot],
  ...overrides,
});

const runBindings = (cmd = command()) => {
  const limits = resourceLimits();
  const resourceDigest = resourceLimitDigest(limits);
  return {
    runId: 'run-1',
    commandId: 'cmd-1',
    commandDigest: structuredCommandDigest({
      command: cmd,
      resource_limit_digest: resourceDigest,
      run_id: 'run-1',
      workspace_root: '/workspace/repo',
      artifact_root: '/artifacts/run-1',
      sandbox_output_root_policy: 'ephemeral_sandbox_output_only',
      artifact_quota_policy: 'sha256:artifact-quota',
    }),
    workspaceRoot: '/workspace/repo',
    artifactRoot: '/artifacts/run-1',
    sandboxOutputRoot: '/sandbox-output/run-1',
    sandboxOutputRootPolicy: 'ephemeral_sandbox_output_only',
    artifactQuotaPolicy: 'sha256:artifact-quota',
    policyDigest: sha,
    policySnapshotVersion: 1,
    envPolicyDigest: sha,
    commandPolicyDigest: sha,
    mountPolicyDigest: sha,
    networkPolicyDigest: 'network-disabled',
    resourceLimitDigest: resourceDigest,
    networkMode: 'disabled' as const,
    resourceLimits: limits,
  };
};

const attestationInput = () => ({
  executorType: 'local_codex',
  workflowOnly: false,
  environment: 'local_dogfood' as const,
  projectId: 'project-1',
  repoId: 'repo-1',
  executionPackageId: 'package-1',
  expectedPackageVersion: 2,
  now: '2026-05-05T00:00:00.000Z',
  expiresAt: '2026-05-05T00:05:00.000Z',
  ...runBindings(),
});

const selfCheck = (overrides: Record<string, unknown> = {}) => ({
  sandbox_id: 'sandbox-1',
  sandbox_version: 'sandbox@1',
  sandbox_binary_digest: sandboxBinaryDigest,
  sandbox_config_digest: sha,
  supports_cpu_limit: true,
  supports_memory_limit: true,
  supports_process_limit: true,
  supports_fd_limit: true,
  supports_workspace_disk_limit: true,
  supports_artifact_size_limit: true,
  supports_filesystem_containment: true,
  supports_host_secret_isolation: true,
  supports_network_policy: true,
  supports_wrapper_env_isolation: true,
  supports_process_tree_kill: true,
  mount_policy_digest: sha,
  network_mode: 'disabled',
  max_command_timeout_ms: 120_000,
  max_hook_timeout_ms: 30_000,
  max_command_output_bytes: 1_000_000,
  max_run_output_bytes: 5_000_000,
  ...overrides,
});

const sandboxResult = (overrides: Record<string, unknown> = {}) => ({
  exit_code: 0,
  timed_out: false,
  stdout_ref: 'artifacts/run/stdout.txt',
  stderr_ref: 'artifacts/run/stderr.txt',
  stdout_truncated: false,
  stderr_truncated: false,
  visibility: 'internal',
  public_summary: 'Command completed.',
  ...overrides,
});

const sandboxResultWithoutRefs = (overrides: Record<string, unknown> = {}) => ({
  exit_code: 0,
  timed_out: false,
  stdout_truncated: false,
  stderr_truncated: false,
  visibility: 'internal',
  public_summary: 'Command completed.',
  ...overrides,
});

const scriptedLauncher = (responses: Array<{ stdout?: string; stderr?: string; timedOut?: boolean; exitCode?: number }>) => {
  const calls: Array<{ file: string; args: string[]; options: Parameters<SandboxLauncher>[2] }> = [];
  const launcher: SandboxLauncher = async (file, args, options) => {
    calls.push({ file, args: [...args], options });
    const response = responses.shift();
    if (response === undefined) {
      throw new Error('Unexpected sandbox launch');
    }
    return {
      stdout: response.stdout ?? '',
      stderr: response.stderr ?? '',
      timedOut: response.timedOut ?? false,
      exitCode: response.exitCode ?? 0,
    };
  };
  return { launcher, calls };
};

const createExternalGovernor = (
  launcher: SandboxLauncher,
  options: { nonceFactory?: () => string; now?: () => string; outputImporter?: SandboxOutputImporter } = {},
) =>
  new ExternalSandboxResourceGovernor({
    governorId: 'governor-1',
    sandboxExecutablePath: shellPath,
    sandboxBinaryDigest,
    sandboxConfigDigest: sha,
    trustedRootPaths: [shellRoot],
    disallowedRuntimeRoots: ['/workspace/repo', '/artifacts/run-1', '/tmp/forgeloop-package'],
    wrapperCwd: '/',
    launcher,
    trustVerifier: testTrustVerifier,
    outputImporter: options.outputImporter ?? createRecordingImporter().importer,
    nonceFactory: options.nonceFactory ?? (() => `nonce-${Math.random()}`),
    now: options.now ?? (() => '2026-05-05T00:00:00.000Z'),
  });

describe('ResourceGovernor', () => {
  it('reports unavailable hard limits and cannot satisfy local Codex execution', async () => {
    const governor = new UnavailableResourceGovernor('unavailable-1');
    const attestation = await governor.createRunExecutionAttestation(attestationInput());

    expect(await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'production' })).toMatchObject({
      status: 'unavailable',
      reason_code: 'runtime_hard_limits_unavailable',
    });
    expect(attestation).toMatchObject({
      attestation_scope: 'run_execution',
      hard_limit_mode: 'unavailable',
      governor_provenance: 'unavailable',
      reason_code: 'runtime_hard_limits_unavailable',
    });
    expect(
      validateRunExecutionAttestation({
        attestation,
        expected: {
          executorType: 'local_codex',
          workflowOnly: false,
          environment: 'production',
          projectId: 'project-1',
          repoId: 'repo-1',
          executionPackageId: 'package-1',
          expectedPackageVersion: 2,
          runId: 'run-1',
          policyDigest: sha,
          policySnapshotVersion: 1,
          envPolicyDigest: sha,
          commandPolicyDigest: sha,
          mountPolicyDigest: sha,
          networkPolicyDigest: 'network-disabled',
          networkMode: 'disabled',
          resourceLimitDigest: resourceLimitDigest(resourceLimits()),
          governorId: 'unavailable-1',
          sandboxId: 'sandbox-1',
          sandboxVersion: 'sandbox@1',
          sandboxBinaryDigest: sha,
          sandboxConfigDigest: sha,
          sandboxWrapperEnvironmentDigest: sha,
          workspaceRoot: '/workspace/repo',
          artifactRoot: '/artifacts/run-1',
          sandboxOutputRoot: '/sandbox-output/run-1',
          now: '2026-05-05T00:00:00.000Z',
        },
      }),
    ).toMatchObject({ ok: false, code: 'runtime_hard_limits_unavailable' });
  });

  it('allows the test-only mock governor only for mock workflow test or dogfood runs', async () => {
    const governor = new TestOnlyMockResourceGovernor('mock-governor', () => '2026-05-05T00:00:00.000Z');

    await expect(
      governor.createRunExecutionAttestation({
        ...attestationInput(),
        executorType: 'mock',
        workflowOnly: true,
        environment: 'test',
      }),
    ).resolves.toMatchObject({
      hard_limit_mode: 'test_only_mock',
      governor_provenance: 'test_only_mock',
      executor_type: 'mock',
      workflow_only: true,
    });

    await expect(
      governor.createRunExecutionAttestation({
        ...attestationInput(),
        executorType: 'local_codex',
        workflowOnly: false,
      }),
    ).rejects.toMatchObject({ code: 'runtime_test_only_mock_forbidden' });
  });

  it('self-checks the external sandbox with canonical path, sanitized env, trusted cwd, timeout, and bounded output', async () => {
    const { launcher, calls } = scriptedLauncher([{ stdout: JSON.stringify(selfCheck()) }]);
    const governor = createExternalGovernor(launcher);

    await expect(
      governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' }),
    ).resolves.toMatchObject({ status: 'ready', sandbox_id: 'sandbox-1' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      file: shellPath,
      args: ['--forgeloop-self-check', '--json', '--config-digest', sha],
      options: expect.objectContaining({
        cwd: '/',
        env: {},
        timeoutMs: expect.any(Number),
        outputLimitBytes: expect.any(Number),
      }),
    });
    expect(calls[0]?.options.env).not.toHaveProperty('PATH');
    expect(calls[0]?.options.timeoutMs).toBeLessThanOrEqual(5_000);
    expect(calls[0]?.options.outputLimitBytes).toBeLessThanOrEqual(64 * 1024);
  });

  it.each([
    ['timeout', { timedOut: true }],
    ['non-json', { stdout: 'not json' }],
    ['oversized output', { stdout: 'x'.repeat(70 * 1024) }],
    ['stderr-only failure', { stderr: 'fatal sandbox error\n' }],
    ['missing dimensions', { stdout: JSON.stringify(selfCheck({ supports_cpu_limit: undefined })) }],
    ['missing process-tree kill', { stdout: JSON.stringify(selfCheck({ supports_process_tree_kill: false })) }],
    ['missing wrapper env isolation', { stdout: JSON.stringify(selfCheck({ supports_wrapper_env_isolation: false })) }],
    ['missing filesystem containment', { stdout: JSON.stringify(selfCheck({ supports_filesystem_containment: false })) }],
    ['missing host-secret isolation', { stdout: JSON.stringify(selfCheck({ supports_host_secret_isolation: false })) }],
    ['network policy mismatch', { stdout: JSON.stringify(selfCheck({ network_mode: 'egress_allowlist' })) }],
  ])('fails closed when self-check returns %s', async (_label, response) => {
    const { launcher } = scriptedLauncher([response]);
    const governor = createExternalGovernor(launcher);

    await expect(
      governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason_code: 'runtime_hard_limits_unavailable',
    });
  });

  it('uses distinct bootstrap and run sandbox protocols', async () => {
    const { launcher, calls } = scriptedLauncher([
      { stdout: JSON.stringify(selfCheck()) },
      { stdout: JSON.stringify(sandboxResultWithoutRefs()) },
      { stdout: JSON.stringify(sandboxResult({ public_summary: 'Run command completed.' })) },
      { stdout: JSON.stringify(sandboxResult({ public_summary: 'Safe git command completed.' })) },
    ]);
    const governor = createExternalGovernor(launcher, { nonceFactory: createNonceFactory(['nonce-bootstrap', 'nonce-run', 'nonce-safe-git']) });
    await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });

    await governor.run({
      scope: 'bootstrap',
      command: command(),
      bindings: {
        bootstrapId: 'bootstrap-1',
        commandId: 'bootstrap-cmd-1',
        commandDigest: 'sha256:bootstrap-command',
        repoRoot: '/repo/source',
        workspaceParent: '/repo/.worktrees',
        artifactRoot: '/artifacts/run-1',
        cwd: '/repo/source',
        safeGitProfile: 'forgeloop_default',
      },
    });
    await governor.run({ scope: 'run', command: command(), bindings: runBindings() });

    expect(calls[1]?.args).toEqual([
      '--forgeloop-bootstrap-run',
      '--json',
      '--bootstrap-id',
      'bootstrap-1',
      '--nonce',
      'nonce-bootstrap',
      '--command-id',
      'bootstrap-cmd-1',
      '--command-digest',
      'sha256:bootstrap-command',
      '--repo-root',
      '/repo/source',
      '--workspace-parent',
      '/repo/.worktrees',
      '--artifact-root',
      '/artifacts/run-1',
      '--cwd',
      '/repo/source',
      '--safe-git-profile',
      'forgeloop_default',
      '--timeout-ms',
      '30000',
      '--output-limit-bytes',
      '100000',
      '--',
      shellPath,
      '-c',
      'true',
    ]);
    expect(calls[2]?.args).toEqual(
      expect.arrayContaining([
        '--forgeloop-run',
        '--run-id',
        'run-1',
        '--nonce',
        'nonce-run',
        '--command-digest',
        runBindings().commandDigest,
        '--resource-limit-digest',
        runBindings().resourceLimitDigest,
        '--network-mode',
        'disabled',
        '--visibility',
        'internal',
        '--source-write-policy',
        'read_only',
        '--cpu-ms',
        '1000',
        '--memory-mb',
        '512',
        '--pids',
        '32',
        '--fds',
        '64',
        '--workspace-bytes',
        '1048576',
        '--artifact-bytes',
        '1048576',
        shellPath,
      ]),
    );

    const safeGitCommand = command({ args: ['-c', 'git-safe'] });
    await governor.run({ scope: 'run', command: safeGitCommand, bindings: { ...runBindings(safeGitCommand), safeGitProfile: 'forgeloop_default' } });
    expect(calls[3]?.args).toEqual(expect.arrayContaining(['--safe-git-profile', 'forgeloop_default', '--', shellPath]));
  });

  it('rejects replayed command nonces while allowing distinct nonces under the same governor', async () => {
    const { launcher } = scriptedLauncher([
      { stdout: JSON.stringify(selfCheck()) },
      { stdout: JSON.stringify(sandboxResult()) },
      { stdout: JSON.stringify(sandboxResult()) },
    ]);
    const governor = createExternalGovernor(launcher, { nonceFactory: createNonceFactory(['nonce-1', 'nonce-2']) });
    await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });
    await expect(governor.run({ scope: 'run', command: command(), bindings: runBindings() })).resolves.toMatchObject({
      exit_code: 0,
    });
    await expect(governor.run({ scope: 'run', command: command({ args: ['-c', 'echo second'] }), bindings: runBindings(command({ args: ['-c', 'echo second'] })) })).resolves.toMatchObject({
      exit_code: 0,
    });

    const replay = createExternalGovernor(
      scriptedLauncher([{ stdout: JSON.stringify(selfCheck()) }, { stdout: JSON.stringify(sandboxResult()) }]).launcher,
      { nonceFactory: createNonceFactory(['nonce-replay', 'nonce-replay']) },
    );
    await replay.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });
    await replay.run({ scope: 'run', command: command(), bindings: runBindings() });
    await expect(replay.run({ scope: 'run', command: command(), bindings: runBindings() })).rejects.toMatchObject({
      code: 'resource_governor_nonce_replay',
    });
  });

  it('creates app-server leases bound to run spec, prompt, roots, policy, resource limits, config, and nonce requirement', async () => {
    const { launcher } = scriptedLauncher([{ stdout: JSON.stringify(selfCheck()) }]);
    const governor = createExternalGovernor(launcher, {
      nonceFactory: createNonceFactory(['nonce-lease']),
      now: () => '2026-05-05T00:00:00.000Z',
    });
    await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });

    const lease = await governor.createRunLease({
      ...attestationInput(),
      workerIdentity: 'worker-1',
      promptDigest: 'sha256:prompt',
      runSpecDigest: 'sha256:run-spec',
    });

    expect(lease).toMatchObject({
      run_id: 'run-1',
      worker_identity: 'worker-1',
      workspace_root: '/workspace/repo',
      artifact_root: '/artifacts/run-1',
      sandbox_output_root: '/sandbox-output/run-1',
      policy_digest: sha,
      policy_snapshot_version: 1,
      resource_limit_digest: resourceLimitDigest(resourceLimits()),
      sandbox_config_digest: sha,
      prompt_digest: 'sha256:prompt',
      run_spec_digest: 'sha256:run-spec',
      command_invocation_nonce_required: true,
    });
    expect(lease.attestation).toMatchObject({ attestation_scope: 'run_execution', hard_limit_mode: 'enforcing' });
  });

  it('host-verifies sandbox binary identity and rejects mismatched self-check identity', async () => {
    expect(
      () =>
        new ExternalSandboxResourceGovernor({
          governorId: 'governor-1',
          sandboxExecutablePath: shellPath,
          sandboxBinaryDigest: sha,
          sandboxConfigDigest: sha,
          trustedRootPaths: [shellRoot],
          wrapperCwd: '/',
          launcher: scriptedLauncher([]).launcher,
        }),
    ).toThrowError(expect.objectContaining({ code: 'runtime_hard_limits_unavailable' }));

    const { launcher } = scriptedLauncher([
      { stdout: JSON.stringify(selfCheck({ sandbox_binary_digest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111' })) },
    ]);
    const governor = createExternalGovernor(launcher);
    await expect(
      governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' }),
    ).resolves.toMatchObject({ status: 'unavailable', reason_code: 'runtime_hard_limits_unavailable' });
  });

  it('rejects mount policy mismatches before attestation or command launch', async () => {
    const { launcher, calls } = scriptedLauncher([{ stdout: JSON.stringify(selfCheck({ mount_policy_digest: 'sha256:mount-other' })) }]);
    const governor = createExternalGovernor(launcher, { nonceFactory: createNonceFactory(['nonce-never-used']) });
    await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });

    await expect(governor.createRunExecutionAttestation(attestationInput())).rejects.toMatchObject({
      code: 'runtime_hard_limits_unavailable',
    });
    await expect(governor.run({ scope: 'run', command: command(), bindings: runBindings() })).rejects.toMatchObject({
      code: 'runtime_hard_limits_unavailable',
    });
    expect(calls).toHaveLength(1);
  });

  it('rejects impossible scope and binding pairs before sandbox launch', async () => {
    const { launcher, calls } = scriptedLauncher([{ stdout: JSON.stringify(selfCheck()) }]);
    const governor = createExternalGovernor(launcher, { nonceFactory: createNonceFactory(['nonce-never-used']) });
    await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });

    await expect(
      governor.run({
        scope: 'run',
        command: command(),
        bindings: {
          bootstrapId: 'bootstrap-1',
          commandId: 'bootstrap-cmd-1',
          commandDigest: 'sha256:bootstrap-command',
          repoRoot: '/repo/source',
          workspaceParent: '/repo/.worktrees',
          artifactRoot: '/artifacts/run-1',
          cwd: '/repo/source',
          safeGitProfile: 'forgeloop_default',
        },
      } as never),
    ).rejects.toMatchObject({ code: 'resource_governor_protocol_error' });
    expect(calls).toHaveLength(1);
  });

  it('rejects run invocations whose command or resource digest does not match the actual command and vector', async () => {
    const { launcher, calls } = scriptedLauncher([{ stdout: JSON.stringify(selfCheck()) }]);
    const governor = createExternalGovernor(launcher, { nonceFactory: createNonceFactory(['nonce-never-used']) });
    await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });

    await expect(
      governor.run({
        scope: 'run',
        command: command({ args: ['-c', 'echo changed'] }),
        bindings: runBindings(command()),
      }),
    ).rejects.toMatchObject({ code: 'resource_governor_digest_mismatch' });

    await expect(
      governor.run({
        scope: 'run',
        command: command(),
        bindings: { ...runBindings(), resourceLimits: resourceLimits({ cpu_ms: 2_000 }) },
      }),
    ).rejects.toMatchObject({ code: 'resource_governor_digest_mismatch' });
    expect(calls).toHaveLength(1);
  });

  it('imports sandbox output refs through the artifact importer and rejects unsafe refs', async () => {
    const recorder = createRecordingImporter();
    const { launcher } = scriptedLauncher([{ stdout: JSON.stringify(selfCheck()) }, { stdout: JSON.stringify(sandboxResult()) }]);
    const governor = createExternalGovernor(launcher, {
      outputImporter: recorder.importer,
      nonceFactory: createNonceFactory(['nonce-import']),
    });
    await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });

    await expect(governor.run({ scope: 'run', command: command(), bindings: runBindings() })).resolves.toMatchObject({
      stdout_ref: 'artifacts/imported-stdout.txt',
      stderr_ref: 'artifacts/imported-stderr.txt',
    });
    expect(recorder.calls).toEqual([
      expect.objectContaining({ sandboxOutputRoot: '/sandbox-output/run-1', relativePath: 'artifacts/run/stdout.txt' }),
      expect.objectContaining({ sandboxOutputRoot: '/sandbox-output/run-1', relativePath: 'artifacts/run/stderr.txt' }),
    ]);

    const unsafe = createExternalGovernor(
      scriptedLauncher([{ stdout: JSON.stringify(selfCheck()) }, { stdout: JSON.stringify(sandboxResult({ stdout_ref: '../escape.txt' })) }]).launcher,
      { outputImporter: recorder.importer, nonceFactory: createNonceFactory(['nonce-unsafe']) },
    );
    await unsafe.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });
    await expect(unsafe.run({ scope: 'run', command: command(), bindings: runBindings() })).rejects.toMatchObject({
      code: 'resource_governor_protocol_error',
    });
  });

  it('imports sandbox output refs with caller-provided artifact metadata', async () => {
    const calls: Array<Parameters<SandboxOutputImporter['importSandboxOutput']>[0]> = [];
    const importer: SandboxOutputImporter = {
      async importSandboxOutput(input) {
        calls.push(input);
        return {
          kind: input.kind,
          name: input.name,
          content_type: input.contentType,
          storage_uri: `artifacts/${input.kind}-${input.name}`,
        };
      },
    };
    const { launcher } = scriptedLauncher([{ stdout: JSON.stringify(selfCheck()) }, { stdout: JSON.stringify(sandboxResult()) }]);
    const governor = createExternalGovernor(launcher, {
      outputImporter: importer,
      nonceFactory: createNonceFactory(['nonce-check-output']),
    });
    await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });

    await expect(
      governor.run({
        scope: 'run',
        command: command(),
        bindings: runBindings(),
        sandboxOutputArtifacts: {
          stdout: { kind: 'check_output', name: 'unit-stdout.txt', visibility: 'internal' },
          stderr: { kind: 'check_output', name: 'unit-stderr.txt', visibility: 'internal' },
        },
      }),
    ).resolves.toMatchObject({
      stdout_ref: 'artifacts/check_output-unit-stdout.txt',
      stderr_ref: 'artifacts/check_output-unit-stderr.txt',
      output_artifacts: {
        stdout: expect.objectContaining({ kind: 'check_output', name: 'unit-stdout.txt' }),
        stderr: expect.objectContaining({ kind: 'check_output', name: 'unit-stderr.txt' }),
      },
    });
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'check_output', name: 'unit-stdout.txt', visibility: 'internal' }),
      expect.objectContaining({ kind: 'check_output', name: 'unit-stderr.txt', visibility: 'internal' }),
    ]);
  });

  it('forces imported internal diagnostics to internal visibility', async () => {
    const calls: Array<Parameters<SandboxOutputImporter['importSandboxOutput']>[0]> = [];
    const importer: SandboxOutputImporter = {
      async importSandboxOutput(input) {
        calls.push(input);
        return {
          kind: input.kind,
          name: input.name,
          content_type: input.contentType,
          storage_uri: `artifacts/${input.name}`,
        };
      },
    };
    const diagnosticResult = sandboxResult({ stdout_ref: undefined, stderr_ref: undefined, internal_diagnostic_ref: 'diagnostic.txt' });
    const { launcher } = scriptedLauncher([{ stdout: JSON.stringify(selfCheck()) }, { stdout: JSON.stringify(diagnosticResult) }]);
    const governor = createExternalGovernor(launcher, {
      outputImporter: importer,
      nonceFactory: createNonceFactory(['nonce-diagnostic-output']),
    });
    await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });

    await expect(
      governor.run({
        scope: 'run',
        command: command(),
        bindings: runBindings(),
        sandboxOutputArtifacts: {
          diagnostic: { kind: 'logs', name: 'diagnostic.txt', visibility: 'public_safe' },
        },
      }),
    ).resolves.toMatchObject({
      internal_diagnostic_ref: 'artifacts/diagnostic.txt',
      output_artifacts: {
        internal_diagnostic: expect.objectContaining({ kind: 'logs', name: 'diagnostic.txt' }),
      },
    });
    expect(calls).toEqual([expect.objectContaining({ relativePath: 'diagnostic.txt', visibility: 'internal' })]);
  });

  it('validates and consumes app-server lease command invocations', async () => {
    const { launcher } = scriptedLauncher([{ stdout: JSON.stringify(selfCheck()) }]);
    const governor = createExternalGovernor(launcher, {
      nonceFactory: createNonceFactory(['nonce-lease']),
      now: () => '2026-05-05T00:00:00.000Z',
    });
    await governor.checkReadiness({ executorType: 'local_codex', workflowOnly: false, environment: 'local_dogfood', networkMode: 'disabled' });
    const lease = await governor.createRunLease({
      ...attestationInput(),
      workerIdentity: 'worker-1',
      promptDigest: 'sha256:prompt',
      runSpecDigest: 'sha256:run-spec',
    });

    await expect(
      governor.consumeLeaseCommandInvocation({
        lease,
        commandDigest: runBindings().commandDigest,
        commandInvocationNonce: 'command-nonce-1',
        now: '2026-05-05T00:01:00.000Z',
        expected: { ...runBindings(), promptDigest: 'sha256:prompt', runSpecDigest: 'sha256:run-spec' },
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      governor.consumeLeaseCommandInvocation({
        lease,
        commandDigest: runBindings().commandDigest,
        commandInvocationNonce: 'command-nonce-1',
        now: '2026-05-05T00:01:00.000Z',
        expected: { ...runBindings(), promptDigest: 'sha256:prompt', runSpecDigest: 'sha256:run-spec' },
      }),
    ).rejects.toMatchObject({ code: 'resource_governor_nonce_replay' });
    await expect(
      governor.consumeLeaseCommandInvocation({
        lease,
        commandDigest: runBindings().commandDigest,
        commandInvocationNonce: 'command-nonce-2',
        now: '2026-05-05T00:06:00.000Z',
        expected: { ...runBindings(), promptDigest: 'sha256:prompt', runSpecDigest: 'sha256:run-spec' },
      }),
    ).rejects.toMatchObject({ code: 'resource_governor_lease_invalid' });
    await expect(
      governor.consumeLeaseCommandInvocation({
        lease,
        commandDigest: runBindings().commandDigest,
        commandInvocationNonce: 'command-nonce-3',
        now: '2026-05-05T00:01:00.000Z',
        terminalRun: true,
        expected: { ...runBindings(), promptDigest: 'sha256:prompt', runSpecDigest: 'sha256:run-spec' },
      }),
    ).rejects.toMatchObject({ code: 'resource_governor_lease_invalid' });
    await expect(
      governor.consumeLeaseCommandInvocation({
        lease,
        commandDigest: 'sha256:unseen-command',
        commandInvocationNonce: 'command-nonce-4',
        now: '2026-05-05T00:01:00.000Z',
        expected: { ...runBindings(), workspaceRoot: '/workspace/other', promptDigest: 'sha256:prompt', runSpecDigest: 'sha256:run-spec' },
      }),
    ).rejects.toMatchObject({ code: 'resource_governor_lease_invalid' });
    await expect(
      governor.consumeLeaseCommandInvocation({
        lease,
        commandDigest: 'sha256:unexpected-command',
        commandInvocationNonce: 'command-nonce-5',
        now: '2026-05-05T00:01:00.000Z',
        expected: { ...runBindings(), promptDigest: 'sha256:prompt', runSpecDigest: 'sha256:run-spec' },
      }),
    ).rejects.toMatchObject({ code: 'resource_governor_lease_invalid' });
    await expect(
      governor.consumeLeaseCommandInvocation({
        lease: { ...lease, sandbox_config_digest: 'sha256:wrong-config' },
        commandDigest: runBindings(command({ args: ['-c', 'fresh command'] })).commandDigest,
        commandInvocationNonce: 'command-nonce-6',
        now: '2026-05-05T00:01:00.000Z',
        expected: { ...runBindings(command({ args: ['-c', 'fresh command'] })), promptDigest: 'sha256:prompt', runSpecDigest: 'sha256:run-spec' },
      }),
    ).rejects.toMatchObject({ code: 'resource_governor_lease_invalid' });
    await expect(
      governor.consumeLeaseCommandInvocation({
        lease: { ...lease, sandbox_wrapper_environment_digest: 'sha256:wrong-wrapper' },
        commandDigest: runBindings(command({ args: ['-c', 'another fresh command'] })).commandDigest,
        commandInvocationNonce: 'command-nonce-7',
        now: '2026-05-05T00:01:00.000Z',
        expected: { ...runBindings(command({ args: ['-c', 'another fresh command'] })), promptDigest: 'sha256:prompt', runSpecDigest: 'sha256:run-spec' },
      }),
    ).rejects.toMatchObject({ code: 'resource_governor_lease_invalid' });

    const asContract: ResourceGovernor = governor;
    await expect(
      asContract.consumeLeaseCommandInvocation({
        lease,
        commandDigest: runBindings(command({ args: ['-c', 'contract command'] })).commandDigest,
        commandInvocationNonce: 'command-nonce-contract',
        now: '2026-05-05T00:01:00.000Z',
        expected: { ...runBindings(command({ args: ['-c', 'contract command'] })), promptDigest: 'sha256:prompt', runSpecDigest: 'sha256:run-spec' },
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('requires a validated mock run context before test-only mock execution can run', async () => {
    const governor = new TestOnlyMockResourceGovernor('mock-governor', () => '2026-05-05T00:00:00.000Z');
    await expect(governor.run({ scope: 'run', command: command(), bindings: runBindings() })).rejects.toMatchObject({
      code: 'runtime_test_only_mock_forbidden',
    });
    await expect(
      governor.run({
        scope: 'run',
        command: command(),
        bindings: runBindings(),
        mockRunContext: { executorType: 'mock', workflowOnly: true, environment: 'test' },
      }),
    ).resolves.toMatchObject({ exit_code: 0 });
  });
});

const createNonceFactory = (nonces: string[]) => () => {
  const nonce = nonces.shift();
  if (nonce === undefined) {
    throw new Error('No nonce scripted');
  }
  return nonce;
};

const createRecordingImporter = () => {
  const calls: Array<Parameters<SandboxOutputImporter['importSandboxOutput']>[0]> = [];
  const importer: SandboxOutputImporter = {
    async importSandboxOutput(input) {
      calls.push(input);
      return {
        kind: input.kind,
        name: input.name,
        content_type: input.contentType,
        storage_uri: input.name === 'stdout.txt' ? 'artifacts/imported-stdout.txt' : 'artifacts/imported-stderr.txt',
      };
    },
  };
  return { importer, calls };
};

const testTrustVerifier: SandboxTrustVerifier = () => undefined;
